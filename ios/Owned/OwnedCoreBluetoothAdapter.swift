import Foundation
import CoreBluetooth

/**
 * 4.0 owned CoreBluetooth central — pure Swift, no RxBluetoothKit / MultiplatformBleAdapter runtime.
 * Implements BleAdapter so BlePlx.mm can use it as the default factory product.
 */
@objc
public class OwnedCoreBluetoothAdapter: NSObject, BleAdapter, CBCentralManagerDelegate, CBPeripheralDelegate {

  public static let adapterId = "owned-corebluetooth-v1"

  public weak var delegate: BleClientManagerDelegate? {
    didSet {
      flushBufferedRestoreStateEvent()
    }
  }

  private let queue: DispatchQueue
  private var central: CBCentralManager!
  private var restoreKey: String?
  private var peripherals = [String: CBPeripheral]()
  private var servicesByDevice = [String: [CBService]]()
  private var idCounter: Double = 1
  private var serviceIds = [Double: CBService]()
  private var charIds = [Double: CBCharacteristic]()
  /// Reverse maps for O(1) id lookup on notify / rediscover (R2-F074).
  private var serviceIdByObject = [ObjectIdentifier: Double]()
  private var charIdByObject = [ObjectIdentifier: Double]()
  private var descriptorIdByObject = [ObjectIdentifier: Double]()
  private var pendingConnect: [String: (Resolve, Reject)] = [:]
  /// deviceId → connect timeout work item (R2-F017).
  private var connectTimeouts: [String: DispatchWorkItem] = [:]
  /// deviceId → cancelDeviceConnection promise waiting for didDisconnect (R2-F018).
  private var pendingCancel: [String: (Resolve, Reject)] = [:]
  private var pendingDiscover: [String: (Resolve, Reject)] = [:]
  /// transactionId → deviceId for cancelTransaction on discover
  private var pendingDiscoverByTx: [String: String] = [:]
  /// Remaining service characteristic discoveries before descriptor phase may finish.
  private var pendingDiscoverCharsRemaining: [String: Int] = [:]
  /// Remaining descriptor discoveries before pendingDiscover may resolve.
  private var pendingDiscoverDescsRemaining: [String: Int] = [:]
  /// transactionId → promise (never use values.first / removeAll for multi-pending)
  private var pendingRead: [String: (Resolve, Reject)] = [:]
  /// charKey → transactionId
  private var pendingReadByChar: [String: String] = [:]
  private var pendingWrite: [String: (Resolve, Reject)] = [:]
  private var pendingWriteByChar: [String: String] = [:]
  private var pendingRssi: [String: (Resolve, Reject)] = [:]
  /// transactionId → deviceId
  private var pendingRssiByTx: [String: String] = [:]
  private var lastRssiByDevice: [String: Int] = [:]
  private var monitors = [String: String]() // charKey -> transactionId
  /// charKey → monitor enable promise settled in didUpdateNotificationStateFor (R2-F019).
  private var pendingMonitorEnable: [String: (Resolve, Reject)] = [:]
  /// Cached numeric ids + metadata for notify hot path (R2-F074).
  private var monitorNotifyCache = [String: MonitorNotifyCache]()
  private var descriptorIds = [Double: CBDescriptor]()
  private var pendingDescRead = [String: (Resolve, Reject)]()
  private var pendingDescReadByDesc = [String: String]() // descKey -> transactionId
  private var pendingDescWrite = [String: (Resolve, Reject)]()
  private var pendingDescWriteByDesc = [String: String]()
  private var logLevel = "None"
  /// MBA amb: emit RestoreStateEvent once — real willRestoreState or synthetic null (R2-F016).
  private var restoreAmbActive = false
  private var restoreEventEmitted = false
  private var bufferedRestoreEvent: Any?

  private struct MonitorNotifyCache {
    let transactionId: String
    let charId: Double
    let serviceId: Double
    let uuid: String
    let serviceUUID: String
    let deviceID: String
    let isReadable: Bool
    let isWritableWithResponse: Bool
    let isWritableWithoutResponse: Bool
    let isNotifiable: Bool
    let isIndicatable: Bool
  }

  public required init(queue: DispatchQueue, restoreIdentifierKey: String?) {
    self.queue = queue
    self.restoreKey = restoreIdentifierKey
    super.init()
    var options: [String: Any] = [:]
    #if os(iOS)
    if let key = restoreIdentifierKey, !key.isEmpty {
      options[CBCentralManagerOptionRestoreIdentifierKey] = key
      // Cold-start amb: settle getRestoredState with null if OS never restores.
      self.restoreAmbActive = true
    }
    // Prefer a single CM: adopt bundled registry early-wake central when present (R2-F020).
    if let early = Self.takeBundledEarlyCentral() {
      self.central = early
      self.central.delegate = self
      return
    }
    #endif
    self.central = CBCentralManager(delegate: self, queue: queue, options: options.isEmpty ? nil : options)
  }

  /// Adopt a system-restored `CBCentralManager` (same restore ID) instead of creating a second central.
  /// Used by the Restoration subspec handoff path (F005).
  @objc
  public init(
    adoptingRestoredCentral central: CBCentralManager,
    restoredPeripherals: [CBPeripheral],
    queue: DispatchQueue,
    restoreIdentifierKey: String?
  ) {
    self.queue = queue
    self.restoreKey = restoreIdentifierKey
    // System willRestoreState already delivered — do not run cold-null amb.
    self.restoreAmbActive = false
    self.restoreEventEmitted = true
    super.init()
    self.central = central
    self.central.delegate = self
    for p in restoredPeripherals {
      let id = p.identifier.uuidString
      self.peripherals[id] = p
      p.delegate = self
    }
  }

  /// Seed peripheral cache from CoreBluetooth restore identifiers (best-effort).
  /// `retrievePeripherals` is gated on `.poweredOn`; may no-op when still `.unknown`.
  @objc
  public func seedRestoredPeripherals(withIdentifiers identifiers: [String]) {
    let uuids = identifiers.compactMap { UUID(uuidString: $0) }
    guard !uuids.isEmpty else { return }
    guard central.state == .poweredOn else { return }
    for p in central.retrievePeripherals(withIdentifiers: uuids) {
      let id = p.identifier.uuidString
      peripherals[id] = p
      p.delegate = self
    }
  }

  /// Disarm cold-start restore amb (BlePlx.mm restore handoff replay path — R2-F016).
  @objc
  public func completePendingRestoreStateEvent() {
    restoreAmbActive = false
    restoreEventEmitted = true
    bufferedRestoreEvent = nil
  }

  public func invalidate() {
    central.stopScan()
    for p in peripherals.values {
      if p.state == .connected || p.state == .connecting {
        central.cancelPeripheralConnection(p)
      }
      p.delegate = nil
    }
    // Reject all outstanding promises so JS destroyClient does not strand callers.
    let destroyed = jsonError(code: 1, message: "Bluetooth manager destroyed")
    let rejectAll: ((Resolve, Reject)) -> Void = { pair in
      pair.1("BlePlxError", destroyed, nil)
    }
    for item in connectTimeouts.values { item.cancel() }
    connectTimeouts.removeAll()
    pendingConnect.values.forEach(rejectAll)
    pendingCancel.values.forEach(rejectAll)
    pendingDiscover.values.forEach(rejectAll)
    pendingRead.values.forEach(rejectAll)
    pendingWrite.values.forEach(rejectAll)
    pendingRssi.values.forEach(rejectAll)
    pendingDescRead.values.forEach(rejectAll)
    pendingDescWrite.values.forEach(rejectAll)
    pendingMonitorEnable.values.forEach(rejectAll)

    pendingConnect.removeAll()
    pendingCancel.removeAll()
    pendingDiscover.removeAll()
    pendingDiscoverByTx.removeAll()
    pendingDiscoverCharsRemaining.removeAll()
    pendingDiscoverDescsRemaining.removeAll()
    pendingRead.removeAll()
    pendingReadByChar.removeAll()
    pendingWrite.removeAll()
    pendingWriteByChar.removeAll()
    pendingRssi.removeAll()
    pendingRssiByTx.removeAll()
    pendingDescRead.removeAll()
    pendingDescReadByDesc.removeAll()
    pendingDescWrite.removeAll()
    pendingDescWriteByDesc.removeAll()
    pendingMonitorEnable.removeAll()
    monitors.removeAll()
    monitorNotifyCache.removeAll()
    peripherals.removeAll()
    servicesByDevice.removeAll()
    serviceIds.removeAll()
    charIds.removeAll()
    charIdByObject.removeAll()
    serviceIdByObject.removeAll()
    descriptorIdByObject.removeAll()
    descriptorIds.removeAll()
    lastRssiByDevice.removeAll()
    bufferedRestoreEvent = nil
    restoreEventEmitted = true
    restoreAmbActive = false

    central.delegate = nil
  }

  public func cancelTransaction(_ transactionId: String) {
    let cancelled = jsonError(code: 2, message: "Operation cancelled")
    if let (_, reject) = pendingRead.removeValue(forKey: transactionId) {
      pendingReadByChar = pendingReadByChar.filter { $0.value != transactionId }
      reject("BlePlxError", cancelled, nil)
    }
    if let (_, reject) = pendingWrite.removeValue(forKey: transactionId) {
      pendingWriteByChar = pendingWriteByChar.filter { $0.value != transactionId }
      reject("BlePlxError", cancelled, nil)
    }
    if let (_, reject) = pendingDescRead.removeValue(forKey: transactionId) {
      pendingDescReadByDesc = pendingDescReadByDesc.filter { $0.value != transactionId }
      reject("BlePlxError", cancelled, nil)
    }
    if let (_, reject) = pendingDescWrite.removeValue(forKey: transactionId) {
      pendingDescWriteByDesc = pendingDescWriteByDesc.filter { $0.value != transactionId }
      reject("BlePlxError", cancelled, nil)
    }
    if let deviceId = pendingRssiByTx.removeValue(forKey: transactionId),
       let (_, reject) = pendingRssi.removeValue(forKey: deviceId) {
      reject("BlePlxError", cancelled, nil)
    }
    if let deviceId = pendingDiscoverByTx.removeValue(forKey: transactionId),
       let (_, reject) = pendingDiscover.removeValue(forKey: deviceId) {
      pendingDiscoverCharsRemaining.removeValue(forKey: deviceId)
      pendingDiscoverDescsRemaining.removeValue(forKey: deviceId)
      reject("BlePlxError", cancelled, nil)
    }
    // Monitor teardown: disable notify when this transaction owns the subscription.
    if let entry = monitors.first(where: { $0.value == transactionId }) {
      monitors.removeValue(forKey: entry.key)
      monitorNotifyCache.removeValue(forKey: entry.key)
      if let pending = pendingMonitorEnable.removeValue(forKey: entry.key) {
        pending.1("BlePlxError", cancelled, nil)
      }
      disableNotify(forCharKey: entry.key)
    }
  }

  public func setLogLevel(_ logLevel: String) {
    self.logLevel = logLevel
  }

  public func logLevel(_ resolve: Resolve, reject: Reject) {
    resolve(logLevel)
  }

  public func enable(_ transactionId: String, resolve: Resolve, reject: Reject) {
    resolve(nil)
  }

  public func disable(_ transactionId: String, resolve: Resolve, reject: Reject) {
    resolve(nil)
  }

  public func state(_ resolve: Resolve, reject: Reject) {
    resolve(stateString(central.state))
  }

  public func startDeviceScan(_ filteredUUIDs: [String]?, options: [String: AnyObject]?) {
    let uuids = filteredUUIDs?.compactMap { CBUUID(string: $0) }
    let allowDuplicates = (options?["allowDuplicates"] as? Bool) ?? false
    let opts: [String: Any] = [CBCentralManagerScanOptionAllowDuplicatesKey: allowDuplicates]
    central.scanForPeripherals(withServices: uuids, options: opts)
  }

  public func stopDeviceScan() {
    central.stopScan()
  }

  public func readRSSIForDevice(_ deviceIdentifier: String, transactionId: String, resolve: @escaping Resolve, reject: @escaping Reject) {
    guard let p = peripherals[deviceIdentifier] else {
      reject("BlePlxError", jsonError(code: 204, message: "Device not found"), nil)
      return
    }
    p.delegate = self
    // Must wait for peripheral(_:didReadRSSI:error:) — resolving immediately yields rssi:null.
    pendingRssi[deviceIdentifier] = (resolve, reject)
    pendingRssiByTx[transactionId] = deviceIdentifier
    p.readRSSI()
  }

  public func requestMTUForDevice(_ deviceIdentifier: String, mtu: Int, transactionId: String, resolve: @escaping Resolve, reject: @escaping Reject) {
    // `mtu` / `transactionId` are accepted for BleAdapter / Android API parity only.
    // iOS CoreBluetooth negotiates ATT MTU automatically — there is no request API.
    // Never invent negotiation: ignore the requested value and report the OS limit.
    _ = mtu
    _ = transactionId
    guard let p = peripherals[deviceIdentifier] else {
      reject("BlePlxError", jsonError(code: 204, message: "Device not found"), nil)
      return
    }
    guard p.state == .connected else {
      reject("BlePlxError", jsonError(code: 205, message: "Device not connected"), nil)
      return
    }
    // Reporting-only: resolve with device.mtu from maximumWriteValueLength(+3).
    resolve(deviceJs(p))
  }

  public func requestConnectionPriorityForDevice(_ deviceIdentifier: String, connectionPriority: Int, transactionId: String, resolve: @escaping Resolve, reject: @escaping Reject) {
    guard let p = peripherals[deviceIdentifier] else {
      reject("BlePlxError", jsonError(code: 204, message: "Device not found"), nil)
      return
    }
    resolve(deviceJs(p))
  }

  public func devices(_ deviceIdentifiers: [String], resolve: @escaping Resolve, reject: @escaping Reject) {
    let list = deviceIdentifiers.compactMap { peripherals[$0] }.map { deviceJs($0) }
    resolve(list)
  }

  public func connectedDevices(_ serviceUUIDs: [String], resolve: @escaping Resolve, reject: @escaping Reject) {
    // 3.x passes service UUIDs to retrieveConnectedPeripherals(withServices:).
    // Empty list → no matches (same as CoreBluetooth with empty service array).
    if serviceUUIDs.isEmpty {
      resolve([])
      return
    }
    let filterUUIDs = serviceUUIDs.map { CBUUID(string: $0) }
    var seen = Set<String>()
    var list: [CBPeripheral] = []

    if central.state == .poweredOn {
      for p in central.retrieveConnectedPeripherals(withServices: filterUUIDs) {
        let id = p.identifier.uuidString
        peripherals[id] = p
        p.delegate = self
        if seen.insert(id).inserted {
          list.append(p)
        }
      }
    }

    // Also include owned-cache connected peripherals whose discovered services match.
    for (id, p) in peripherals where p.state == .connected {
      guard !seen.contains(id) else { continue }
      guard let services = servicesByDevice[id] else { continue }
      let matches = services.contains { svc in
        filterUUIDs.contains(where: { $0 == svc.uuid })
      }
      if matches {
        seen.insert(id)
        list.append(p)
      }
    }

    resolve(list.map { deviceJs($0) })
  }

  public func connectToDevice(_ deviceIdentifier: String, options: [String: AnyObject]?, resolve: @escaping Resolve, reject: @escaping Reject) {
    let timeoutMs: Int? = {
      guard let options = options else { return nil }
      if let n = options["timeout"] as? NSNumber { return n.intValue }
      if let i = options["timeout"] as? Int { return i }
      if let d = options["timeout"] as? Double { return Int(d) }
      return nil
    }()

    guard let p = peripherals[deviceIdentifier] ?? retrieveAndCache(deviceIdentifier) else {
      reject("BlePlxError", jsonError(code: 204, message: "Device not found"), nil)
      return
    }
    p.delegate = self

    // R2-F017: CoreBluetooth often never re-fires didConnect if already .connected.
    if p.state == .connected {
      resolve(deviceJs(p))
      return
    }

    // Replace in-flight connect for the same id (cancel previous promise).
    if let previous = pendingConnect.removeValue(forKey: deviceIdentifier) {
      cancelConnectTimeout(deviceIdentifier)
      previous.1("BlePlxError", jsonError(code: 2, message: "Operation cancelled"), nil)
    }

    pendingConnect[deviceIdentifier] = (resolve, reject)
    if let timeoutMs = timeoutMs, timeoutMs > 0 {
      let work = DispatchWorkItem { [weak self] in
        guard let self = self else { return }
        guard let pending = self.pendingConnect.removeValue(forKey: deviceIdentifier) else { return }
        self.connectTimeouts.removeValue(forKey: deviceIdentifier)
        self.central.cancelPeripheralConnection(p)
        pending.1(
          "BlePlxError",
          self.jsonError(code: 3, message: "Connection timed out after \(timeoutMs)ms"),
          nil
        )
      }
      connectTimeouts[deviceIdentifier] = work
      queue.asyncAfter(deadline: .now() + .milliseconds(timeoutMs), execute: work)
    }
    central.connect(p, options: nil)
  }

  public func cancelDeviceConnection(_ deviceIdentifier: String, resolve: @escaping Resolve, reject: @escaping Reject) {
    guard let p = peripherals[deviceIdentifier] else {
      reject("BlePlxError", jsonError(code: 204, message: "Device not found"), nil)
      return
    }

    // R2-F018: always clear in-flight connect so didConnect cannot double-settle later.
    cancelConnectTimeout(deviceIdentifier)
    if let pending = pendingConnect.removeValue(forKey: deviceIdentifier) {
      pending.1("BlePlxError", jsonError(code: 2, message: "Operation cancelled"), nil)
    }

    if p.state == .connected || p.state == .connecting {
      // Wait for didDisconnect before resolving cancel (MBA cancelConnection completion).
      if let previous = pendingCancel.removeValue(forKey: deviceIdentifier) {
        previous.1("BlePlxError", jsonError(code: 2, message: "Operation cancelled"), nil)
      }
      pendingCancel[deviceIdentifier] = (resolve, reject)
      central.cancelPeripheralConnection(p)
      return
    }

    tearDownDevice(deviceIdentifier)
    resolve(deviceJs(p))
  }

  public func isDeviceConnected(_ deviceIdentifier: String, resolve: Resolve, reject: Reject) {
    let connected = peripherals[deviceIdentifier]?.state == .connected
    resolve(connected)
  }

  public func discoverAllServicesAndCharacteristicsForDevice(_ deviceIdentifier: String, transactionId: String, resolve: @escaping Resolve, reject: @escaping Reject) {
    guard let p = peripherals[deviceIdentifier], p.state == .connected else {
      reject("BlePlxError", jsonError(code: 205, message: "Device not connected"), nil)
      return
    }
    pendingDiscover[deviceIdentifier] = (resolve, reject)
    pendingDiscoverByTx[transactionId] = deviceIdentifier
    p.discoverServices(nil)
  }

  public func servicesForDevice(_ deviceIdentifier: String, resolve: Resolve, reject: Reject) {
    guard let services = servicesByDevice[deviceIdentifier] else {
      resolve([])
      return
    }
    let js = services.map { serviceJs($0, deviceId: deviceIdentifier) }
    resolve(js)
  }

  public func characteristicsForDevice(_ deviceIdentifier: String, serviceUUID: String, resolve: Resolve, reject: Reject) {
    guard let services = servicesByDevice[deviceIdentifier] else {
      resolve([])
      return
    }
    let target = CBUUID(string: serviceUUID)
    guard let service = services.first(where: { $0.uuid == target }) else {
      resolve([])
      return
    }
    let chars = (service.characteristics ?? []).map { characteristicJs($0, deviceId: deviceIdentifier, service: service) }
    resolve(chars)
  }

  public func characteristicsForService(_ serviceIdentifier: Double, resolve: Resolve, reject: Reject) {
    guard let service = serviceIds[serviceIdentifier] else {
      resolve([])
      return
    }
    let deviceId = peripherals.first(where: { $0.value == service.peripheral })?.key ?? ""
    let chars = (service.characteristics ?? []).map { characteristicJs($0, deviceId: deviceId, service: service) }
    resolve(chars)
  }

  public func descriptorsForDevice(_ deviceIdentifier: String, serviceUUID: String, characteristicUUID: String, resolve: Resolve, reject: Reject) {
    guard let service = servicesByDevice[deviceIdentifier]?.first(where: { $0.uuid == CBUUID(string: serviceUUID) }),
          let ch = service.characteristics?.first(where: { $0.uuid == CBUUID(string: characteristicUUID) }) else {
      resolve([])
      return
    }
    let descs = (ch.descriptors ?? []).map { descriptorJs($0, deviceId: deviceIdentifier, characteristic: ch, service: service) }
    resolve(descs)
  }

  public func descriptorsForService(_ serviceIdentifier: Double, characteristicUUID: String, resolve: Resolve, reject: Reject) {
    guard let service = serviceIds[serviceIdentifier],
          let ch = service.characteristics?.first(where: { $0.uuid == CBUUID(string: characteristicUUID) }),
          let p = service.peripheral else {
      resolve([])
      return
    }
    let deviceId = peripherals.first(where: { $0.value == p })?.key ?? p.identifier.uuidString
    let descs = (ch.descriptors ?? []).map { descriptorJs($0, deviceId: deviceId, characteristic: ch, service: service) }
    resolve(descs)
  }

  public func descriptorsForCharacteristic(_ characteristicIdentifier: Double, resolve: Resolve, reject: Reject) {
    guard let ch = charIds[characteristicIdentifier], let service = ch.service, let p = service.peripheral else {
      resolve([])
      return
    }
    let deviceId = peripherals.first(where: { $0.value == p })?.key ?? p.identifier.uuidString
    let descs = (ch.descriptors ?? []).map { descriptorJs($0, deviceId: deviceId, characteristic: ch, service: service) }
    resolve(descs)
  }

  public func readCharacteristicForDevice(_ deviceIdentifier: String, serviceUUID: String, characteristicUUID: String, transactionId: String, resolve: @escaping Resolve, reject: @escaping Reject) {
    guard let p = peripherals[deviceIdentifier],
          let service = servicesByDevice[deviceIdentifier]?.first(where: { $0.uuid == CBUUID(string: serviceUUID) }),
          let ch = service.characteristics?.first(where: { $0.uuid == CBUUID(string: characteristicUUID) }) else {
      reject("BlePlxError", jsonError(code: 404, message: "Characteristic not found"), nil)
      return
    }
    let key = charKey(deviceIdentifier, ch)
    pendingRead[transactionId] = (resolve, reject)
    pendingReadByChar[key] = transactionId
    p.readValue(for: ch)
  }

  public func readCharacteristicForService(_ serviceIdentifier: Double, characteristicUUID: String, transactionId: String, resolve: @escaping Resolve, reject: @escaping Reject) {
    guard let service = serviceIds[serviceIdentifier],
          service.characteristics?.contains(where: { $0.uuid == CBUUID(string: characteristicUUID) }) == true,
          let p = service.peripheral else {
      reject("BlePlxError", jsonError(code: 404, message: "Characteristic not found"), nil)
      return
    }
    let deviceId = peripherals.first(where: { $0.value == p })?.key ?? p.identifier.uuidString
    readCharacteristicForDevice(deviceId, serviceUUID: service.uuid.uuidString, characteristicUUID: characteristicUUID, transactionId: transactionId, resolve: resolve, reject: reject)
  }

  public func readCharacteristic(_ characteristicIdentifier: Double, transactionId: String, resolve: @escaping Resolve, reject: @escaping Reject) {
    guard let ch = charIds[characteristicIdentifier], let p = ch.service?.peripheral else {
      reject("BlePlxError", jsonError(code: 404, message: "Characteristic not found"), nil)
      return
    }
    let deviceId = peripherals.first(where: { $0.value == p })?.key ?? p.identifier.uuidString
    let key = charKey(deviceId, ch)
    pendingRead[transactionId] = (resolve, reject)
    pendingReadByChar[key] = transactionId
    p.readValue(for: ch)
  }

  public func writeCharacteristicForDevice(_ deviceIdentifier: String, serviceUUID: String, characteristicUUID: String, valueBase64: String, response: Bool, transactionId: String, resolve: @escaping Resolve, reject: @escaping Reject) {
    guard let p = peripherals[deviceIdentifier],
          let service = servicesByDevice[deviceIdentifier]?.first(where: { $0.uuid == CBUUID(string: serviceUUID) }),
          let ch = service.characteristics?.first(where: { $0.uuid == CBUUID(string: characteristicUUID) }),
          let data = Data(base64Encoded: valueBase64) else {
      reject("BlePlxError", jsonError(code: 404, message: "Characteristic not found or bad base64"), nil)
      return
    }
    if response {
      let key = charKey(deviceIdentifier, ch)
      pendingWrite[transactionId] = (resolve, reject)
      pendingWriteByChar[key] = transactionId
      p.writeValue(data, for: ch, type: .withResponse)
    } else {
      p.writeValue(data, for: ch, type: .withoutResponse)
      // withoutResponse may not callback
      resolve(characteristicJs(ch, deviceId: deviceIdentifier, service: service, value: data))
    }
  }

  public func writeCharacteristicForService(_ serviceIdentifier: Double, characteristicUUID: String, valueBase64: String, response: Bool, transactionId: String, resolve: @escaping Resolve, reject: @escaping Reject) {
    guard let service = serviceIds[serviceIdentifier], let p = service.peripheral else {
      reject("BlePlxError", jsonError(code: 302, message: "Service not found"), nil)
      return
    }
    let deviceId = peripherals.first(where: { $0.value == p })?.key ?? p.identifier.uuidString
    writeCharacteristicForDevice(deviceId, serviceUUID: service.uuid.uuidString, characteristicUUID: characteristicUUID, valueBase64: valueBase64, response: response, transactionId: transactionId, resolve: resolve, reject: reject)
  }

  public func writeCharacteristic(_ characteristicIdentifier: Double, valueBase64: String, response: Bool, transactionId: String, resolve: @escaping Resolve, reject: @escaping Reject) {
    guard let ch = charIds[characteristicIdentifier],
          let service = ch.service,
          let p = service.peripheral,
          Data(base64Encoded: valueBase64) != nil else {
      reject("BlePlxError", jsonError(code: 404, message: "Characteristic not found"), nil)
      return
    }
    let deviceId = peripherals.first(where: { $0.value == p })?.key ?? p.identifier.uuidString
    writeCharacteristicForDevice(deviceId, serviceUUID: service.uuid.uuidString, characteristicUUID: ch.uuid.uuidString, valueBase64: valueBase64, response: response, transactionId: transactionId, resolve: resolve, reject: reject)
  }

  public func monitorCharacteristicForDevice(_ deviceIdentifier: String, serviceUUID: String, characteristicUUID: String, transactionId: String, resolve: @escaping Resolve, reject: @escaping Reject) {
    guard let p = peripherals[deviceIdentifier],
          let service = servicesByDevice[deviceIdentifier]?.first(where: { $0.uuid == CBUUID(string: serviceUUID) }),
          let ch = service.characteristics?.first(where: { $0.uuid == CBUUID(string: characteristicUUID) }) else {
      reject("BlePlxError", jsonError(code: 404, message: "Characteristic not found"), nil)
      return
    }
    let key = charKey(deviceIdentifier, ch)
    let props = ch.properties
    // Cache numeric ids + static metadata so notify packets avoid linear scans (R2-F074).
    monitorNotifyCache[key] = MonitorNotifyCache(
      transactionId: transactionId,
      charId: idForCharacteristic(ch),
      serviceId: idForService(service),
      uuid: ch.uuid.uuidString.lowercased(),
      serviceUUID: service.uuid.uuidString.lowercased(),
      deviceID: deviceIdentifier,
      isReadable: props.contains(.read),
      isWritableWithResponse: props.contains(.write),
      isWritableWithoutResponse: props.contains(.writeWithoutResponse),
      isNotifiable: props.contains(.notify),
      isIndicatable: props.contains(.indicate)
    )
    // Replace prior monitor enable on the same char.
    if let previous = pendingMonitorEnable.removeValue(forKey: key) {
      previous.1("BlePlxError", jsonError(code: 2, message: "Operation cancelled"), nil)
    }
    monitors[key] = transactionId
    pendingMonitorEnable[key] = (resolve, reject)
    p.setNotifyValue(true, for: ch)
    // Resolve/reject in didUpdateNotificationStateFor (R2-F019) — do not claim success early.
  }

  public func monitorCharacteristicForService(_ serviceIdentifier: Double, characteristicUUID: String, transactionId: String, resolve: @escaping Resolve, reject: @escaping Reject) {
    guard let service = serviceIds[serviceIdentifier], let p = service.peripheral else {
      reject("BlePlxError", jsonError(code: 302, message: "Service not found"), nil)
      return
    }
    let deviceId = peripherals.first(where: { $0.value == p })?.key ?? p.identifier.uuidString
    monitorCharacteristicForDevice(deviceId, serviceUUID: service.uuid.uuidString, characteristicUUID: characteristicUUID, transactionId: transactionId, resolve: resolve, reject: reject)
  }

  public func monitorCharacteristic(_ characteristicIdentifier: Double, transactionId: String, resolve: @escaping Resolve, reject: @escaping Reject) {
    guard let ch = charIds[characteristicIdentifier], let service = ch.service, let p = service.peripheral else {
      reject("BlePlxError", jsonError(code: 404, message: "Characteristic not found"), nil)
      return
    }
    let deviceId = peripherals.first(where: { $0.value == p })?.key ?? p.identifier.uuidString
    monitorCharacteristicForDevice(deviceId, serviceUUID: service.uuid.uuidString, characteristicUUID: ch.uuid.uuidString, transactionId: transactionId, resolve: resolve, reject: reject)
  }

  public func readDescriptorForDevice(_ deviceIdentifier: String, serviceUUID: String, characteristicUUID: String, descriptorUUID: String, transactionId: String, resolve: @escaping Resolve, reject: @escaping Reject) {
    guard let p = peripherals[deviceIdentifier],
          let service = servicesByDevice[deviceIdentifier]?.first(where: { $0.uuid == CBUUID(string: serviceUUID) }),
          let ch = service.characteristics?.first(where: { $0.uuid == CBUUID(string: characteristicUUID) }),
          let desc = ch.descriptors?.first(where: { $0.uuid == CBUUID(string: descriptorUUID) }) else {
      reject("BlePlxError", jsonError(code: 503, message: "descriptor not found"), nil)
      return
    }
    let key = descKey(deviceIdentifier, desc)
    pendingDescRead[transactionId] = (resolve, reject)
    pendingDescReadByDesc[key] = transactionId
    p.readValue(for: desc)
  }

  public func readDescriptorForService(_ serviceId: Double, characteristicUUID: String, descriptorUUID: String, transactionId: String, resolve: @escaping Resolve, reject: @escaping Reject) {
    guard let service = serviceIds[serviceId], let p = service.peripheral else {
      reject("BlePlxError", jsonError(code: 503, message: "descriptor not found"), nil)
      return
    }
    let deviceId = peripherals.first(where: { $0.value == p })?.key ?? p.identifier.uuidString
    readDescriptorForDevice(deviceId, serviceUUID: service.uuid.uuidString, characteristicUUID: characteristicUUID, descriptorUUID: descriptorUUID, transactionId: transactionId, resolve: resolve, reject: reject)
  }

  public func readDescriptorForCharacteristic(_ characteristicID: Double, descriptorUUID: String, transactionId: String, resolve: @escaping Resolve, reject: @escaping Reject) {
    guard let ch = charIds[characteristicID], let service = ch.service, let p = service.peripheral else {
      reject("BlePlxError", jsonError(code: 503, message: "descriptor not found"), nil)
      return
    }
    let deviceId = peripherals.first(where: { $0.value == p })?.key ?? p.identifier.uuidString
    readDescriptorForDevice(deviceId, serviceUUID: service.uuid.uuidString, characteristicUUID: ch.uuid.uuidString, descriptorUUID: descriptorUUID, transactionId: transactionId, resolve: resolve, reject: reject)
  }

  public func readDescriptor(_ descriptorID: Double, transactionId: String, resolve: @escaping Resolve, reject: @escaping Reject) {
    guard let desc = descriptorIds[descriptorID], let ch = desc.characteristic, let service = ch.service, let p = service.peripheral else {
      reject("BlePlxError", jsonError(code: 503, message: "descriptor not found"), nil)
      return
    }
    let deviceId = peripherals.first(where: { $0.value == p })?.key ?? p.identifier.uuidString
    let key = descKey(deviceId, desc)
    pendingDescRead[transactionId] = (resolve, reject)
    pendingDescReadByDesc[key] = transactionId
    p.readValue(for: desc)
  }

  public func writeDescriptorForDevice(_ deviceIdentifier: String, serviceUUID: String, characteristicUUID: String, descriptorUUID: String, valueBase64: String, transactionId: String, resolve: @escaping Resolve, reject: @escaping Reject) {
    guard let p = peripherals[deviceIdentifier],
          let service = servicesByDevice[deviceIdentifier]?.first(where: { $0.uuid == CBUUID(string: serviceUUID) }),
          let ch = service.characteristics?.first(where: { $0.uuid == CBUUID(string: characteristicUUID) }),
          let desc = ch.descriptors?.first(where: { $0.uuid == CBUUID(string: descriptorUUID) }),
          let data = Data(base64Encoded: valueBase64) else {
      reject("BlePlxError", jsonError(code: 501, message: "descriptor write failed"), nil)
      return
    }
    let key = descKey(deviceIdentifier, desc)
    pendingDescWrite[transactionId] = (resolve, reject)
    pendingDescWriteByDesc[key] = transactionId
    p.writeValue(data, for: desc)
  }

  public func writeDescriptorForService(_ serviceID: Double, characteristicUUID: String, descriptorUUID: String, valueBase64: String, transactionId: String, resolve: @escaping Resolve, reject: @escaping Reject) {
    guard let service = serviceIds[serviceID], let p = service.peripheral else {
      reject("BlePlxError", jsonError(code: 501, message: "descriptor write failed"), nil)
      return
    }
    let deviceId = peripherals.first(where: { $0.value == p })?.key ?? p.identifier.uuidString
    writeDescriptorForDevice(deviceId, serviceUUID: service.uuid.uuidString, characteristicUUID: characteristicUUID, descriptorUUID: descriptorUUID, valueBase64: valueBase64, transactionId: transactionId, resolve: resolve, reject: reject)
  }

  public func writeDescriptorForCharacteristic(_ characteristicID: Double, descriptorUUID: String, valueBase64: String, transactionId: String, resolve: @escaping Resolve, reject: @escaping Reject) {
    guard let ch = charIds[characteristicID], let service = ch.service, let p = service.peripheral else {
      reject("BlePlxError", jsonError(code: 501, message: "descriptor write failed"), nil)
      return
    }
    let deviceId = peripherals.first(where: { $0.value == p })?.key ?? p.identifier.uuidString
    writeDescriptorForDevice(deviceId, serviceUUID: service.uuid.uuidString, characteristicUUID: ch.uuid.uuidString, descriptorUUID: descriptorUUID, valueBase64: valueBase64, transactionId: transactionId, resolve: resolve, reject: reject)
  }

  public func writeDescriptor(_ descriptorID: Double, valueBase64: String, transactionId: String, resolve: @escaping Resolve, reject: @escaping Reject) {
    guard let desc = descriptorIds[descriptorID],
          let ch = desc.characteristic,
          let service = ch.service,
          let p = service.peripheral,
          let data = Data(base64Encoded: valueBase64) else {
      reject("BlePlxError", jsonError(code: 501, message: "descriptor write failed"), nil)
      return
    }
    let deviceId = peripherals.first(where: { $0.value == p })?.key ?? p.identifier.uuidString
    let key = descKey(deviceId, desc)
    pendingDescWrite[transactionId] = (resolve, reject)
    pendingDescWriteByDesc[key] = transactionId
    p.writeValue(data, for: desc)
  }

  // MARK: - CBCentralManagerDelegate

  public func centralManagerDidUpdateState(_ central: CBCentralManager) {
    delegate?.dispatchEvent(BleEvent.stateChangeEvent, value: stateString(central.state))
    // R2-F016: MBA amb — first state update without willRestoreState → synthetic null.
    if restoreAmbActive && !restoreEventEmitted {
      emitRestoreStateEvent(NSNull())
    }
  }

  /// iOS Core Bluetooth state restoration (central). Requires restore identifier + bluetooth-central.
  /// See Apple TN3115 — relaunch only when waiting for a Bluetooth event (scan/connect/notify).
  #if os(iOS)
  public func centralManager(_ central: CBCentralManager, willRestoreState dict: [String: Any]) {
    let restored = dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral] ?? []
    for p in restored {
      let id = p.identifier.uuidString
      peripherals[id] = p
      p.delegate = self
    }
    let devices = restored.map { deviceJs($0) }
    emitRestoreStateEvent(["connectedPeripherals": devices])
  }
  #endif

  public func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
    let id = peripheral.identifier.uuidString
    peripherals[id] = peripheral
    peripheral.delegate = self
    lastRssiByDevice[id] = RSSI.intValue
    var device = deviceJs(peripheral)
    device["rssi"] = RSSI
    let localName = advertisementData[CBAdvertisementDataLocalNameKey] as? String
    device["name"] = (peripheral.name ?? localName) as Any
    device["localName"] = (localName as Any?) ?? NSNull()
    applyAdvertisementFields(advertisementData, to: &device)
    // Negotiated MTU unknown while scanning — keep ATT default until connected.
    device["mtu"] = 23
    delegate?.dispatchEvent(BleEvent.scanEvent, value: [NSNull(), device])
  }

  public func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    let id = peripheral.identifier.uuidString
    cancelConnectTimeout(id)
    if let pending = pendingConnect.removeValue(forKey: id) {
      pending.0(deviceJs(peripheral))
    }
  }

  public func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
    let id = peripheral.identifier.uuidString
    cancelConnectTimeout(id)
    if let pending = pendingConnect.removeValue(forKey: id) {
      pending.1("BlePlxError", jsonError(code: 200, message: error?.localizedDescription ?? "connect failed"), nsError(error))
    }
    // cancelDeviceConnection while .connecting ends here (not didDisconnect).
    if let cancel = pendingCancel.removeValue(forKey: id) {
      cancel.0(deviceJs(peripheral))
    }
  }

  public func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
    let id = peripheral.identifier.uuidString
    // R2-F069: reject pending GATT + clear caches before emit.
    tearDownDevice(id)
    let err: Any = error.map { jsonError(code: 201, message: $0.localizedDescription) } ?? NSNull()
    if let cancel = pendingCancel.removeValue(forKey: id) {
      cancel.0(deviceJs(peripheral))
    }
    delegate?.dispatchEvent(BleEvent.disconnectionEvent, value: [err, deviceJs(peripheral)])
  }

  // MARK: - CBPeripheralDelegate

  public func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    let id = peripheral.identifier.uuidString
    if let error = error {
      pendingDiscoverCharsRemaining.removeValue(forKey: id)
      pendingDiscoverDescsRemaining.removeValue(forKey: id)
      clearDiscoverTx(forDevice: id)
      pendingDiscover.removeValue(forKey: id)?.1("BlePlxError", jsonError(code: 300, message: error.localizedDescription), nsError(error))
      return
    }
    let services = peripheral.services ?? []
    servicesByDevice[id] = services
    // R2-F070: drop orphan service ids for this peripheral, then reuse === identity.
    pruneServiceIds(forDevice: id, keeping: services)
    for s in services {
      _ = idForService(s)
    }
    // Resolve only after characteristics *and* descriptors are discovered (or immediately if none).
    if services.isEmpty {
      pendingDiscoverCharsRemaining.removeValue(forKey: id)
      pendingDiscoverDescsRemaining.removeValue(forKey: id)
      clearDiscoverTx(forDevice: id)
      pendingDiscover.removeValue(forKey: id)?.0(deviceJs(peripheral))
      return
    }
    pendingDiscoverCharsRemaining[id] = services.count
    pendingDiscoverDescsRemaining[id] = 0
    for s in services {
      peripheral.discoverCharacteristics(nil, for: s)
    }
  }

  public func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
    let id = peripheral.identifier.uuidString
    if error == nil {
      let chars = service.characteristics ?? []
      for ch in chars {
        // Keep stable ids: only allocate when characteristic is first seen.
        _ = idForCharacteristic(ch)
        // Discover descriptors so list/read/write paths have CBDescriptor objects.
        // Count each outstanding descriptor discovery before resolving discoverAll.
        pendingDiscoverDescsRemaining[id] = (pendingDiscoverDescsRemaining[id] ?? 0) + 1
        peripheral.discoverDescriptors(for: ch)
      }
    }
    servicesByDevice[id] = peripheral.services ?? []
    guard var remaining = pendingDiscoverCharsRemaining[id] else { return }
    remaining -= 1
    if remaining <= 0 {
      pendingDiscoverCharsRemaining.removeValue(forKey: id)
    } else {
      pendingDiscoverCharsRemaining[id] = remaining
    }
    tryResolveDiscover(deviceId: id, peripheral: peripheral)
  }

  public func peripheral(_ peripheral: CBPeripheral, didDiscoverDescriptorsFor characteristic: CBCharacteristic, error: Error?) {
    let id = peripheral.identifier.uuidString
    if error == nil {
      for d in characteristic.descriptors ?? [] {
        _ = idForDescriptor(d)
      }
    }
    if var remaining = pendingDiscoverDescsRemaining[id] {
      remaining -= 1
      if remaining <= 0 {
        pendingDiscoverDescsRemaining.removeValue(forKey: id)
      } else {
        pendingDiscoverDescsRemaining[id] = remaining
      }
    }
    tryResolveDiscover(deviceId: id, peripheral: peripheral)
  }

  /// Apple: peripheral removed/added services — app must rediscover after this.
  /// Honest path (R2-F071): clear caches + emit ServicesChangedEvent; do NOT auto-discover
  /// (avoids stealing user pendingDiscover counters).
  /// https://developer.apple.com/documentation/corebluetooth/cbperipheraldelegate/peripheral(_:didmodifyservices:)
  public func peripheral(_ peripheral: CBPeripheral, didModifyServices invalidatedServices: [CBService]) {
    let id = peripheral.identifier.uuidString
    _ = invalidatedServices // host rediscovers via onServicesReset / discoverAll
    clearCachesForDevice(id)
    // Fail in-flight user discover so it cannot resolve against a partial tree.
    if let pending = pendingDiscover.removeValue(forKey: id) {
      pendingDiscoverCharsRemaining.removeValue(forKey: id)
      pendingDiscoverDescsRemaining.removeValue(forKey: id)
      clearDiscoverTx(forDevice: id)
      pending.1("BlePlxError", jsonError(code: 300, message: "Services modified — rediscover required"), nil)
    }
    // Stable event name matches BleEvent.servicesChangedEvent / JS "ServicesChangedEvent"
    delegate?.dispatchEvent(BleEvent.servicesChangedEvent, value: id)
    // R2-F071: do not auto-rediscover here — host owns rediscover via discoverAll / onServicesReset.
  }

  /// R2-F019: surface CCCD enable failures; settle monitor promise.
  public func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
    let id = peripheral.identifier.uuidString
    let key = charKey(id, characteristic)
    let js = characteristicJs(characteristic, deviceId: id, service: characteristic.service, value: characteristic.value)

    if let error = error {
      let errJson = jsonError(code: 403, message: error.localizedDescription)
      if let pending = pendingMonitorEnable.removeValue(forKey: key) {
        pending.1("BlePlxError", errJson, nsError(error))
      }
      if let tx = monitors.removeValue(forKey: key) {
        monitorNotifyCache.removeValue(forKey: key)
        delegate?.dispatchEvent(BleEvent.readEvent, value: [errJson, js, tx])
      }
      return
    }

    if let pending = pendingMonitorEnable.removeValue(forKey: key) {
      pending.0(nil)
    }
  }

  public func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor descriptor: CBDescriptor, error: Error?) {
    let id = peripheral.identifier.uuidString
    guard let ch = descriptor.characteristic, let service = ch.service else { return }
    let js = descriptorJs(descriptor, deviceId: id, characteristic: ch, service: service)
    let key = descKey(id, descriptor)
    if let tx = pendingDescReadByDesc.removeValue(forKey: key),
       let (resolve, reject) = pendingDescRead.removeValue(forKey: tx) {
      if let error = error {
        reject("BlePlxError", jsonError(code: 502, message: error.localizedDescription), nsError(error))
      } else {
        resolve(js)
      }
    }
  }

  public func peripheral(_ peripheral: CBPeripheral, didWriteValueFor descriptor: CBDescriptor, error: Error?) {
    let id = peripheral.identifier.uuidString
    guard let ch = descriptor.characteristic, let service = ch.service else { return }
    let js = descriptorJs(descriptor, deviceId: id, characteristic: ch, service: service)
    let key = descKey(id, descriptor)
    if let tx = pendingDescWriteByDesc.removeValue(forKey: key),
       let (resolve, reject) = pendingDescWrite.removeValue(forKey: tx) {
      if let error = error {
        reject("BlePlxError", jsonError(code: 501, message: error.localizedDescription), nsError(error))
      } else {
        resolve(js)
      }
    }
  }

  public func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
    let id = peripheral.identifier.uuidString
    let key = charKey(id, characteristic)
    // Completes outstanding reads first (matched by characteristic identity → transactionId)
    if let tx = pendingReadByChar.removeValue(forKey: key),
       let (resolve, reject) = pendingRead.removeValue(forKey: tx) {
      let js = characteristicJs(characteristic, deviceId: id, service: characteristic.service, value: characteristic.value)
      if let error = error {
        reject("BlePlxError", jsonError(code: 402, message: error.localizedDescription), nsError(error))
      } else {
        resolve(js)
      }
      return
    }
    // Notifications — prefer cached ids (R2-F074).
    if let cache = monitorNotifyCache[key] {
      let js = characteristicJsFromCache(cache, characteristic: characteristic, value: characteristic.value)
      let payload: [Any] = error.map { [jsonError(code: 402, message: $0.localizedDescription), js, cache.transactionId] }
        ?? [NSNull(), js, cache.transactionId]
      delegate?.dispatchEvent(BleEvent.readEvent, value: payload)
      return
    }
    if let tx = monitors[key] {
      let js = characteristicJs(characteristic, deviceId: id, service: characteristic.service, value: characteristic.value)
      let payload: [Any] = error.map { [jsonError(code: 402, message: $0.localizedDescription), js, tx] }
        ?? [NSNull(), js, tx]
      delegate?.dispatchEvent(BleEvent.readEvent, value: payload)
    }
  }

  public func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
    let id = peripheral.identifier.uuidString
    let js = characteristicJs(characteristic, deviceId: id, service: characteristic.service, value: characteristic.value)
    let key = charKey(id, characteristic)
    if let tx = pendingWriteByChar.removeValue(forKey: key),
       let (resolve, reject) = pendingWrite.removeValue(forKey: tx) {
      if let error = error {
        reject("BlePlxError", jsonError(code: 401, message: error.localizedDescription), nsError(error))
      } else {
        resolve(js)
      }
    }
  }

  public func peripheral(_ peripheral: CBPeripheral, didReadRSSI RSSI: NSNumber, error: Error?) {
    let id = peripheral.identifier.uuidString
    guard let pending = pendingRssi.removeValue(forKey: id) else { return }
    pendingRssiByTx = pendingRssiByTx.filter { $0.value != id }
    if let error = error {
      pending.1("BlePlxError", jsonError(code: 202, message: error.localizedDescription), nsError(error))
      return
    }
    lastRssiByDevice[id] = RSSI.intValue
    var js = deviceJs(peripheral)
    js["rssi"] = RSSI
    pending.0(js)
  }

  // MARK: - Helpers

  private func nextId() -> Double {
    idCounter += 1
    return idCounter
  }

  /// Reject expects NSError?; CoreBluetooth callbacks surface Error.
  private func nsError(_ error: Error?) -> NSError? {
    guard let error = error else { return nil }
    return error as NSError
  }

  private func stateString(_ state: CBManagerState) -> String {
    switch state {
    case .poweredOn: return "PoweredOn"
    case .poweredOff: return "PoweredOff"
    case .resetting: return "Resetting"
    case .unauthorized: return "Unauthorized"
    case .unsupported: return "Unsupported"
    case .unknown: return "Unknown"
    @unknown default: return "Unknown"
    }
  }

  /// Negotiated ATT MTU when connected (3.x `Peripheral.mtu` parity).
  ///
  /// ATT MTU = `maximumWriteValueLength(for: .withoutResponse) + 3` (ATT opcode + handle).
  /// iOS cannot request MTU; `requestMTUForDevice` is reporting-only (no negotiation).
  /// Callers use `device.mtu - 3` as the honest long-write chunk size after connect.
  private func mtuFor(_ p: CBPeripheral) -> Int {
    // BLE default ATT_MTU before exchange / when not connected.
    let defaultAttMtu = 23
    guard p.state == .connected else { return defaultAttMtu }
    let payload = p.maximumWriteValueLength(for: .withoutResponse)
    // Guard against pre-ready zero: never report sub-default MTU for long-write sizing.
    return max(payload + 3, defaultAttMtu)
  }

  private func deviceJs(_ p: CBPeripheral) -> [String: Any] {
    let id = p.identifier.uuidString
    let rssiValue: Any = lastRssiByDevice[id].map { $0 as Any } ?? NSNull()
    return [
      "id": id,
      "name": p.name as Any,
      "rssi": rssiValue,
      // Connected: negotiated ATT MTU. Disconnected/scanning: BLE default 23 (via mtuFor).
      "mtu": mtuFor(p),
      "manufacturerData": NSNull(),
      "rawScanRecord": "",
      "serviceData": NSNull(),
      "serviceUUIDs": NSNull(),
      "localName": NSNull(),
      "txPowerLevel": NSNull(),
      "solicitedServiceUUIDs": NSNull(),
      "isConnectable": true,
      "overflowServiceUUIDs": NSNull()
    ]
  }

  /// Port of 3.x ScannedPeripheral.asJSObject advertisement mapping (BleExtensions.swift).
  private func applyAdvertisementFields(_ advertisementData: [String: Any], to device: inout [String: Any]) {
    if let mfg = advertisementData[CBAdvertisementDataManufacturerDataKey] as? Data {
      device["manufacturerData"] = mfg.base64EncodedString()
    } else {
      device["manufacturerData"] = NSNull()
    }

    if let serviceData = advertisementData[CBAdvertisementDataServiceDataKey] as? [CBUUID: Data] {
      var map = [String: String]()
      for (uuid, data) in serviceData {
        map[fullUUIDString(uuid)] = data.base64EncodedString()
      }
      device["serviceData"] = map
    } else {
      device["serviceData"] = NSNull()
    }

    if let uuids = advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] {
      device["serviceUUIDs"] = uuids.map { fullUUIDString($0) }
    } else {
      device["serviceUUIDs"] = NSNull()
    }

    if let tx = advertisementData[CBAdvertisementDataTxPowerLevelKey] as? NSNumber {
      device["txPowerLevel"] = tx
    } else {
      device["txPowerLevel"] = NSNull()
    }

    if let connectable = advertisementData[CBAdvertisementDataIsConnectable] as? NSNumber {
      device["isConnectable"] = connectable.boolValue
    } else {
      device["isConnectable"] = NSNull()
    }

    if let solicited = advertisementData[CBAdvertisementDataSolicitedServiceUUIDsKey] as? [CBUUID] {
      device["solicitedServiceUUIDs"] = solicited.map { fullUUIDString($0) }
    } else {
      device["solicitedServiceUUIDs"] = NSNull()
    }

    if let overflow = advertisementData[CBAdvertisementDataOverflowServiceUUIDsKey] as? [CBUUID] {
      device["overflowServiceUUIDs"] = overflow.map { fullUUIDString($0) }
    } else {
      device["overflowServiceUUIDs"] = NSNull()
    }

    // 3.x rawScanRecord is base64(JSON of the JS device adv shape).
    let advForRaw: [String: Any] = [
      "id": device["id"] as Any,
      "name": device["name"] as Any,
      "rssi": device["rssi"] as Any,
      "mtu": device["mtu"] as Any,
      "localName": device["localName"] as Any,
      "manufacturerData": device["manufacturerData"] as Any,
      "serviceData": device["serviceData"] as Any,
      "serviceUUIDs": device["serviceUUIDs"] as Any,
      "txPowerLevel": device["txPowerLevel"] as Any,
      "isConnectable": device["isConnectable"] as Any,
      "solicitedServiceUUIDs": device["solicitedServiceUUIDs"] as Any,
      "overflowServiceUUIDs": device["overflowServiceUUIDs"] as Any
    ]
    if let data = try? JSONSerialization.data(withJSONObject: advForRaw, options: []) {
      device["rawScanRecord"] = data.base64EncodedString()
    } else {
      device["rawScanRecord"] = ""
    }
  }

  private func fullUUIDString(_ uuid: CBUUID) -> String {
    let native = uuid.uuidString.lowercased()
    if native.count == 4 {
      return "0000\(native)-0000-1000-8000-00805f9b34fb"
    }
    if native.count == 8 {
      return "\(native)-0000-1000-8000-00805f9b34fb"
    }
    return native
  }

  private func serviceJs(_ s: CBService, deviceId: String) -> [String: Any] {
    let sid = idForService(s)
    return [
      "id": sid,
      "uuid": s.uuid.uuidString.lowercased(),
      "deviceID": deviceId,
      "isPrimary": s.isPrimary
    ]
  }

  private func characteristicJs(_ ch: CBCharacteristic, deviceId: String, service: CBService?, value: Data? = nil) -> [String: Any] {
    let cid = idForCharacteristic(ch)
    let props = ch.properties
    let val = value ?? ch.value
    let resolvedServiceId: Any = {
      guard let svc = service else { return NSNull() }
      return idForService(svc)
    }()
    return [
      "id": cid,
      "uuid": ch.uuid.uuidString.lowercased(),
      "serviceID": resolvedServiceId,
      "serviceUUID": (service?.uuid.uuidString ?? "").lowercased(),
      "deviceID": deviceId,
      "isReadable": props.contains(.read),
      "isWritableWithResponse": props.contains(.write),
      "isWritableWithoutResponse": props.contains(.writeWithoutResponse),
      "isNotifiable": props.contains(.notify),
      "isNotifying": ch.isNotifying,
      "isIndicatable": props.contains(.indicate),
      "value": (val?.base64EncodedString()).map { $0 as Any } ?? NSNull()
    ]
  }

  /// Hot-path notify builder using cached numeric ids (R2-F074).
  private func characteristicJsFromCache(
    _ cache: MonitorNotifyCache,
    characteristic: CBCharacteristic,
    value: Data?
  ) -> [String: Any] {
    let val = value ?? characteristic.value
    return [
      "id": cache.charId,
      "uuid": cache.uuid,
      "serviceID": cache.serviceId,
      "serviceUUID": cache.serviceUUID,
      "deviceID": cache.deviceID,
      "isReadable": cache.isReadable,
      "isWritableWithResponse": cache.isWritableWithResponse,
      "isWritableWithoutResponse": cache.isWritableWithoutResponse,
      "isNotifiable": cache.isNotifiable,
      "isNotifying": characteristic.isNotifying,
      "isIndicatable": cache.isIndicatable,
      "value": (val?.base64EncodedString()).map { $0 as Any } ?? NSNull()
    ]
  }

  private func charKey(_ deviceId: String, _ ch: CBCharacteristic) -> String {
    "\(deviceId)::\(ch.uuid.uuidString)"
  }

  private func descKey(_ deviceId: String, _ d: CBDescriptor) -> String {
    let chUUID = d.characteristic?.uuid.uuidString ?? "?"
    return "\(deviceId)::\(chUUID)::\(d.uuid.uuidString)"
  }

  private func tryResolveDiscover(deviceId id: String, peripheral: CBPeripheral) {
    let charsLeft = pendingDiscoverCharsRemaining[id] ?? 0
    let descsLeft = pendingDiscoverDescsRemaining[id] ?? 0
    // Only resolve when both characteristic and descriptor phases are done *and* a discover is pending.
    guard pendingDiscover[id] != nil else { return }
    guard charsLeft <= 0 && descsLeft <= 0 else { return }
    pendingDiscoverCharsRemaining.removeValue(forKey: id)
    pendingDiscoverDescsRemaining.removeValue(forKey: id)
    clearDiscoverTx(forDevice: id)
    pendingDiscover.removeValue(forKey: id)?.0(deviceJs(peripheral))
  }

  private func clearDiscoverTx(forDevice deviceId: String) {
    pendingDiscoverByTx = pendingDiscoverByTx.filter { $0.value != deviceId }
  }

  private func disableNotify(forCharKey key: String) {
    // key format: deviceId::characteristicUUID
    guard let range = key.range(of: "::") else { return }
    let deviceId = String(key[..<range.lowerBound])
    let charUUID = String(key[range.upperBound...])
    guard let p = peripherals[deviceId],
          let services = servicesByDevice[deviceId] else { return }
    for s in services {
      if let ch = s.characteristics?.first(where: { $0.uuid == CBUUID(string: charUUID) }) {
        p.setNotifyValue(false, for: ch)
        return
      }
    }
  }

  private func descriptorJs(
    _ d: CBDescriptor,
    deviceId: String,
    characteristic: CBCharacteristic,
    service: CBService
  ) -> [String: Any] {
    let did = idForDescriptor(d)
    let cid = idForCharacteristic(characteristic)
    let sid = idForService(service)
    let valueBase64: Any = {
      if let data = d.value as? Data {
        return data.base64EncodedString()
      }
      if let s = d.value as? String, let data = s.data(using: .utf8) {
        return data.base64EncodedString()
      }
      if let n = d.value as? NSNumber {
        var v = n.uint16Value
        return Data(bytes: &v, count: MemoryLayout<UInt16>.size).base64EncodedString()
      }
      return NSNull()
    }()
    return [
      "id": did,
      "uuid": d.uuid.uuidString.lowercased(),
      "characteristicID": cid,
      "characteristicUUID": characteristic.uuid.uuidString.lowercased(),
      "serviceID": sid,
      "serviceUUID": service.uuid.uuidString.lowercased(),
      "deviceID": deviceId,
      "value": valueBase64
    ]
  }

  // MARK: - Stable id maps (R2-F070 / R2-F074)

  @discardableResult
  private func idForService(_ s: CBService) -> Double {
    let oid = ObjectIdentifier(s)
    if let existing = serviceIdByObject[oid] {
      serviceIds[existing] = s
      return existing
    }
    if let existing = serviceIds.first(where: { $0.value === s })?.key {
      serviceIdByObject[oid] = existing
      return existing
    }
    let sid = nextId()
    serviceIds[sid] = s
    serviceIdByObject[oid] = sid
    return sid
  }

  @discardableResult
  private func idForCharacteristic(_ ch: CBCharacteristic) -> Double {
    let oid = ObjectIdentifier(ch)
    if let existing = charIdByObject[oid] {
      charIds[existing] = ch
      return existing
    }
    if let existing = charIds.first(where: { $0.value === ch })?.key {
      charIdByObject[oid] = existing
      return existing
    }
    let cid = nextId()
    charIds[cid] = ch
    charIdByObject[oid] = cid
    return cid
  }

  @discardableResult
  private func idForDescriptor(_ d: CBDescriptor) -> Double {
    let oid = ObjectIdentifier(d)
    if let existing = descriptorIdByObject[oid] {
      descriptorIds[existing] = d
      return existing
    }
    if let existing = descriptorIds.first(where: { $0.value === d })?.key {
      descriptorIdByObject[oid] = existing
      return existing
    }
    let did = nextId()
    descriptorIds[did] = d
    descriptorIdByObject[oid] = did
    return did
  }

  private func pruneServiceIds(forDevice deviceId: String, keeping services: [CBService]) {
    let live = Set(services.map { ObjectIdentifier($0) })
    var removeKeys = [Double]()
    for (key, s) in serviceIds {
      guard s.peripheral?.identifier.uuidString == deviceId else { continue }
      if !live.contains(ObjectIdentifier(s)) {
        removeKeys.append(key)
        serviceIdByObject.removeValue(forKey: ObjectIdentifier(s))
      }
    }
    for key in removeKeys {
      serviceIds.removeValue(forKey: key)
    }
  }

  // MARK: - Connect helpers (R2-F017 / R2-F018)

  private func retrieveAndCache(_ deviceIdentifier: String) -> CBPeripheral? {
    guard let uuid = UUID(uuidString: deviceIdentifier) else { return nil }
    let known = central.retrievePeripherals(withIdentifiers: [uuid])
    guard let p = known.first else { return nil }
    peripherals[deviceIdentifier] = p
    p.delegate = self
    return p
  }

  private func cancelConnectTimeout(_ deviceIdentifier: String) {
    connectTimeouts.removeValue(forKey: deviceIdentifier)?.cancel()
  }

  // MARK: - Teardown (R2-F069)

  /// Reject outstanding promises, disable monitors, and clear service/char/descriptor caches for a device.
  private func tearDownDevice(_ deviceId: String) {
    cancelConnectTimeout(deviceId)
    let cancelled = jsonError(code: 2, message: "Operation cancelled")
    let disconnected = jsonError(code: 201, message: "Device disconnected")

    if let pending = pendingConnect.removeValue(forKey: deviceId) {
      pending.1("BlePlxError", cancelled, nil)
    }
    if let pending = pendingDiscover.removeValue(forKey: deviceId) {
      pendingDiscoverCharsRemaining.removeValue(forKey: deviceId)
      pendingDiscoverDescsRemaining.removeValue(forKey: deviceId)
      clearDiscoverTx(forDevice: deviceId)
      pending.1("BlePlxError", disconnected, nil)
    }
    if let pending = pendingRssi.removeValue(forKey: deviceId) {
      pendingRssiByTx = pendingRssiByTx.filter { $0.value != deviceId }
      pending.1("BlePlxError", disconnected, nil)
    }

    // Reads/writes keyed by char/desc for this device.
    let readTxs = pendingReadByChar.filter { $0.key.hasPrefix("\(deviceId)::") }.map { $0.value }
    for tx in readTxs {
      pendingReadByChar = pendingReadByChar.filter { $0.value != tx }
      if let (_, reject) = pendingRead.removeValue(forKey: tx) {
        reject("BlePlxError", disconnected, nil)
      }
    }
    let writeTxs = pendingWriteByChar.filter { $0.key.hasPrefix("\(deviceId)::") }.map { $0.value }
    for tx in writeTxs {
      pendingWriteByChar = pendingWriteByChar.filter { $0.value != tx }
      if let (_, reject) = pendingWrite.removeValue(forKey: tx) {
        reject("BlePlxError", disconnected, nil)
      }
    }
    let descReadTxs = pendingDescReadByDesc.filter { $0.key.hasPrefix("\(deviceId)::") }.map { $0.value }
    for tx in descReadTxs {
      pendingDescReadByDesc = pendingDescReadByDesc.filter { $0.value != tx }
      if let (_, reject) = pendingDescRead.removeValue(forKey: tx) {
        reject("BlePlxError", disconnected, nil)
      }
    }
    let descWriteTxs = pendingDescWriteByDesc.filter { $0.key.hasPrefix("\(deviceId)::") }.map { $0.value }
    for tx in descWriteTxs {
      pendingDescWriteByDesc = pendingDescWriteByDesc.filter { $0.value != tx }
      if let (_, reject) = pendingDescWrite.removeValue(forKey: tx) {
        reject("BlePlxError", disconnected, nil)
      }
    }

    // Monitors for this device.
    let monitorKeys = monitors.keys.filter { $0.hasPrefix("\(deviceId)::") }
    for key in monitorKeys {
      if let pending = pendingMonitorEnable.removeValue(forKey: key) {
        pending.1("BlePlxError", disconnected, nil)
      }
      monitors.removeValue(forKey: key)
      monitorNotifyCache.removeValue(forKey: key)
      disableNotify(forCharKey: key)
    }

    clearCachesForDevice(deviceId)
  }

  private func clearCachesForDevice(_ deviceId: String) {
    servicesByDevice.removeValue(forKey: deviceId)

    let doomedServices = serviceIds.filter { _, s in
      s.peripheral?.identifier.uuidString == deviceId
    }
    for (key, s) in doomedServices {
      serviceIds.removeValue(forKey: key)
      serviceIdByObject.removeValue(forKey: ObjectIdentifier(s))
    }

    let doomedChars = charIds.filter { _, ch in
      ch.service?.peripheral?.identifier.uuidString == deviceId
    }
    for (key, ch) in doomedChars {
      charIds.removeValue(forKey: key)
      charIdByObject.removeValue(forKey: ObjectIdentifier(ch))
    }

    let doomedDescs = descriptorIds.filter { _, d in
      d.characteristic?.service?.peripheral?.identifier.uuidString == deviceId
    }
    for (key, d) in doomedDescs {
      descriptorIds.removeValue(forKey: key)
      descriptorIdByObject.removeValue(forKey: ObjectIdentifier(d))
    }
  }

  // MARK: - Restore amb (R2-F016)

  private func emitRestoreStateEvent(_ value: Any) {
    guard !restoreEventEmitted else { return }
    restoreEventEmitted = true
    restoreAmbActive = false
    if let delegate = delegate {
      delegate.dispatchEvent(BleEvent.restoreStateEvent, value: value)
    } else {
      bufferedRestoreEvent = value
    }
  }

  private func flushBufferedRestoreStateEvent() {
    guard let value = bufferedRestoreEvent, let delegate = delegate else { return }
    bufferedRestoreEvent = nil
    delegate.dispatchEvent(BleEvent.restoreStateEvent, value: value)
  }

  // MARK: - Bundled early central (R2-F020)

  #if os(iOS)
  /// Adopt BlePlxBundledRestorationRegistry's early-wake CBCentralManager when present.
  private static func takeBundledEarlyCentral() -> CBCentralManager? {
    guard
      let registryCls = NSClassFromString("BlePlxBundledRestorationRegistry") as? NSObject.Type,
      registryCls.responds(to: NSSelectorFromString("shared")),
      let shared = registryCls.perform(NSSelectorFromString("shared"))?.takeUnretainedValue() as? NSObject,
      shared.responds(to: NSSelectorFromString("takeEarlyCentral"))
    else {
      return nil
    }
    return shared.perform(NSSelectorFromString("takeEarlyCentral"))?.takeUnretainedValue() as? CBCentralManager
  }
  #endif

  private func jsonError(code: Int, message: String) -> String {
    let dict: [String: Any] = [
      "errorCode": code,
      "attErrorCode": NSNull(),
      "iosErrorCode": NSNull(),
      "androidErrorCode": NSNull(),
      "reason": message,
      "internalMessage": message
    ]
    if let data = try? JSONSerialization.data(withJSONObject: dict),
       let s = String(data: data, encoding: .utf8) {
      return s
    }
    return "{\"errorCode\":\(code)}"
  }
}
