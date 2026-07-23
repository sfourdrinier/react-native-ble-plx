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
// MultiplatformBleAdapter is vendored into this pod's own module, so BleClientManager
// is available in-module without an external import.

/// Restoration adapter for react-native-ble-plx that handles iOS BLE state restoration.
///
/// When iOS terminates your app in the background while connected to BLE devices,
/// this adapter **reports** restored peripherals (payload + manager reuse). It does
/// **not** initiate reconnects — host policy owns that (D5 / `getRestoredState`).
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
    // Empty peripheral list is still a valid restore wake (scan options / no links).
    // Always store manager + payload so createClient can replay and getRestoredState settles
    // (empty array ≠ hang until destroy).
    let peripherals =
      (dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral]) ?? []

    BlePlxDebugLogging.log(
      "[BlePlxRestorationAdapter] Reporting \(peripherals.count) restored peripheral(s) (no reconnect — D5 host policy)"
    )

    // Recreate a BleClientManager bound to the same restoration ID (CB continuity for JS).
    let manager = BleClientManager(
      queue: .main,
      restoreIdentifierKey: restorationIdentifier
    )

    let deviceIds = peripherals.map { $0.identifier.uuidString }

    // D5: restoration is a *reporting* event, not a reconnect authority.
    // JS payload comes from willRestoreState (authoritative). Host decides whether/when
    // to reconnect via getRestoredState + attemptConnectOnce or explicit auto mode.
    // (3.8.x adapter called connectToDevice here — intentional 3.9 correctness change.)
    let restorePayload: [AnyHashable: Any] = [
      "connectedPeripherals": peripherals.map { Self.jsDeviceDictionary(from: $0) }
    ]
    BlePlxRestorationState.storeRestoredManager(manager, restoreStatePayload: restorePayload)

    guard !deviceIds.isEmpty else { return }

    // Best-effort native cache fill so isDeviceConnected can reflect OS-live links when
    // the central is already powered on. May no-op if still .unknown — that is fine.
    manager.seedRestoredPeripherals(withIdentifiers: deviceIds)

    // Device→adapter routes for host registries only (no connectToDevice).
    for deviceId in deviceIds {
      registerDeviceRoute(deviceId: deviceId)
    }
  }

  /// Minimal JS Device shape matching `Peripheral.asJSObject` field set.
  private static func jsDeviceDictionary(from peripheral: CBPeripheral) -> [AnyHashable: Any] {
    [
      "id": peripheral.identifier.uuidString,
      "name": peripheral.name as Any,
      "rssi": NSNull(),
      "mtu": 23,
      "manufacturerData": NSNull(),
      "serviceData": NSNull(),
      "serviceUUIDs": NSNull(),
      "localName": NSNull(),
      "txPowerLevel": NSNull(),
      "solicitedServiceUUIDs": NSNull(),
      "isConnectable": NSNull(),
      "overflowServiceUUIDs": NSNull(),
      "rawScanRecord": NSNull()
    ]
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

  // MARK: - Explicit Registration (Called from BlePlx.mm)

  /// Explicit registration with the restoration registry.
  /// This is called from BlePlx.mm during its +initialize phase.
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
