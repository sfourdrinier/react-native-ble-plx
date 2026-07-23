import Foundation
// MultiplatformBleAdapter is vendored into this pod's own module, so BleClientManager
// is available in-module without an external import.

@objc(BlePlxRestorationState)
public final class BlePlxRestorationState: NSObject {
  private static var restoredManager: BleClientManager?
  /// JS-shaped RestoreStateEvent body captured at system willRestoreState time
  /// (before JS constructs BleManager / attaches listeners).
  private static var restoredStatePayload: [AnyHashable: Any]?
  private static let lock = NSLock()

  @objc public static func storeRestoredManager(_ manager: BleClientManager) {
    storeRestoredManager(manager, restoreStatePayload: nil)
  }

  @objc public static func storeRestoredManager(
    _ manager: BleClientManager,
    restoreStatePayload: [AnyHashable: Any]?
  ) {
    lock.lock(); defer { lock.unlock() }
    restoredManager = manager
    restoredStatePayload = restoreStatePayload
  }

  /// Returns the stored manager (if any) and clears the manager cache to avoid reuse.
  /// Call {@link takeRestoredStatePayload} next if a replay payload is needed.
  @objc public static func takeRestoredManager() -> BleClientManager? {
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
