import Foundation

/// Holds the owned CoreBluetooth adapter created during system BLE restoration wake,
/// plus the JS-shaped RestoreStateEvent payload for createClient replay.
/// Typed as BleAdapter (owned radio) so the 4.0 GA path compiles without MBA types.
@objc(BlePlxRestorationState)
public final class BlePlxRestorationState: NSObject {
  private static var restoredManager: BleAdapter?
  /// JS-shaped RestoreStateEvent body captured at system willRestoreState time
  /// (before JS constructs BleManager / attaches listeners).
  private static var restoredStatePayload: [AnyHashable: Any]?
  private static let lock = NSLock()

  @objc public static func storeRestoredManager(_ manager: BleAdapter) {
    storeRestoredManager(manager, restoreStatePayload: nil)
  }

  @objc public static func storeRestoredManager(
    _ manager: BleAdapter,
    restoreStatePayload: [AnyHashable: Any]?
  ) {
    lock.lock(); defer { lock.unlock() }
    restoredManager = manager
    restoredStatePayload = restoreStatePayload
  }

  /// Returns the stored manager (if any) and clears the manager cache to avoid reuse.
  /// Call {@link takeRestoredStatePayload} next if a replay payload is needed.
  @objc public static func takeRestoredManager() -> BleAdapter? {
    lock.lock(); defer { lock.unlock() }
    let mgr = restoredManager
    restoredManager = nil
    return mgr
  }

  /// Returns and clears the buffered restore payload (if any).
  /// Must be read during the same createClient path as takeRestoredManager.
  @objc public static func takeRestoredStatePayload() -> [AnyHashable: Any]? {
    lock.lock(); defer { lock.unlock() }
    let payload = restoredStatePayload
    restoredStatePayload = nil
    return payload
  }
}
