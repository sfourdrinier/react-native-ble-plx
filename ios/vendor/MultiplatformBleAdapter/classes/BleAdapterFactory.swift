import Foundation

public typealias BleAdapterCreator = (_ queue: DispatchQueue, _ restoreIdentifierKey: String?) -> BleAdapter

// MARK: - BleAdapterFactory

@objc
public class BleAdapterFactory: NSObject {

    private static var bleAdapterCreator: BleAdapterCreator = { (queue, restoreIdentifierKey) in
        // 4.0 GA default: pure CoreBluetooth owned adapter (no RxBluetoothKit).
        return OwnedCoreBluetoothAdapter(queue: queue, restoreIdentifierKey: restoreIdentifierKey)
    }

    @objc
    public static func getNewAdapterWithQueue(_ queue: DispatchQueue, restoreIdentifierKey: String?) -> BleAdapter {
        return bleAdapterCreator(queue, restoreIdentifierKey)
    }

    @objc
    public static func setBleAdapterCreator(_ bleAdapterCreator: @escaping BleAdapterCreator) {
        self.bleAdapterCreator = bleAdapterCreator
    }

}
