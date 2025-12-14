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

import Foundation
import CoreBluetooth

// MARK: - Bundled Registry Singleton

/// Thread-safe fallback registry for BLE restoration adapters.
///
/// This is the BUNDLED fallback that works out of the box for standalone apps.
/// If the host app provides a class named "BleRestorationRegistry", the
/// BlePlxRestorationAdapter will use that instead.
///
/// Adapters are stored as AnyClass and invoked via ObjC selectors to avoid
/// protocol type conflicts with host apps.
@objc(BlePlxBundledRestorationRegistry)
public final class BlePlxBundledRestorationRegistry: NSObject {

  // MARK: - Singleton

  @objc public static let shared = BlePlxBundledRestorationRegistry()
  private override init() {
    super.init()
    print("[BlePlxBundledRestorationRegistry] Bundled fallback registry initialized")
  }

  // MARK: - Storage

  private let queue = DispatchQueue(
    label: "com.reactnativebleplx.bundled.restoration.registry",
    attributes: .concurrent
  )
  private var adapterClasses = [AnyClass]()

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
      print("[BlePlxBundledRestorationRegistry] ✗ \(cls) does not implement handleRestoredWithCentral:willRestoreState:")
      return
    }

    queue.sync(flags: .barrier) {
      // Avoid duplicate registration
      if adapterClasses.contains(where: { $0 === cls }) {
        print("[BlePlxBundledRestorationRegistry] Already registered: \(cls)")
        return
      }

      adapterClasses.append(cls)
      print("[BlePlxBundledRestorationRegistry] ✓ Registered \(cls)")
    }
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
    print("[BlePlxBundledRestorationRegistry] Device \(deviceId) noted (advanced routing requires host registry)")
  }

  // MARK: - Restoration Dispatch

  /// Dispatch restoration callback to all registered adapters.
  /// Invokes handleRestoredWithCentral:willRestoreState: on each adapter class.
  public func dispatchRestoration(
    central: CBCentralManager,
    willRestoreState dict: [String: Any]
  ) {
    let classes = allAdapterClasses

    guard !classes.isEmpty else {
      print("[BlePlxBundledRestorationRegistry] No adapters registered - nothing to restore")
      return
    }

    print("[BlePlxBundledRestorationRegistry] Dispatching restoration to \(classes.count) adapter(s)")

    for cls in classes {
      // Use ObjC runtime to invoke the class method
      if let method = class_getClassMethod(cls, BlePlxBundledRestorationRegistry.handleRestoredSelector) {
        let imp = method_getImplementation(method)

        // Cast to appropriate function type and call
        typealias HandleRestoredFunc = @convention(c) (AnyClass, Selector, CBCentralManager, [String: Any]) -> Void
        let handleRestored = unsafeBitCast(imp, to: HandleRestoredFunc.self)
        handleRestored(cls, BlePlxBundledRestorationRegistry.handleRestoredSelector, central, dict)

        print("[BlePlxBundledRestorationRegistry] ✓ Dispatched to \(cls)")
      } else {
        print("[BlePlxBundledRestorationRegistry] ✗ Could not find method on \(cls)")
      }
    }
  }
}
