// ios/Owned/OwnedCoreBluetoothProtocolRadio.swift

import CoreBluetooth
import Foundation

@objc public protocol OwnedCoreBluetoothProtocolRadioDelegate: NSObjectProtocol {
  func protocolRadioDidUpdateAdapterState(_ snapshot: NSDictionary)
  func protocolRadioDidReceiveAdvertisement(_ advertisement: NSDictionary)
  func protocolRadioDidDisconnectPeer(_ peerIdentifier: String, error: NSError?)
  func protocolRadioDidReceiveNotification(_ subscriptionIdentifier: String, value: NSData)
}

/**
 * Direct CoreBluetooth radio façade for Native Protocol v1.
 *
 * Control records cross the JSI boundary in C++, while this class receives and produces native
 * Data only. Every mutable CoreBluetooth object stays confined to its serial radio queue.
 */
@objc(OwnedCoreBluetoothProtocolRadio)
public final class OwnedCoreBluetoothProtocolRadio: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
  private static let maximumBinaryPayloadBytes = 512 * 1024
  private static let radioQueue = DispatchQueue(
    label: "com.sfourdrinier.unifiedblemanager.unified-protocol-radio"
  )

  @objc public weak var delegate: OwnedCoreBluetoothProtocolRadioDelegate?

  private let queue: DispatchQueue
  private var central: CBCentralManager!
  private var peripheralByIdentifier = [String: CBPeripheral]()
  private var servicesByPeer = [String: [CBService]]()
  private var pendingConnect = [String: PendingVoid]()
  /// A disconnect resolves only from CoreBluetooth's terminal delegate callback.
  private var pendingDisconnect = [String: PendingVoid]()
  private var pendingDiscovery = [String: PendingDiscovery]()
  private var pendingRead = [CharacteristicAddress: PendingData]()
  private var pendingRssi = [String: PendingRssi]()
  private var pendingWrite = [CharacteristicAddress: PendingVoid]()
  private var pendingNotify = [CharacteristicAddress: PendingNotify]()
  private var subscriptions = [CharacteristicAddress: String]()
  private var activeScanOperationIdentifier: String?
  private var restoredPeerIdentifiers = [String]()
  private var destroyed = false

  private struct CharacteristicAddress: Hashable {
    let peerIdentifier: String
    let serviceUUID: String
    let serviceOccurrence: Int
    let characteristicUUID: String
    let characteristicOccurrence: Int
  }

  private struct PendingVoid {
    let operationIdentifier: String
    let completion: (NSError?) -> Void
  }

  private struct PendingData {
    let operationIdentifier: String
    let completion: (NSData?, NSError?) -> Void
  }

  private struct PendingRssi {
    let operationIdentifier: String
    let completion: (NSNumber?, NSError?) -> Void
  }

  private struct PendingNotify {
    let operationIdentifier: String
    let subscriptionIdentifier: String
    let enabled: Bool
    let completion: (NSError?) -> Void
  }

  private struct PendingDiscovery {
    let operationIdentifier: String
    let completion: (NSDictionary?, NSError?) -> Void
    var awaitingCharacteristics: Int
    var awaitingDescriptors: Int
  }

  @objc public init(restoreIdentifierKey: String?) {
    queue = Self.radioQueue
    super.init()
    var options = [String: Any]()
    #if os(iOS)
    if let restoreIdentifierKey, !restoreIdentifierKey.isEmpty {
      options[CBCentralManagerOptionRestoreIdentifierKey] = restoreIdentifierKey
    }
    #endif
    central = CBCentralManager(delegate: self, queue: queue, options: options.isEmpty ? nil : options)
  }

  @objc public func adapterSnapshot() -> NSDictionary {
    queue.sync {
      OwnedCoreBluetoothProtocolRadioSupport.adapterSnapshotDictionary(central: central)
    }
  }

  /// Supplies native startup restoration state for canonical protocol-journal append.
  @objc public func restorationPeerIdentifiers() -> [String] {
    queue.sync { restoredPeerIdentifiers }
  }

  /// Consumes only the OS-provided restoration identifiers after an authenticated adoption succeeds.
  @objc public func consumeRestorationPeerIdentifiers() {
    queue.async {
      self.restoredPeerIdentifiers.removeAll()
    }
  }

  /// Releases one JavaScript protocol client while preserving the process-owned restoration central.
  @objc public func releaseProtocolClient(completion: @escaping (NSError?) -> Void) {
    queue.async {
      guard !self.destroyed else {
        completion(self.error(code: 1021, message: "The Native Protocol v1 CoreBluetooth radio was destroyed"))
        return
      }
      self.central.stopScan()
      self.activeScanOperationIdentifier = nil
      self.failAllPendingOperationsOnDestroy()
      self.subscriptions.removeAll()
      let restoredIdentifiers = Set(self.restoredPeerIdentifiers)
      for (identifier, peripheral) in self.peripheralByIdentifier where !restoredIdentifiers.contains(identifier) {
        if peripheral.state == .connected || peripheral.state == .connecting {
          self.central.cancelPeripheralConnection(peripheral)
        }
        peripheral.delegate = nil
      }
      self.peripheralByIdentifier = self.peripheralByIdentifier.filter { restoredIdentifiers.contains($0.key) }
      self.servicesByPeer = self.servicesByPeer.filter { restoredIdentifiers.contains($0.key) }
      completion(nil)
    }
  }

  @objc public func startScan(
    serviceUUIDs: [String],
    allowDuplicates: Bool,
    operationIdentifier: String,
    completion: @escaping (NSError?) -> Void
  ) {
    queue.async {
      guard self.requireUsable(completion) else { return }
      guard self.activeScanOperationIdentifier == nil else {
        completion(self.error(code: 1001, message: "A Native Protocol v1 scan is already active"))
        return
      }
      guard let serviceFilter = OwnedCoreBluetoothProtocolRadioSupport.parseUUIDs(serviceUUIDs) else {
        completion(self.error(code: 1002, message: "A scan service UUID is invalid"))
        return
      }
      guard self.central.state == .poweredOn else {
        completion(self.error(code: 1003, message: "CoreBluetooth is not powered on"))
        return
      }
      self.central.scanForPeripherals(
        withServices: serviceFilter.isEmpty ? nil : serviceFilter,
        options: [CBCentralManagerScanOptionAllowDuplicatesKey: allowDuplicates]
      )
      self.activeScanOperationIdentifier = operationIdentifier
      completion(nil)
    }
  }

  @objc public func stopScan(operationIdentifier: String, completion: @escaping (NSError?) -> Void) {
    queue.async {
      guard self.requireUsable(completion) else { return }
      guard self.activeScanOperationIdentifier != nil else {
        completion(self.error(code: 1004, message: "No Native Protocol v1 scan is active"))
        return
      }
      self.central.stopScan()
      self.activeScanOperationIdentifier = nil
      completion(nil)
    }
  }

  @objc public func connect(
    peerIdentifier: String,
    operationIdentifier: String,
    completion: @escaping (NSError?) -> Void
  ) {
    queue.async {
      guard self.requireUsable(completion) else { return }
      guard let peripheral = self.peripheralByIdentifier[peerIdentifier] else {
        completion(self.error(code: 1005, message: "The requested CoreBluetooth peripheral is unknown"))
        return
      }
      guard self.pendingConnect[peerIdentifier] == nil else {
        completion(self.error(code: 1006, message: "A connection is already pending for this peripheral"))
        return
      }
      peripheral.delegate = self
      if peripheral.state == .connected {
        completion(nil)
        return
      }
      self.pendingConnect[peerIdentifier] = PendingVoid(
        operationIdentifier: operationIdentifier,
        completion: completion
      )
      self.central.connect(peripheral, options: nil)
    }
  }

  @objc public func disconnect(
    peerIdentifier: String,
    operationIdentifier: String,
    completion: @escaping (NSError?) -> Void
  ) {
    queue.async {
      guard self.requireUsable(completion) else { return }
      guard let peripheral = self.peripheralByIdentifier[peerIdentifier] else {
        completion(self.error(code: 1007, message: "The requested CoreBluetooth peripheral is unknown"))
        return
      }
      guard self.pendingDisconnect[peerIdentifier] == nil else {
        completion(self.error(code: 1024, message: "A disconnect is already pending for this peripheral"))
        return
      }
      guard peripheral.state != .disconnected else {
        self.servicesByPeer.removeValue(forKey: peerIdentifier)
        completion(nil)
        return
      }
      self.pendingDisconnect[peerIdentifier] = PendingVoid(
        operationIdentifier: operationIdentifier,
        completion: completion
      )
      self.central.cancelPeripheralConnection(peripheral)
    }
  }

  @objc public func discover(
    peerIdentifier: String,
    operationIdentifier: String,
    completion: @escaping (NSDictionary?, NSError?) -> Void
  ) {
    queue.async {
      guard self.requireUsable({ error in completion(nil, error) }) else { return }
      guard let peripheral = self.peripheralByIdentifier[peerIdentifier], peripheral.state == .connected else {
        completion(nil, self.error(code: 1008, message: "The requested peripheral is not connected"))
        return
      }
      guard self.pendingDiscovery[peerIdentifier] == nil else {
        completion(nil, self.error(code: 1009, message: "A discovery operation is already pending for this peripheral"))
        return
      }
      peripheral.delegate = self
      self.pendingDiscovery[peerIdentifier] = PendingDiscovery(
        operationIdentifier: operationIdentifier,
        completion: completion,
        awaitingCharacteristics: 0,
        awaitingDescriptors: 0
      )
      peripheral.discoverServices(nil)
    }
  }

  @objc public func read(
    peerIdentifier: String,
    serviceUUID: String,
    serviceOccurrence: Int,
    characteristicUUID: String,
    characteristicOccurrence: Int,
    operationIdentifier: String,
    completion: @escaping (NSData?, NSError?) -> Void
  ) {
    queue.async {
      guard self.requireUsable({ error in completion(nil, error) }) else { return }
      let address = CharacteristicAddress(
        peerIdentifier: peerIdentifier,
        serviceUUID: OwnedCoreBluetoothProtocolRadioSupport.normalizedUUID(serviceUUID),
        serviceOccurrence: serviceOccurrence,
        characteristicUUID: OwnedCoreBluetoothProtocolRadioSupport.normalizedUUID(characteristicUUID),
        characteristicOccurrence: characteristicOccurrence
      )
      guard let resolved = self.resolve(address) else {
        completion(nil, self.error(code: 1010, message: "The generation-bound characteristic path is stale"))
        return
      }
      guard self.pendingRead[address] == nil else {
        completion(nil, self.error(code: 1011, message: "A read is already pending for this characteristic"))
        return
      }
      self.pendingRead[address] = PendingData(operationIdentifier: operationIdentifier, completion: completion)
      resolved.peripheral.readValue(for: resolved.characteristic)
    }
  }

  @objc public func readRssi(
    peerIdentifier: String,
    operationIdentifier: String,
    completion: @escaping (NSNumber?, NSError?) -> Void
  ) {
    queue.async {
      guard self.requireUsable({ error in completion(nil, error) }) else { return }
      guard let peripheral = self.peripheralByIdentifier[peerIdentifier], peripheral.state == .connected else {
        completion(nil, self.error(code: 1022, message: "The requested peripheral is not connected"))
        return
      }
      guard self.pendingRssi[peerIdentifier] == nil else {
        completion(nil, self.error(code: 1023, message: "An RSSI read is already pending for this peripheral"))
        return
      }
      peripheral.delegate = self
      self.pendingRssi[peerIdentifier] = PendingRssi(operationIdentifier: operationIdentifier, completion: completion)
      peripheral.readRSSI()
    }
  }

  @objc public func write(
    peerIdentifier: String,
    serviceUUID: String,
    serviceOccurrence: Int,
    characteristicUUID: String,
    characteristicOccurrence: Int,
    value: NSData,
    withResponse: Bool,
    operationIdentifier: String,
    completion: @escaping (NSError?) -> Void
  ) {
    queue.async {
      guard self.requireUsable(completion) else { return }
      guard value.length <= Self.maximumBinaryPayloadBytes else {
        completion(self.error(code: 1012, message: "The native binary payload exceeds the protocol limit"))
        return
      }
      let address = CharacteristicAddress(
        peerIdentifier: peerIdentifier,
        serviceUUID: OwnedCoreBluetoothProtocolRadioSupport.normalizedUUID(serviceUUID),
        serviceOccurrence: serviceOccurrence,
        characteristicUUID: OwnedCoreBluetoothProtocolRadioSupport.normalizedUUID(characteristicUUID),
        characteristicOccurrence: characteristicOccurrence
      )
      guard let resolved = self.resolve(address) else {
        completion(self.error(code: 1013, message: "The generation-bound characteristic path is stale"))
        return
      }
      let writeType: CBCharacteristicWriteType = withResponse ? .withResponse : .withoutResponse
      if withResponse {
        guard self.pendingWrite[address] == nil else {
          completion(self.error(code: 1014, message: "A write is already pending for this characteristic"))
          return
        }
        self.pendingWrite[address] = PendingVoid(operationIdentifier: operationIdentifier, completion: completion)
      }
      resolved.peripheral.writeValue(value as Data, for: resolved.characteristic, type: writeType)
      if !withResponse {
        completion(nil)
      }
    }
  }

  @objc public func subscribe(
    peerIdentifier: String,
    serviceUUID: String,
    serviceOccurrence: Int,
    characteristicUUID: String,
    characteristicOccurrence: Int,
    subscriptionIdentifier: String,
    operationIdentifier: String,
    completion: @escaping (NSError?) -> Void
  ) {
    setNotify(
      peerIdentifier: peerIdentifier,
      serviceUUID: serviceUUID,
      serviceOccurrence: serviceOccurrence,
      characteristicUUID: characteristicUUID,
      characteristicOccurrence: characteristicOccurrence,
      enabled: true,
      subscriptionIdentifier: subscriptionIdentifier,
      operationIdentifier: operationIdentifier,
      completion: completion
    )
  }

  @objc public func unsubscribe(
    peerIdentifier: String,
    serviceUUID: String,
    serviceOccurrence: Int,
    characteristicUUID: String,
    characteristicOccurrence: Int,
    subscriptionIdentifier: String,
    operationIdentifier: String,
    completion: @escaping (NSError?) -> Void
  ) {
    setNotify(
      peerIdentifier: peerIdentifier,
      serviceUUID: serviceUUID,
      serviceOccurrence: serviceOccurrence,
      characteristicUUID: characteristicUUID,
      characteristicOccurrence: characteristicOccurrence,
      enabled: false,
      subscriptionIdentifier: subscriptionIdentifier,
      operationIdentifier: operationIdentifier,
      completion: completion
    )
  }

  @objc public func cancelOperation(_ operationIdentifier: String) {
    queue.async {
      self.cancelPendingOperation(operationIdentifier)
    }
  }

  @objc public func destroy(completion: @escaping (NSError?) -> Void) {
    queue.async {
      guard !self.destroyed else {
        completion(nil)
        return
      }
      self.destroyed = true
      self.central.stopScan()
      self.activeScanOperationIdentifier = nil
      for peripheral in self.peripheralByIdentifier.values where peripheral.state == .connected || peripheral.state == .connecting {
        self.central.cancelPeripheralConnection(peripheral)
        peripheral.delegate = nil
      }
      self.failAllPendingOperationsOnDestroy()
      self.subscriptions.removeAll()
      self.servicesByPeer.removeAll()
      self.peripheralByIdentifier.removeAll()
      self.restoredPeerIdentifiers.removeAll()
      self.central.delegate = nil
      completion(nil)
    }
  }

  public func centralManagerDidUpdateState(_ central: CBCentralManager) {
    delegate?.protocolRadioDidUpdateAdapterState(
      OwnedCoreBluetoothProtocolRadioSupport.adapterSnapshotDictionary(central: central)
    )
  }

  #if os(iOS)
  public func centralManager(_ central: CBCentralManager, willRestoreState dictionary: [String: Any]) {
    let peripherals = (dictionary[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral]) ?? []
    for peripheral in peripherals {
      let identifier = peripheral.identifier.uuidString
      peripheralByIdentifier[identifier] = peripheral
      if !restoredPeerIdentifiers.contains(identifier) {
        restoredPeerIdentifiers.append(identifier)
      }
      peripheral.delegate = self
    }
  }
  #endif

  public func centralManager(
    _ central: CBCentralManager,
    didDiscover peripheral: CBPeripheral,
    advertisementData: [String: Any],
    rssi RSSI: NSNumber
  ) {
    guard activeScanOperationIdentifier != nil else { return }
    let identifier = peripheral.identifier.uuidString
    peripheralByIdentifier[identifier] = peripheral
    peripheral.delegate = self
    delegate?.protocolRadioDidReceiveAdvertisement(OwnedCoreBluetoothProtocolRadioSupport.advertisementDictionary(
      peripheral: peripheral,
      advertisementData: advertisementData,
      rssi: RSSI
    ))
  }

  public func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    let identifier = peripheral.identifier.uuidString
    peripheralByIdentifier[identifier] = peripheral
    peripheral.delegate = self
    if let pending = pendingConnect.removeValue(forKey: identifier) {
      pending.completion(nil)
    }
    if pendingDisconnect[identifier] != nil {
      central.cancelPeripheralConnection(peripheral)
    }
  }

  public func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
    let identifier = peripheral.identifier.uuidString
    let failure = error as NSError? ?? self.error(code: 1015, message: "CoreBluetooth failed to connect")
    if let pending = pendingConnect.removeValue(forKey: identifier) {
      pending.completion(failure)
    }
    if let pending = pendingDisconnect.removeValue(forKey: identifier) {
      pending.completion(nil)
    }
  }

  public func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
    let identifier = peripheral.identifier.uuidString
    let explicitDisconnect = pendingDisconnect.removeValue(forKey: identifier)
    servicesByPeer.removeValue(forKey: identifier)
    if let pending = pendingConnect.removeValue(forKey: identifier) {
      pending.completion(error as NSError? ?? self.error(code: 1015, message: "CoreBluetooth disconnected while connecting"))
    }
    pendingDiscovery.removeValue(forKey: identifier)?.completion(
      nil,
      error as NSError? ?? self.error(code: 1016, message: "CoreBluetooth disconnected during discovery")
    )
    failPendingGATT(for: identifier, error: error as NSError?)
    if let explicitDisconnect {
      explicitDisconnect.completion(nil)
      return
    }
    delegate?.protocolRadioDidDisconnectPeer(identifier, error: error as NSError?)
  }

  public func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    let identifier = peripheral.identifier.uuidString
    guard var pending = pendingDiscovery[identifier] else { return }
    if let error {
      pendingDiscovery.removeValue(forKey: identifier)
      pending.completion(nil, error as NSError)
      return
    }
    let services = peripheral.services ?? []
    servicesByPeer[identifier] = services
    pending.awaitingCharacteristics = services.count
    pendingDiscovery[identifier] = pending
    if services.isEmpty {
      finishDiscoveryIfReady(identifier)
      return
    }
    for service in services {
      peripheral.discoverCharacteristics(nil, for: service)
    }
  }

  public func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
    let identifier = peripheral.identifier.uuidString
    guard var pending = pendingDiscovery[identifier] else { return }
    if let error {
      pendingDiscovery.removeValue(forKey: identifier)
      pending.completion(nil, error as NSError)
      return
    }
    pending.awaitingCharacteristics -= 1
    let characteristics = service.characteristics ?? []
    pending.awaitingDescriptors += characteristics.count
    pendingDiscovery[identifier] = pending
    for characteristic in characteristics {
      peripheral.discoverDescriptors(for: characteristic)
    }
    finishDiscoveryIfReady(identifier)
  }

  public func peripheral(_ peripheral: CBPeripheral, didDiscoverDescriptorsFor characteristic: CBCharacteristic, error: Error?) {
    let identifier = peripheral.identifier.uuidString
    guard var pending = pendingDiscovery[identifier] else { return }
    if let error {
      pendingDiscovery.removeValue(forKey: identifier)
      pending.completion(nil, error as NSError)
      return
    }
    pending.awaitingDescriptors -= 1
    pendingDiscovery[identifier] = pending
    finishDiscoveryIfReady(identifier)
  }

  public func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
    guard let address = address(for: characteristic, peerIdentifier: peripheral.identifier.uuidString) else { return }
    if let pending = pendingRead.removeValue(forKey: address) {
      pending.completion(characteristic.value as NSData?, error as NSError?)
      return
    }
    let pendingSubscriptionIdentifier = pendingNotify[address].flatMap { pending in
      pending.enabled ? pending.subscriptionIdentifier : nil
    }
    guard error == nil,
          let subscriptionIdentifier = subscriptions[address] ?? pendingSubscriptionIdentifier,
          let value = characteristic.value else { return }
    delegate?.protocolRadioDidReceiveNotification(subscriptionIdentifier, value: value as NSData)
  }

  public func peripheral(_ peripheral: CBPeripheral, didReadRSSI RSSI: NSNumber, error: Error?) {
    let peerIdentifier = peripheral.identifier.uuidString
    guard let pending = pendingRssi.removeValue(forKey: peerIdentifier) else { return }
    pending.completion(RSSI, error as NSError?)
  }

  public func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
    guard let address = address(for: characteristic, peerIdentifier: peripheral.identifier.uuidString),
          let pending = pendingWrite.removeValue(forKey: address) else { return }
    pending.completion(error as NSError?)
  }

  public func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
    guard let address = address(for: characteristic, peerIdentifier: peripheral.identifier.uuidString),
          let pending = pendingNotify.removeValue(forKey: address) else { return }
    if pending.enabled {
      if error == nil && characteristic.isNotifying {
        subscriptions[address] = pending.subscriptionIdentifier
      } else {
        subscriptions.removeValue(forKey: address)
      }
    } else if error == nil || !characteristic.isNotifying {
      subscriptions.removeValue(forKey: address)
    }
    pending.completion(error as NSError?)
  }

  private func setNotify(
    peerIdentifier: String,
    serviceUUID: String,
    serviceOccurrence: Int,
    characteristicUUID: String,
    characteristicOccurrence: Int,
    enabled: Bool,
    subscriptionIdentifier: String,
    operationIdentifier: String,
    completion: @escaping (NSError?) -> Void
  ) {
    queue.async {
      guard self.requireUsable(completion) else { return }
      let address = CharacteristicAddress(
        peerIdentifier: peerIdentifier,
        serviceUUID: OwnedCoreBluetoothProtocolRadioSupport.normalizedUUID(serviceUUID),
        serviceOccurrence: serviceOccurrence,
        characteristicUUID: OwnedCoreBluetoothProtocolRadioSupport.normalizedUUID(characteristicUUID),
        characteristicOccurrence: characteristicOccurrence
      )
      guard let resolved = self.resolve(address) else {
        completion(self.error(code: 1017, message: "The generation-bound characteristic path is stale"))
        return
      }
      guard self.pendingNotify[address] == nil else {
        completion(self.error(code: 1018, message: "A notification state change is already pending for this characteristic"))
        return
      }
      if !enabled && self.subscriptions[address] != subscriptionIdentifier {
        completion(self.error(code: 1019, message: "The subscription does not own this characteristic"))
        return
      }
      self.pendingNotify[address] = PendingNotify(
        operationIdentifier: operationIdentifier,
        subscriptionIdentifier: subscriptionIdentifier,
        enabled: enabled,
        completion: completion
      )
      resolved.peripheral.setNotifyValue(enabled, for: resolved.characteristic)
    }
  }

  private func finishDiscoveryIfReady(_ peerIdentifier: String) {
    guard let pending = pendingDiscovery[peerIdentifier],
          pending.awaitingCharacteristics == 0,
          pending.awaitingDescriptors == 0 else { return }
    pendingDiscovery.removeValue(forKey: peerIdentifier)
    pending.completion(snapshot(for: peerIdentifier), nil)
  }

  private func snapshot(for peerIdentifier: String) -> NSDictionary {
    var services = [NSDictionary]()
    var serviceOccurrences = [String: Int]()
    for service in servicesByPeer[peerIdentifier] ?? [] {
      let serviceUUID = OwnedCoreBluetoothProtocolRadioSupport.normalizedUUID(service.uuid.uuidString)
      let serviceOccurrence = serviceOccurrences[serviceUUID, default: 0]
      serviceOccurrences[serviceUUID] = serviceOccurrence + 1
      var characteristics = [NSDictionary]()
      var characteristicOccurrences = [String: Int]()
      for characteristic in service.characteristics ?? [] {
        let characteristicUUID = OwnedCoreBluetoothProtocolRadioSupport.normalizedUUID(characteristic.uuid.uuidString)
        let characteristicOccurrence = characteristicOccurrences[characteristicUUID, default: 0]
        characteristicOccurrences[characteristicUUID] = characteristicOccurrence + 1
        characteristics.append([
          "uuid": characteristicUUID,
          "occurrence": characteristicOccurrence,
          "readable": characteristic.properties.contains(.read),
          "writableWithResponse": characteristic.properties.contains(.write),
          "writableWithoutResponse": characteristic.properties.contains(.writeWithoutResponse),
          "notifiable": characteristic.properties.contains(.notify) || characteristic.properties.contains(.indicate)
        ] as NSDictionary)
      }
      services.append([
        "uuid": serviceUUID,
        "occurrence": serviceOccurrence,
        "characteristics": characteristics
      ] as NSDictionary)
    }
    return ["services": services] as NSDictionary
  }

  private func resolve(_ address: CharacteristicAddress) -> (peripheral: CBPeripheral, characteristic: CBCharacteristic)? {
    guard let peripheral = peripheralByIdentifier[address.peerIdentifier], peripheral.state == .connected,
          let services = servicesByPeer[address.peerIdentifier] else { return nil }
    let matchingServices = services.filter {
      OwnedCoreBluetoothProtocolRadioSupport.normalizedUUID($0.uuid.uuidString) == address.serviceUUID
    }
    guard address.serviceOccurrence >= 0, address.serviceOccurrence < matchingServices.count else { return nil }
    let service = matchingServices[address.serviceOccurrence]
    let matchingCharacteristics = (service.characteristics ?? []).filter {
      OwnedCoreBluetoothProtocolRadioSupport.normalizedUUID($0.uuid.uuidString) == address.characteristicUUID
    }
    guard address.characteristicOccurrence >= 0, address.characteristicOccurrence < matchingCharacteristics.count else { return nil }
    return (peripheral, matchingCharacteristics[address.characteristicOccurrence])
  }

  private func address(for characteristic: CBCharacteristic, peerIdentifier: String) -> CharacteristicAddress? {
    guard let service = characteristic.service,
          let services = servicesByPeer[peerIdentifier] else { return nil }
    let normalizedServiceUUID = OwnedCoreBluetoothProtocolRadioSupport.normalizedUUID(service.uuid.uuidString)
    let matchingServices = services.filter {
      OwnedCoreBluetoothProtocolRadioSupport.normalizedUUID($0.uuid.uuidString) == normalizedServiceUUID
    }
    guard let serviceOccurrence = matchingServices.firstIndex(where: { $0 === service }) else { return nil }
    let matchingCharacteristics = (service.characteristics ?? []).filter {
      OwnedCoreBluetoothProtocolRadioSupport.normalizedUUID($0.uuid.uuidString) ==
        OwnedCoreBluetoothProtocolRadioSupport.normalizedUUID(characteristic.uuid.uuidString)
    }
    guard let characteristicOccurrence = matchingCharacteristics.firstIndex(where: { $0 === characteristic }) else { return nil }
    return CharacteristicAddress(
      peerIdentifier: peerIdentifier,
      serviceUUID: normalizedServiceUUID,
      serviceOccurrence: serviceOccurrence,
      characteristicUUID: OwnedCoreBluetoothProtocolRadioSupport.normalizedUUID(characteristic.uuid.uuidString),
      characteristicOccurrence: characteristicOccurrence
    )
  }

  private func cancelPendingOperation(_ operationIdentifier: String) {
    if activeScanOperationIdentifier == operationIdentifier {
      central.stopScan()
      activeScanOperationIdentifier = nil
    }
    for (peerIdentifier, pending) in pendingConnect where pending.operationIdentifier == operationIdentifier {
      pendingConnect.removeValue(forKey: peerIdentifier)
      if let peripheral = peripheralByIdentifier[peerIdentifier] {
        central.cancelPeripheralConnection(peripheral)
      }
    }
    let cancelledDisconnects = pendingDisconnect.compactMap { peerIdentifier, pending in
      pending.operationIdentifier == operationIdentifier ? peerIdentifier : nil
    }
    for peerIdentifier in cancelledDisconnects {
      pendingDisconnect.removeValue(forKey: peerIdentifier)
    }
    pendingDiscovery = pendingDiscovery.filter { $0.value.operationIdentifier != operationIdentifier }
    pendingRead = pendingRead.filter { $0.value.operationIdentifier != operationIdentifier }
    pendingRssi = pendingRssi.filter { $0.value.operationIdentifier != operationIdentifier }
    pendingWrite = pendingWrite.filter { $0.value.operationIdentifier != operationIdentifier }
    for (address, pending) in pendingNotify where pending.operationIdentifier == operationIdentifier {
      pendingNotify.removeValue(forKey: address)
      if let resolved = resolve(address) {
        resolved.peripheral.setNotifyValue(false, for: resolved.characteristic)
      }
    }
  }

  private func failPendingGATT(for peerIdentifier: String, error: NSError?) {
    let failure = error ?? self.error(code: 1020, message: "CoreBluetooth disconnected")
    for (address, pending) in pendingRead where address.peerIdentifier == peerIdentifier {
      pendingRead.removeValue(forKey: address)
      pending.completion(nil, failure)
    }
    if let pending = pendingRssi.removeValue(forKey: peerIdentifier) {
      pending.completion(nil, failure)
    }
    for (address, pending) in pendingWrite where address.peerIdentifier == peerIdentifier {
      pendingWrite.removeValue(forKey: address)
      pending.completion(failure)
    }
    for (address, pending) in pendingNotify where address.peerIdentifier == peerIdentifier {
      pendingNotify.removeValue(forKey: address)
      pending.completion(failure)
    }
    subscriptions = subscriptions.filter { $0.key.peerIdentifier != peerIdentifier }
  }

  private func failAllPendingOperationsOnDestroy() {
    let failure = error(code: 1021, message: "The CoreBluetooth protocol radio was destroyed")
    let connects = pendingConnect
    let disconnects = pendingDisconnect
    let discoveries = pendingDiscovery
    let reads = pendingRead
    let rssiReads = pendingRssi
    let writes = pendingWrite
    let notifications = pendingNotify

    pendingConnect.removeAll()
    pendingDisconnect.removeAll()
    pendingDiscovery.removeAll()
    pendingRead.removeAll()
    pendingRssi.removeAll()
    pendingWrite.removeAll()
    pendingNotify.removeAll()

    for pending in connects.values {
      pending.completion(failure)
    }
    for pending in disconnects.values {
      pending.completion(failure)
    }
    for pending in discoveries.values {
      pending.completion(nil, failure)
    }
    for pending in reads.values {
      pending.completion(nil, failure)
    }
    for pending in rssiReads.values {
      pending.completion(nil, failure)
    }
    for pending in writes.values {
      pending.completion(failure)
    }
    for pending in notifications.values {
      pending.completion(failure)
    }
  }

  private func requireUsable(_ completion: (NSError?) -> Void) -> Bool {
    guard !destroyed else {
      completion(error(code: 1021, message: "The Native Protocol v1 CoreBluetooth radio was destroyed"))
      return false
    }
    return true
  }

  private func error(code: Int, message: String) -> NSError {
    NSError(
      domain: "com.sfourdrinier.unifiedblemanager.corebluetooth",
      code: code,
      userInfo: [NSLocalizedDescriptionKey: message]
    )
  }

}
