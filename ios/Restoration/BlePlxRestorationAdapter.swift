//
//  BlePlxRestorationAdapter.swift
//  react-native-ble-plx
//
//  Generic restoration adapter for react-native-ble-plx.
//  Lives in an optional subspec so host apps can opt-in to iOS BLE state restoration.
//
//  This adapter uses PURE REFLECTION to interact with BleRestorationRegistry.
//  It does NOT define its own BleRestorableAdapter protocol to avoid conflicts
//  with host apps that provide their own BleRestoration module.
//
//  Registry resolution priority:
//    1. "BleRestorationRegistry" (host app's implementation) - if present
//    2. "BlePlxBundledRestorationRegistry" (bundled fallback) - standalone use
//

import Foundation
import CoreBluetooth
import MultiplatformBleAdapter

/// Restoration adapter for react-native-ble-plx that handles iOS BLE state restoration.
///
/// When iOS terminates your app in the background while connected to BLE devices,
/// this adapter handles automatic reconnection when iOS restores the app.
///
/// # Basic Setup (Expo) - Works Standalone
/// ```json
/// {
///   "expo": {
///     "plugins": [
///       ["@sfourdrinier/react-native-ble-plx", {
///         "iosEnableRestoration": true,
///         "iosRestorationIdentifier": "com.yourapp.bleplx"
///       }]
///     ]
///   }
/// }
/// ```
///
/// # Advanced Setup (with BleRestoration module)
/// If your app includes a BleRestoration module/pod that defines BleRestorationRegistry,
/// this adapter will automatically detect and use it for advanced features like
/// device-to-adapter routing and persistence.
@objc(BlePlxRestorationAdapter)
public final class BlePlxRestorationAdapter: NSObject {

  // MARK: - Restoration Identifier

  /// Identifier shared between native and JS for CBCentral restoration.
  /// Set `BlePlxRestoreIdentifier` in Info.plist to match the value you pass
  /// as `restoreStateIdentifier` to BleManager in JS.
  @objc public static var restorationIdentifier: String = {
    if let id = Bundle.main.object(forInfoDictionaryKey: "BlePlxRestoreIdentifier") as? String,
       !id.trimmingCharacters(in: .whitespaces).isEmpty {
      return id
    }
    return "com.reactnativebleplx.restore"
  }()

  // MARK: - Registration State

  /// Track whether we've already registered to avoid duplicate registrations
  private static var isRegistered = false

  // MARK: - ObjC Selectors for Protocol Methods

  /// The ObjC selector for handleRestored - matches BleRestorableAdapter protocol
  private static let handleRestoredSelector = NSSelectorFromString("handleRestoredWithCentral:willRestoreState:")

  // MARK: - Registry Resolution

  /// Find the appropriate registry to use.
  /// Priority: BleRestorationRegistry (host) > BlePlxBundledRestorationRegistry (bundled)
  /// Only returns a registry if it responds to the required selector.
  private static func findRegistry() -> (shared: AnyObject, name: String)? {
    let registerSelector = NSSelectorFromString("registerAdapter:")

    // Try host app's registry first
    if let host = findRegistryByName("BleRestorationRegistry"),
       host.responds(to: registerSelector) {
      return (host, "BleRestorationRegistry")
    }

    // Fall back to bundled registry
    if let bundled = findRegistryByName("BlePlxBundledRestorationRegistry"),
       bundled.responds(to: registerSelector) {
      return (bundled, "BlePlxBundledRestorationRegistry")
    }

    return nil
  }

  /// Helper to find a registry singleton by class name using reflection
  private static func findRegistryByName(_ className: String) -> AnyObject? {
    guard
      let registryCls = NSClassFromString(className) as? NSObject.Type,
      registryCls.responds(to: NSSelectorFromString("shared")),
      let shared = registryCls.perform(NSSelectorFromString("shared"))?.takeUnretainedValue()
    else {
      return nil
    }
    return shared as AnyObject
  }

  // MARK: - Restoration Handler (Called via reflection by registries)

  /// Handle iOS BLE state restoration callback.
  /// This method signature matches the BleRestorableAdapter protocol so registries
  /// can call it via reflection.
  ///
  /// Note: Uses ObjC selector name that matches the protocol: handleRestoredWithCentral:willRestoreState:
  @objc(handleRestoredWithCentral:willRestoreState:)
  public static func handleRestored(
    central: CBCentralManager,
    willRestoreState dict: [String: Any]
  ) {
    guard let peripherals = dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral],
          !peripherals.isEmpty else {
      BlePlxDebugLogging.log("[BlePlxRestorationAdapter] No peripherals to restore")
      return
    }

    BlePlxDebugLogging.log("[BlePlxRestorationAdapter] Restoring \(peripherals.count) peripheral(s)")

    // Recreate a BleClientManager bound to the same restoration ID.
    let manager = BleClientManager(
      queue: .main,
      restoreIdentifierKey: restorationIdentifier
    )
    BlePlxRestorationState.storeRestoredManager(manager)

    // Register device routes and reconnect
    for peripheral in peripherals {
      let deviceId = peripheral.identifier.uuidString
      registerDeviceRoute(deviceId: deviceId)

      // Kick off reconnect in the background. We don't care about resolve/reject here
      // because JS may not be up yet. Any errors will surface once JS re-attaches.
      manager.connectToDevice(
        deviceId,
        options: [:],
        resolve: { _ in
          BlePlxDebugLogging.log("[BlePlxRestorationAdapter] ✓ Reconnected to \(deviceId)")
        },
        reject: { code, message, error in
          let reason = message ?? error?.localizedDescription ?? "unknown"
          BlePlxDebugLogging.log("[BlePlxRestorationAdapter] ✗ Failed to reconnect \(deviceId): \(code ?? "-") / \(reason)")
        }
      )
    }
  }

  // MARK: - Device Route Registration

  /// Register a device-to-adapter route using whichever registry is available.
  private static func registerDeviceRoute(deviceId: String) {
    guard let (registry, name) = findRegistry() else {
      BlePlxDebugLogging.log("[BlePlxRestorationAdapter] No registry found for device routing")
      return
    }

    let selector = NSSelectorFromString("registerDevice:forAdapter:")
    if registry.responds(to: selector) {
      _ = registry.perform(selector, with: deviceId, with: BlePlxRestorationAdapter.self)
      BlePlxDebugLogging.log("[BlePlxRestorationAdapter] Registered device route via \(name)")
    }
  }

  // MARK: - Explicit Registration (Called from BlePlx.m)

  /// Explicit registration with the restoration registry.
  /// This is called from BlePlx.m during its +initialize phase.
  ///
  /// Uses priority-based registry resolution:
  ///   1. BleRestorationRegistry (host app's implementation)
  ///   2. BlePlxBundledRestorationRegistry (bundled fallback)
  @objc public static func register() {
    // Prevent duplicate registrations
    guard !isRegistered else {
      BlePlxDebugLogging.log("[BlePlxRestorationAdapter] Already registered - skipping")
      return
    }

    guard let (registry, name) = findRegistry() else {
      BlePlxDebugLogging.log("[BlePlxRestorationAdapter] ✗ No restoration registry found")
      return
    }

    let selector = NSSelectorFromString("registerAdapter:")
    if registry.responds(to: selector) {
      _ = registry.perform(selector, with: BlePlxRestorationAdapter.self)
      isRegistered = true
      BlePlxDebugLogging.log("[BlePlxRestorationAdapter] ✓ Registered with \(name)")
    } else {
      BlePlxDebugLogging.log("[BlePlxRestorationAdapter] ✗ \(name) does not respond to registerAdapter:")
    }
  }
}
