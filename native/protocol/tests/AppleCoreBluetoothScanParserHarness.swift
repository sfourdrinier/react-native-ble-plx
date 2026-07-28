// native/protocol/tests/AppleCoreBluetoothScanParserHarness.swift

import CoreBluetooth
import Foundation

@main
enum AppleCoreBluetoothScanParserHarness {
  static func main() {
    let scanCompletion = DispatchSemaphore(value: 0)
    let destroyCompletion = DispatchSemaphore(value: 0)
    let radio = OwnedCoreBluetoothProtocolRadio(restoreIdentifierKey: nil)
    var scanError: NSError?

    radio.startScan(
      serviceUUIDs: ["0000180D-0000-1000-8000-00805F9B34FB"],
      allowDuplicates: false,
      operationIdentifier: "canonical-128-bit-uuid-regression"
    ) { error in
      scanError = error
      scanCompletion.signal()
    }

    guard scanCompletion.wait(timeout: .now() + 5) == .success else {
      fputs("startScan did not complete\n", stderr)
      exit(1)
    }

    if scanError?.code == 1002 {
      fputs("startScan rejected the canonical 128-bit UUID\n", stderr)
      exit(2)
    }

    radio.destroy { error in
      if let error {
        fputs("destroy failed: \(error.localizedDescription)\n", stderr)
        exit(3)
      }
      destroyCompletion.signal()
    }

    guard destroyCompletion.wait(timeout: .now() + 5) == .success else {
      fputs("destroy did not complete\n", stderr)
      exit(4)
    }
  }
}
