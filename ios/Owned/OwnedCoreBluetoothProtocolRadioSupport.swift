// ios/Owned/OwnedCoreBluetoothProtocolRadioSupport.swift

import CoreBluetooth
import Foundation

/**
 * Pure CoreBluetooth projections and value validation for the Native Protocol radio.
 *
 * This owns no radio state and never calls CoreBluetooth asynchronously; the radio remains the
 * sole owner of delegates, pending operations, and queue-confined mutable state.
 */
enum OwnedCoreBluetoothProtocolRadioSupport {
  static func advertisementDictionary(
    peripheral: CBPeripheral,
    advertisementData: [String: Any],
    rssi: NSNumber
  ) -> NSDictionary {
    let serviceUUIDs = (advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID])?.map {
      normalizedUUID($0.uuidString)
    }
    let solicitedServiceUUIDs = (advertisementData[CBAdvertisementDataSolicitedServiceUUIDsKey] as? [CBUUID])?.map {
      normalizedUUID($0.uuidString)
    }
    let overflowServiceUUIDs = (advertisementData[CBAdvertisementDataOverflowServiceUUIDsKey] as? [CBUUID])?.map {
      normalizedUUID($0.uuidString)
    }
    let serviceData = (advertisementData[CBAdvertisementDataServiceDataKey] as? [CBUUID: Data])?.reduce(into: [String: NSData]()) {
      $0[normalizedUUID($1.key.uuidString)] = $1.value as NSData
    }
    let manufacturerData = advertisementData[CBAdvertisementDataManufacturerDataKey] as? NSData
    var result: [String: Any] = [
      "peerIdentifier": peripheral.identifier.uuidString,
      "observedAt": DispatchTime.now().uptimeNanoseconds / 1_000_000,
      "localName": advertisementData[CBAdvertisementDataLocalNameKey] as? String ?? peripheral.name as Any,
      "rssi": rssi.intValue,
      "serviceUUIDs": serviceUUIDs as Any,
      "solicitedServiceUUIDs": solicitedServiceUUIDs as Any,
      "overflowServiceUUIDs": overflowServiceUUIDs as Any,
      "serviceData": serviceData as Any,
      "connectable": advertisementData[CBAdvertisementDataIsConnectable] as? Bool as Any,
      "txPower": advertisementData[CBAdvertisementDataTxPowerLevelKey] as? NSNumber as Any,
      "manufacturerData": manufacturerData as Any
    ]
    result["fieldProvenance"] = ["corebluetooth-advertisement"]
    return result as NSDictionary
  }

  static func adapterSnapshotDictionary(central: CBCentralManager) -> NSDictionary {
    let authorization: String
    if #available(iOS 13.1, tvOS 13.1, *) {
      switch CBManager.authorization {
      case .allowedAlways: authorization = "granted"
      case .denied: authorization = "denied"
      case .restricted: authorization = "restricted"
      case .notDetermined: authorization = "notDetermined"
      @unknown default: authorization = "unavailable"
      }
    } else {
      authorization = "unavailable"
    }
    let power: String
    switch central.state {
    case .poweredOn: power = "on"
    case .poweredOff: power = "off"
    case .resetting: power = "resetting"
    case .unsupported: power = "unsupported"
    case .unauthorized: power = "unknown"
    case .unknown: power = "unknown"
    @unknown default: power = "unknown"
    }
    return [
      "availability": central.state == .unsupported ? "unsupported" : "available",
      "authorization": authorization,
      "power": power,
      "safeReason": central.state == .poweredOn ? NSNull() : "CoreBluetooth has not reported a powered-on adapter"
    ] as NSDictionary
  }

  static func parseUUIDs(_ values: [String]) -> [CBUUID]? {
    var result = [CBUUID]()
    for value in values {
      let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !trimmed.isEmpty,
            trimmed.range(
              of: "^(?:[0-9A-Fa-f]{4}|[0-9A-Fa-f]{8}|[0-9A-Fa-f]{8}(?:-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12})$",
              options: .regularExpression
            ) != nil else {
        return nil
      }
      result.append(CBUUID(string: trimmed))
    }
    return result
  }

  static func normalizedUUID(_ value: String) -> String {
    let uppercased = value.uppercased()
    if uppercased.count == 4 {
      return "0000\(uppercased)-0000-1000-8000-00805F9B34FB"
    }
    if uppercased.count == 8 {
      return "\(uppercased)-0000-1000-8000-00805F9B34FB"
    }
    return uppercased
  }

  static func takeRestorationTransfer() -> OwnedCoreBluetoothProtocolCentralTransfer? {
    guard let stateClass = NSClassFromString("BlePlxRestorationState") as? NSObject.Type else { return nil }
    let selector = NSSelectorFromString("takeRestoredManager")
    guard stateClass.responds(to: selector),
          let restoredManager = stateClass.perform(selector)?.takeUnretainedValue() as? NSObject,
          restoredManager.responds(to: NSSelectorFromString("takeUnifiedProtocolCentralTransfer")) else {
      return nil
    }
    return restoredManager.perform(NSSelectorFromString("takeUnifiedProtocolCentralTransfer"))?.takeUnretainedValue()
      as? OwnedCoreBluetoothProtocolCentralTransfer
  }
}
