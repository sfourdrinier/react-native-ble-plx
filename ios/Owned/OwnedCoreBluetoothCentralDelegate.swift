// ios/Owned/OwnedCoreBluetoothCentralDelegate.swift

import CoreBluetooth
import Foundation

/**
 * Forwards central callbacks without advertising restoration support when the
 * consumer did not configure a CoreBluetooth restoration identifier.
 */
class OwnedCoreBluetoothCentralDelegate: NSObject, CBCentralManagerDelegate {
  fileprivate weak var radio: OwnedCoreBluetoothProtocolRadio?

  init(radio: OwnedCoreBluetoothProtocolRadio) {
    self.radio = radio
    super.init()
  }

  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    radio?.centralManagerDidUpdateState(central)
  }

  func centralManager(
    _ central: CBCentralManager,
    didDiscover peripheral: CBPeripheral,
    advertisementData: [String: Any],
    rssi RSSI: NSNumber
  ) {
    radio?.centralManager(
      central,
      didDiscover: peripheral,
      advertisementData: advertisementData,
      rssi: RSSI
    )
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    radio?.centralManager(central, didConnect: peripheral)
  }

  func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
    radio?.centralManager(central, didFailToConnect: peripheral, error: error)
  }

  func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
    radio?.centralManager(central, didDisconnectPeripheral: peripheral, error: error)
  }
}

#if os(iOS)
/** Adds the optional restoration callback only when the central has a restoration identifier. */
final class OwnedCoreBluetoothRestoringCentralDelegate: OwnedCoreBluetoothCentralDelegate {
  func centralManager(_ central: CBCentralManager, willRestoreState dictionary: [String: Any]) {
    radio?.centralManager(central, willRestoreState: dictionary)
  }
}
#endif
