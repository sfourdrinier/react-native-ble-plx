//
//  BleRestorationRegistry.swift
//  react-native-ble-plx
//
//  Bundled fallback registry for BLE restoration adapters.
//  Used when the host app doesn't provide its own BleRestorationRegistry.
//
//  IMPORTANT: This registry uses AnyClass storage and selector-based invocation
//  to avoid defining a duplicate BleRestorableAdapter protocol. This ensures
//  compatibility with host apps that provide their own BleRestoration module.
//
//  The registry expects adapters to implement these class methods:
//    - restorationIdentifier (getter) - String
//    - handleRestoredWithCentral:willRestoreState: - void
//
//  R2-F020: When BlePlxRestoreIdentifier is in Info.plist, the registry owns an
//  early CBCentralManager so system willRestoreState can fire before JS starts,
//  then dispatchRestoration → handleRestored → BlePlxRestorationState.storeRestoredManager.
//

import Foundation
import CoreBluetooth

// MARK: - Bundled Registry Singleton

/// Thread-safe fallback registry for BLE restoration adapters.
///
/// This is the BUNDLED fallback that works out of the box for standalone apps
/// when `BlePlxRestoreIdentifier` is set in Info.plist (Expo plugin
/// `iosEnableRestoration: true`). If the host app provides a class named
/// "BleRestorationRegistry", the BlePlxRestorationAdapter will use that instead.
///
/// Adapters are stored as AnyClass and invoked via ObjC selectors to avoid
/// protocol type conflicts with host apps.
@objc(BlePlxBundledRestorationRegistry)
public final class BlePlxBundledRestorationRegistry: NSObject, CBCentralManagerDelegate {

  // MARK: - Singleton

  @objc public static let shared = BlePlxBundledRestorationRegistry()
  private override init() {
    super.init()
    BlePlxDebugLogging.log("[BlePlxBundledRestorationRegistry] Bundled fallback registry initialized")
  }

  // MARK: - Storage

  private let queue = DispatchQueue(
    label: "com.reactnativebleplx.bundled.restoration.registry",
    attributes: .concurrent
  )
  private var adapterClasses = [AnyClass]()

  /// Early-wake central retained so system willRestoreState can fire before createClient (R2-F020).
  private var earlyCentral: CBCentralManager?
  private let centralQueue = DispatchQueue(label: "com.reactnativebleplx.bundled.restoration.central")

  // MARK: - Required Selectors

  /// Selector for the restoration handler method
  private static let handleRestoredSelector = NSSelectorFromString("handleRestoredWithCentral:willRestoreState:")

  // MARK: - Registration (Obj-C compatible)

  /// Register an adapter class. Called by adapters during their initialization.
  ///
  /// - Parameter cls: The adapter class (must implement handleRestoredWithCentral:willRestoreState:)
  @objc(registerAdapter:)
  public func registerAdapter(_ cls: AnyClass) {
    // Verify the class implements the required selector
    guard cls.responds(to: BlePlxBundledRestorationRegistry.handleRestoredSelector) else {
      BlePlxDebugLogging.log(
        "[BlePlxBundledRestorationRegistry] ✗ \(cls) does not implement handleRestoredWithCentral:willRestoreState:"
      )
      return
    }

    queue.sync(flags: .barrier) {
      // Avoid duplicate registration
      if adapterClasses.contains(where: { $0 === cls }) {
        BlePlxDebugLogging.log("[BlePlxBundledRestorationRegistry] Already registered: \(cls)")
        return
      }

      adapterClasses.append(cls)
      BlePlxDebugLogging.log("[BlePlxBundledRestorationRegistry] ✓ Registered \(cls)")
    }

    // Ensure early central exists after first successful adapter registration.
    ensureEarlyCentralManager()
  }

  // MARK: - Query

  /// Get all registered adapter classes
  public var allAdapterClasses: [AnyClass] {
    queue.sync { adapterClasses }
  }

  /// Get count of registered adapters
  @objc public var adapterCount: Int {
    queue.sync { adapterClasses.count }
  }

  /// Get names of all registered adapters
  @objc public var adapterNames: [String] {
    queue.sync { adapterClasses.map { NSStringFromClass($0) } }
  }

  // MARK: - Device Routing (Stub)

  /// Device routing stub - for basic usage, we broadcast to all adapters.
  /// Host apps wanting device-specific routing should provide their own
  /// BleRestorationRegistry implementation.
  @objc(registerDevice:forAdapter:)
  public func registerDevice(_ deviceId: String, for cls: AnyClass) {
    BlePlxDebugLogging.log(
      "[BlePlxBundledRestorationRegistry] Device \(deviceId) noted (advanced routing requires host registry)"
    )
  }

  // MARK: - Early-wake CBCentralManager (R2-F020)

  /// Create/retain one CBCentralManager with BlePlxRestoreIdentifier so the OS can
  /// deliver willRestoreState before React Native createClient runs.
  private func ensureEarlyCentralManager() {
    #if os(iOS)
    queue.sync(flags: .barrier) {
      guard earlyCentral == nil else { return }
      let raw = Bundle.main.object(forInfoDictionaryKey: "BlePlxRestoreIdentifier") as? String
      let key = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      guard !key.isEmpty else {
        BlePlxDebugLogging.log(
          "[BlePlxBundledRestorationRegistry] No BlePlxRestoreIdentifier in Info.plist — early central not created"
        )
        return
      }
      earlyCentral = CBCentralManager(
        delegate: self,
        queue: centralQueue,
        options: [CBCentralManagerOptionRestoreIdentifierKey: key]
      )
      BlePlxDebugLogging.log(
        "[BlePlxBundledRestorationRegistry] Early CBCentralManager created with restore id \(key)"
      )
    }
    #endif
  }

  /// Hand off the early central to OwnedCoreBluetoothAdapter on cold createClient
  /// (no system restore). Returns nil if restore already transferred ownership.
  @objc public func takeEarlyCentralManager() -> CBCentralManager? {
    var taken: CBCentralManager?
    queue.sync(flags: .barrier) {
      taken = earlyCentral
      earlyCentral = nil
    }
    if let taken = taken {
      taken.delegate = nil
      BlePlxDebugLogging.log("[BlePlxBundledRestorationRegistry] Early central handed off via takeEarlyCentralManager")
    }
    return taken
  }

  // MARK: - CBCentralManagerDelegate

  public func centralManagerDidUpdateState(_ central: CBCentralManager) {
    // Required; state is observed by the owned adapter after handoff.
  }

  #if os(iOS)
  public func centralManager(_ central: CBCentralManager, willRestoreState dict: [String: Any]) {
    BlePlxDebugLogging.log("[BlePlxBundledRestorationRegistry] willRestoreState — dispatching to adapters")
    // Clear ownership before dispatch: handleRestored adopts this central.
    queue.sync(flags: .barrier) {
      if earlyCentral === central {
        earlyCentral = nil
      }
    }
    dispatchRestoration(central: central, willRestoreState: dict)
  }
  #endif

  // MARK: - Restoration Dispatch

  /// Dispatch restoration callback to all registered adapters.
  /// Invokes handleRestoredWithCentral:willRestoreState: on each adapter class.
  /// Call path: willRestoreState → dispatchRestoration → handleRestored → storeRestoredManager.
  public func dispatchRestoration(
    central: CBCentralManager,
    willRestoreState dict: [String: Any]
  ) {
    let classes = allAdapterClasses

    guard !classes.isEmpty else {
      BlePlxDebugLogging.log("[BlePlxBundledRestorationRegistry] No adapters registered - nothing to restore")
      return
    }

    BlePlxDebugLogging.log("[BlePlxBundledRestorationRegistry] Dispatching restoration to \(classes.count) adapter(s)")

    for cls in classes {
      // Use ObjC runtime to invoke the class method
      if let method = class_getClassMethod(cls, BlePlxBundledRestorationRegistry.handleRestoredSelector) {
        let imp = method_getImplementation(method)

        // Cast to appropriate function type and call
        typealias HandleRestoredFunc = @convention(c) (AnyClass, Selector, CBCentralManager, [String: Any]) -> Void
        let handleRestored = unsafeBitCast(imp, to: HandleRestoredFunc.self)
        handleRestored(cls, BlePlxBundledRestorationRegistry.handleRestoredSelector, central, dict)

        BlePlxDebugLogging.log("[BlePlxBundledRestorationRegistry] ✓ Dispatched to \(cls)")
      } else {
        BlePlxDebugLogging.log("[BlePlxBundledRestorationRegistry] ✗ Could not find method on \(cls)")
      }
    }
  }
}
