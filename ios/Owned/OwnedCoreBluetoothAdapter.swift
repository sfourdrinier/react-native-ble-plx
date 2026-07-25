import Foundation
import CoreBluetooth

/**
 * 4.0 owned CoreBluetooth central — pure Swift, no RxBluetoothKit / MultiplatformBleAdapter runtime.
 * Implements BleAdapter so BlePlx.mm can use it as the default factory product.
 */
@objc
public class OwnedCoreBluetoothAdapter: NSObject, BleAdapter, CBCentralManagerDelegate, CBPeripheralDelegate {

  public static let adapterId = "owned-corebluetooth-v1"

  public weak var delegate: BleClientManagerDelegate?

  private let queue: DispatchQueue
  private var central: CBCentralManager!
  private var restoreKey: String?
  private var peripherals = [String: CBPeripheral]()
  private var servicesByDevice = [String: [CBService]]()
  private var idCounter: Double = 1
  private var serviceIds = [Double: CBService]()
  private var charIds = [Double: CBCharacteristic]()
  private var pendingConnect: [String: (Resolve, Reject)] = [:]
  private var pendingDiscover: [String: (Resolve, Reject)] = [:]
  /// Remaining service characteristic discoveries before pendingDiscover may resolve.
  private var pendingDiscoverCharsRemaining: [String: Int] = [:]
  private var pendingRead: [String: (Resolve, Reject)] = [:]
  private var pendingWrite: [String: (Resolve, Reject)] = [:]
  private var monitors = [String: String]() // charKey -> transactionId
  private var logLevel = "None"

  public required init(queue: DispatchQueue, restoreIdentifierKey: String?) {
    self.queue = queue
    self.restoreKey = restoreIdentifierKey
    super.init()
    var options: [String: Any] = [:]
    #if os(iOS)
    if let key = restoreIdentifierKey, !key.isEmpty {
      options[CBCentralManagerOptionRestoreIdentifierKey] = key
    }
    #endif
    self.central = CBCentralManager(delegate: self, queue: queue, options: options.isEmpty ? nil : options)
  }

  public func invalidate() {
    central.stopScan()
    for p in peripherals.values {
      if p.state == .connected || p.state == .connecting {
        central.cancelPeripheralConnection(p)
      }
    }
    peripherals.removeAll()
    servicesByDevice.removeAll()
    pendingConnect.removeAll()
  }

  public func cancelTransaction(_ transactionId: String) {
    // Best-effort; CoreBluetooth operations are not all cancelable
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
    p.readRSSI()
    resolve(deviceJs(p))
  }

  public func requestMTUForDevice(_ deviceIdentifier: String, mtu: Int, transactionId: String, resolve: @escaping Resolve, reject: @escaping Reject) {
    guard let p = peripherals[deviceIdentifier] else {
      reject("BlePlxError", jsonError(code: 204, message: "Device not found"), nil)
      return
    }
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
    let connected = peripherals.values.filter { $0.state == .connected }.map { deviceJs($0) }
    resolve(connected)
  }

  public func connectToDevice(_ deviceIdentifier: String, options: [String: AnyObject]?, resolve: @escaping Resolve, reject: @escaping Reject) {
    guard let p = peripherals[deviceIdentifier] else {
      // Try retrieve
      if let uuid = UUID(uuidString: deviceIdentifier) {
        let known = central.retrievePeripherals(withIdentifiers: [uuid])
        if let p2 = known.first {
          peripherals[deviceIdentifier] = p2
          p2.delegate = self
          pendingConnect[deviceIdentifier] = (resolve, reject)
          central.connect(p2, options: nil)
          return
        }
      }
      reject("BlePlxError", jsonError(code: 204, message: "Device not found"), nil)
      return
    }
    p.delegate = self
    pendingConnect[deviceIdentifier] = (resolve, reject)
    central.connect(p, options: nil)
  }

  public func cancelDeviceConnection(_ deviceIdentifier: String, resolve: @escaping Resolve, reject: @escaping Reject) {
    guard let p = peripherals[deviceIdentifier] else {
      reject("BlePlxError", jsonError(code: 204, message: "Device not found"), nil)
      return
    }
    central.cancelPeripheralConnection(p)
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
    resolve([])
  }

  public func descriptorsForService(_ serviceIdentifier: Double, characteristicUUID: String, resolve: Resolve, reject: Reject) {
    resolve([])
  }

  public func descriptorsForCharacteristic(_ characteristicIdentifier: Double, resolve: Resolve, reject: Reject) {
    resolve([])
  }

  public func readCharacteristicForDevice(_ deviceIdentifier: String, serviceUUID: String, characteristicUUID: String, transactionId: String, resolve: @escaping Resolve, reject: @escaping Reject) {
    guard let p = peripherals[deviceIdentifier],
          let service = servicesByDevice[deviceIdentifier]?.first(where: { $0.uuid == CBUUID(string: serviceUUID) }),
          let ch = service.characteristics?.first(where: { $0.uuid == CBUUID(string: characteristicUUID) }) else {
      reject("BlePlxError", jsonError(code: 404, message: "Characteristic not found"), nil)
      return
    }
    pendingRead[transactionId] = (resolve, reject)
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
    pendingRead[transactionId] = (resolve, reject)
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
    pendingWrite[transactionId] = (resolve, reject)
    p.writeValue(data, for: ch, type: response ? .withResponse : .withoutResponse)
    if !response {
      // withoutResponse may not callback
      pendingWrite.removeValue(forKey: transactionId)
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
    monitors[charKey(deviceIdentifier, ch)] = transactionId
    p.setNotifyValue(true, for: ch)
    resolve(nil)
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
    reject("BlePlxError", jsonError(code: 503, message: "descriptor not found"), nil)
  }

  public func readDescriptorForService(_ serviceId: Double, characteristicUUID: String, descriptorUUID: String, transactionId: String, resolve: @escaping Resolve, reject: @escaping Reject) {
    reject("BlePlxError", jsonError(code: 503, message: "descriptor not found"), nil)
  }

  public func readDescriptorForCharacteristic(_ characteristicID: Double, descriptorUUID: String, transactionId: String, resolve: @escaping Resolve, reject: @escaping Reject) {
    reject("BlePlxError", jsonError(code: 503, message: "descriptor not found"), nil)
  }

  public func readDescriptor(_ descriptorID: Double, transactionId: String, resolve: @escaping Resolve, reject: @escaping Reject) {
    reject("BlePlxError", jsonError(code: 503, message: "descriptor not found"), nil)
  }

  public func writeDescriptorForDevice(_ deviceIdentifier: String, serviceUUID: String, characteristicUUID: String, descriptorUUID: String, valueBase64: String, transactionId: String, resolve: @escaping Resolve, reject: @escaping Reject) {
    reject("BlePlxError", jsonError(code: 501, message: "descriptor write failed"), nil)
  }

  public func writeDescriptorForService(_ serviceID: Double, characteristicUUID: String, descriptorUUID: String, valueBase64: String, transactionId: String, resolve: @escaping Resolve, reject: @escaping Reject) {
    reject("BlePlxError", jsonError(code: 501, message: "descriptor write failed"), nil)
  }

  public func writeDescriptorForCharacteristic(_ characteristicID: Double, descriptorUUID: String, valueBase64: String, transactionId: String, resolve: @escaping Resolve, reject: @escaping Reject) {
    reject("BlePlxError", jsonError(code: 501, message: "descriptor write failed"), nil)
  }

  public func writeDescriptor(_ descriptorID: Double, valueBase64: String, transactionId: String, resolve: @escaping Resolve, reject: @escaping Reject) {
    reject("BlePlxError", jsonError(code: 501, message: "descriptor write failed"), nil)
  }

  // MARK: - CBCentralManagerDelegate

  public func centralManagerDidUpdateState(_ central: CBCentralManager) {
    delegate?.dispatchEvent(BleEvent.stateChangeEvent, value: stateString(central.state))
  }

  public func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
    let id = peripheral.identifier.uuidString
    peripherals[id] = peripheral
    peripheral.delegate = self
    var device = deviceJs(peripheral)
    device["rssi"] = RSSI
    device["name"] = peripheral.name ?? (advertisementData[CBAdvertisementDataLocalNameKey] as? String)
    device["localName"] = advertisementData[CBAdvertisementDataLocalNameKey] as? String
    device["isConnectable"] = true
    device["manufacturerData"] = NSNull()
    device["rawScanRecord"] = ""
    device["serviceData"] = NSNull()
    device["serviceUUIDs"] = NSNull()
    device["txPowerLevel"] = NSNull()
    device["solicitedServiceUUIDs"] = NSNull()
    device["overflowServiceUUIDs"] = NSNull()
    device["mtu"] = 23
    delegate?.dispatchEvent(BleEvent.scanEvent, value: [NSNull(), device])
  }

  public func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    let id = peripheral.identifier.uuidString
    if let pending = pendingConnect.removeValue(forKey: id) {
      pending.0(deviceJs(peripheral))
    }
  }

  public func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
    let id = peripheral.identifier.uuidString
    if let pending = pendingConnect.removeValue(forKey: id) {
      pending.1("BlePlxError", jsonError(code: 200, message: error?.localizedDescription ?? "connect failed"), nsError(error))
    }
  }

  public func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
    let err: Any = error.map { jsonError(code: 201, message: $0.localizedDescription) } ?? NSNull()
    delegate?.dispatchEvent(BleEvent.disconnectionEvent, value: [err, deviceJs(peripheral)])
  }

  // MARK: - CBPeripheralDelegate

  public func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    let id = peripheral.identifier.uuidString
    if let error = error {
      pendingDiscoverCharsRemaining.removeValue(forKey: id)
      pendingDiscover.removeValue(forKey: id)?.1("BlePlxError", jsonError(code: 300, message: error.localizedDescription), nsError(error))
      return
    }
    let services = peripheral.services ?? []
    servicesByDevice[id] = services
    for s in services {
      let sid = nextId()
      serviceIds[sid] = s
    }
    // Resolve only after characteristics are discovered for every service (or immediately if none).
    if services.isEmpty {
      pendingDiscoverCharsRemaining.removeValue(forKey: id)
      pendingDiscover.removeValue(forKey: id)?.0(deviceJs(peripheral))
      return
    }
    pendingDiscoverCharsRemaining[id] = services.count
    for s in services {
      peripheral.discoverCharacteristics(nil, for: s)
    }
  }

  public func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
    let id = peripheral.identifier.uuidString
    if error == nil {
      for ch in service.characteristics ?? [] {
        // Keep stable ids: only allocate when characteristic is first seen.
        if charIds.first(where: { $0.value === ch }) == nil {
          let cid = nextId()
          charIds[cid] = ch
        }
      }
    }
    servicesByDevice[id] = peripheral.services ?? []
    guard var remaining = pendingDiscoverCharsRemaining[id] else { return }
    remaining -= 1
    if remaining <= 0 {
      pendingDiscoverCharsRemaining.removeValue(forKey: id)
      // Resolve only after every service has reported characteristics (success or error).
      pendingDiscover.removeValue(forKey: id)?.0(deviceJs(peripheral))
    } else {
      pendingDiscoverCharsRemaining[id] = remaining
    }
  }

  public func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
    let id = peripheral.identifier.uuidString
    let service = characteristic.service
    let js = characteristicJs(characteristic, deviceId: id, service: service, value: characteristic.value)
    // Completes outstanding reads first
    if let (resolve, reject) = pendingRead.values.first {
      if let error = error {
        reject("BlePlxError", jsonError(code: 402, message: error.localizedDescription), nsError(error))
      } else {
        resolve(js)
      }
      if let key = pendingRead.first(where: { $0.value.0 as AnyObject === resolve as AnyObject })?.key {
        pendingRead.removeValue(forKey: key)
      } else {
        pendingRead.removeAll()
      }
      return
    }
    // Notifications
    if let tx = monitors[charKey(id, characteristic)] {
      let payload: [Any] = error.map { [jsonError(code: 402, message: $0.localizedDescription), js, tx] }
        ?? [NSNull(), js, tx]
      delegate?.dispatchEvent(BleEvent.readEvent, value: payload)
    }
  }

  public func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
    let id = peripheral.identifier.uuidString
    let js = characteristicJs(characteristic, deviceId: id, service: characteristic.service, value: characteristic.value)
    if let (resolve, reject) = pendingWrite.values.first {
      if let error = error {
        reject("BlePlxError", jsonError(code: 401, message: error.localizedDescription), nsError(error))
      } else {
        resolve(js)
      }
      pendingWrite.removeAll()
    }
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

  private func deviceJs(_ p: CBPeripheral) -> [String: Any] {
    return [
      "id": p.identifier.uuidString,
      "name": p.name as Any,
      "rssi": NSNull(),
      "mtu": 23,
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

  private func serviceJs(_ s: CBService, deviceId: String) -> [String: Any] {
    let sid = serviceIds.first(where: { $0.value === s })?.key ?? nextId()
    serviceIds[sid] = s
    return [
      "id": sid,
      "uuid": s.uuid.uuidString.lowercased(),
      "deviceID": deviceId,
      "isPrimary": s.isPrimary
    ]
  }

  private func characteristicJs(_ ch: CBCharacteristic, deviceId: String, service: CBService?, value: Data? = nil) -> [String: Any] {
    let cid = charIds.first(where: { $0.value === ch })?.key ?? nextId()
    charIds[cid] = ch
    let props = ch.properties
    let val = value ?? ch.value
    // Must compare dictionary values to the service parameter (outer $0), not the tuple to itself.
    let resolvedServiceId: Any = {
      guard let svc = service else { return NSNull() }
      if let existing = serviceIds.first(where: { $0.value === svc })?.key {
        return existing
      }
      let sid = nextId()
      serviceIds[sid] = svc
      return sid
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

  private func charKey(_ deviceId: String, _ ch: CBCharacteristic) -> String {
    "\(deviceId)::\(ch.uuid.uuidString)"
  }

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
