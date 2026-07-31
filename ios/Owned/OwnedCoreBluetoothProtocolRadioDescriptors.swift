// ios/Owned/OwnedCoreBluetoothProtocolRadioDescriptors.swift

import CoreBluetooth
import Foundation

struct OwnedCoreBluetoothDescriptorAddress: Hashable {
  let characteristic: OwnedCoreBluetoothProtocolRadio.CharacteristicAddress
  let descriptorUUID: String
  let descriptorOccurrence: Int

  var peerIdentifier: String {
    characteristic.peerIdentifier
  }
}

final class OwnedCoreBluetoothDescriptorOperations {
  var pendingReads = [OwnedCoreBluetoothDescriptorAddress: (operationIdentifier: String, completion: (NSData?, NSError?) -> Void)]()
  var pendingWrites = [OwnedCoreBluetoothDescriptorAddress: (operationIdentifier: String, completion: (NSError?) -> Void)]()

  func cancel(_ operationIdentifier: String) {
    pendingReads = pendingReads.filter { $0.value.operationIdentifier != operationIdentifier }
    pendingWrites = pendingWrites.filter { $0.value.operationIdentifier != operationIdentifier }
  }

  func fail(_ peerIdentifier: String, error: NSError) {
    let reads = pendingReads.filter { $0.key.peerIdentifier == peerIdentifier }
    let writes = pendingWrites.filter { $0.key.peerIdentifier == peerIdentifier }
    pendingReads = pendingReads.filter { $0.key.peerIdentifier != peerIdentifier }
    pendingWrites = pendingWrites.filter { $0.key.peerIdentifier != peerIdentifier }
    for pending in reads.values {
      pending.completion(nil, error)
    }
    for pending in writes.values {
      pending.completion(error)
    }
  }

  func failAll(_ error: NSError) {
    let reads = pendingReads
    let writes = pendingWrites
    pendingReads.removeAll()
    pendingWrites.removeAll()
    for pending in reads.values {
      pending.completion(nil, error)
    }
    for pending in writes.values {
      pending.completion(error)
    }
  }
}

extension OwnedCoreBluetoothProtocolRadio {
  @objc public func readDescriptor(
    peerIdentifier: String,
    serviceUUID: String,
    serviceOccurrence: Int,
    characteristicUUID: String,
    characteristicOccurrence: Int,
    descriptorUUID: String,
    descriptorOccurrence: Int,
    operationIdentifier: String,
    completion: @escaping (NSData?, NSError?) -> Void
  ) {
    queue.async {
      guard self.requireUsable({ error in completion(nil, error) }) else { return }
      let address = self.descriptorAddress(
        peerIdentifier: peerIdentifier,
        serviceUUID: serviceUUID,
        serviceOccurrence: serviceOccurrence,
        characteristicUUID: characteristicUUID,
        characteristicOccurrence: characteristicOccurrence,
        descriptorUUID: descriptorUUID,
        descriptorOccurrence: descriptorOccurrence
      )
      guard let resolved = self.resolveDescriptor(address) else {
        completion(nil, self.error(code: 1025, message: "The generation-bound descriptor path is stale"))
        return
      }
      guard self.descriptorOperations.pendingReads[address] == nil else {
        completion(nil, self.error(code: 1026, message: "A read is already pending for this descriptor"))
        return
      }
      self.descriptorOperations.pendingReads[address] = (operationIdentifier, completion)
      resolved.peripheral.readValue(for: resolved.descriptor)
    }
  }

  @objc public func writeDescriptor(
    peerIdentifier: String,
    serviceUUID: String,
    serviceOccurrence: Int,
    characteristicUUID: String,
    characteristicOccurrence: Int,
    descriptorUUID: String,
    descriptorOccurrence: Int,
    value: NSData,
    operationIdentifier: String,
    completion: @escaping (NSError?) -> Void
  ) {
    queue.async {
      guard self.requireUsable(completion) else { return }
      guard value.length <= Self.maximumBinaryPayloadBytes else {
        completion(self.error(code: 1027, message: "The native binary payload exceeds the protocol limit"))
        return
      }
      let address = self.descriptorAddress(
        peerIdentifier: peerIdentifier,
        serviceUUID: serviceUUID,
        serviceOccurrence: serviceOccurrence,
        characteristicUUID: characteristicUUID,
        characteristicOccurrence: characteristicOccurrence,
        descriptorUUID: descriptorUUID,
        descriptorOccurrence: descriptorOccurrence
      )
      guard let resolved = self.resolveDescriptor(address) else {
        completion(self.error(code: 1028, message: "The generation-bound descriptor path is stale"))
        return
      }
      guard self.descriptorOperations.pendingWrites[address] == nil else {
        completion(self.error(code: 1029, message: "A write is already pending for this descriptor"))
        return
      }
      self.descriptorOperations.pendingWrites[address] = (operationIdentifier, completion)
      resolved.peripheral.writeValue(value as Data, for: resolved.descriptor)
    }
  }

  public func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor descriptor: CBDescriptor, error: Error?) {
    guard let address = descriptorAddress(for: descriptor, peerIdentifier: peripheral.identifier.uuidString),
          let pending = descriptorOperations.pendingReads.removeValue(forKey: address) else { return }
    if let error {
      pending.completion(nil, error as NSError)
      return
    }
    guard let value = descriptor.value as? NSData else {
      pending.completion(nil, self.error(code: 1030, message: "CoreBluetooth returned a non-binary descriptor value"))
      return
    }
    pending.completion(value, nil)
  }

  public func peripheral(_ peripheral: CBPeripheral, didWriteValueFor descriptor: CBDescriptor, error: Error?) {
    guard let address = descriptorAddress(for: descriptor, peerIdentifier: peripheral.identifier.uuidString),
          let pending = descriptorOperations.pendingWrites.removeValue(forKey: address) else { return }
    pending.completion(error as NSError?)
  }

  private func descriptorAddress(
    peerIdentifier: String,
    serviceUUID: String,
    serviceOccurrence: Int,
    characteristicUUID: String,
    characteristicOccurrence: Int,
    descriptorUUID: String,
    descriptorOccurrence: Int
  ) -> OwnedCoreBluetoothDescriptorAddress {
    OwnedCoreBluetoothDescriptorAddress(
      characteristic: CharacteristicAddress(
        peerIdentifier: peerIdentifier,
        serviceUUID: OwnedCoreBluetoothProtocolRadioSupport.normalizedUUID(serviceUUID),
        serviceOccurrence: serviceOccurrence,
        characteristicUUID: OwnedCoreBluetoothProtocolRadioSupport.normalizedUUID(characteristicUUID),
        characteristicOccurrence: characteristicOccurrence
      ),
      descriptorUUID: OwnedCoreBluetoothProtocolRadioSupport.normalizedUUID(descriptorUUID),
      descriptorOccurrence: descriptorOccurrence
    )
  }

  private func resolveDescriptor(
    _ address: OwnedCoreBluetoothDescriptorAddress
  ) -> (peripheral: CBPeripheral, descriptor: CBDescriptor)? {
    guard let resolved = resolve(address.characteristic) else { return nil }
    let matches = (resolved.characteristic.descriptors ?? []).filter {
      OwnedCoreBluetoothProtocolRadioSupport.normalizedUUID($0.uuid.uuidString) == address.descriptorUUID
    }
    guard address.descriptorOccurrence >= 0, address.descriptorOccurrence < matches.count else { return nil }
    return (resolved.peripheral, matches[address.descriptorOccurrence])
  }

  private func descriptorAddress(
    for descriptor: CBDescriptor,
    peerIdentifier: String
  ) -> OwnedCoreBluetoothDescriptorAddress? {
    guard let characteristic = descriptor.characteristic,
          let characteristicAddress = address(for: characteristic, peerIdentifier: peerIdentifier) else { return nil }
    let descriptorUUID = OwnedCoreBluetoothProtocolRadioSupport.normalizedUUID(descriptor.uuid.uuidString)
    let matches = (characteristic.descriptors ?? []).filter {
      OwnedCoreBluetoothProtocolRadioSupport.normalizedUUID($0.uuid.uuidString) == descriptorUUID
    }
    guard let occurrence = matches.firstIndex(where: { $0 === descriptor }) else { return nil }
    return OwnedCoreBluetoothDescriptorAddress(
      characteristic: characteristicAddress,
      descriptorUUID: descriptorUUID,
      descriptorOccurrence: occurrence
    )
  }
}
