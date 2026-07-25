/**
 * Honest capability queries for multi-host 4.0.
 * Unimplemented features return false — never claim mobile parity on web/electron.
 */

export type BleCapability =
  | 'central'
  | 'scan'
  | 'connect'
  | 'discover'
  | 'read'
  | 'write'
  | 'notify'
  | 'bytesPath'
  | 'base64Path'
  | 'requestDevice' // Web Bluetooth chooser
  | 'continuousScan' // mobile-style background/continuous scan
  | 'bonding'
  | 'requestMtu'
  | 'connectionPriority'
  | 'iosStateRestoration'
  | 'androidForegroundService'
  | 'l2cap'
  | 'preferredPhy'
  | 'deviceOperationQueue'
  | 'servicesChanged'
  | 'longWrite'

export type HostKind = 'react-native' | 'web' | 'electron' | 'node' | 'fake'

const MATRIX: Record<HostKind, Partial<Record<BleCapability, boolean>>> = {
  'react-native': {
    central: true,
    scan: true,
    connect: true,
    discover: true,
    read: true,
    write: true,
    notify: true,
    bytesPath: true,
    base64Path: true,
    requestDevice: false,
    continuousScan: true,
    // Host matrix: Android-capable RN builds expose these APIs.
    // BleManager.supports() is OS-honest (false on iOS) — see F025/F095.
    bonding: true,
    requestMtu: true,
    connectionPriority: true,
    iosStateRestoration: true,
    androidForegroundService: true,
    l2cap: false,
    preferredPhy: false,
    // Wired on RN BleManager (GAP-RN-Q / RN-SC / RN-LW): DeviceOperationQueue,
    // onServicesReset (+ native ServicesChangedEvent), writeLong…FromBytes.
    deviceOperationQueue: true,
    servicesChanged: true,
    longWrite: true
  },
  web: {
    central: true,
    scan: false, // continuous scan not standard; chooser is requestDevice
    connect: true,
    discover: true,
    read: true,
    write: true,
    notify: true,
    bytesPath: true,
    base64Path: true,
    requestDevice: true,
    continuousScan: false,
    bonding: false,
    requestMtu: false,
    connectionPriority: false,
    iosStateRestoration: false,
    androidForegroundService: false,
    l2cap: false,
    preferredPhy: false,
    deviceOperationQueue: true,
    // No WebBT bridge for ATT Services Changed / cache invalidation (software emitServicesReset only).
    servicesChanged: false,
    // Software chunked long-write helper exists; not radio-level MTU/WWR fidelity (see docs/WEB.md).
    longWrite: true
  },
  electron: {
    central: true,
    scan: true,
    connect: true,
    discover: true,
    read: true,
    write: true,
    notify: true,
    bytesPath: true,
    base64Path: true,
    requestDevice: false,
    continuousScan: true,
    bonding: false,
    requestMtu: false,
    connectionPriority: false,
    iosStateRestoration: false,
    androidForegroundService: false,
    l2cap: false,
    preferredPhy: false,
    deviceOperationQueue: true,
    // R3-F013: fail-closed until OS Services Changed events are forwarded (Electron manager.supports hard-false).
    servicesChanged: false,
    longWrite: true
  },
  node: {
    central: true,
    scan: true,
    connect: true,
    discover: true,
    read: true,
    write: true,
    notify: true,
    bytesPath: true,
    base64Path: true,
    requestDevice: false,
    continuousScan: true,
    bonding: false,
    requestMtu: false,
    connectionPriority: false,
    iosStateRestoration: false,
    androidForegroundService: false,
    l2cap: false,
    preferredPhy: false,
    deviceOperationQueue: true,
    // R3-F013: fail-closed desktop policy — match Electron; software emitServicesReset is test inject only.
    servicesChanged: false,
    longWrite: true
  },
  fake: {
    central: true,
    scan: true,
    connect: true,
    discover: true,
    read: true,
    write: true,
    notify: true,
    bytesPath: true,
    base64Path: true,
    requestDevice: false,
    continuousScan: true,
    // Simulated bond list is a real Fake feature (R2-F029); electron stays false.
    bonding: true,
    requestMtu: false,
    connectionPriority: false,
    iosStateRestoration: false,
    androidForegroundService: false,
    l2cap: false,
    preferredPhy: false,
    deviceOperationQueue: true,
    servicesChanged: true,
    longWrite: true
  }
}

/**
 * Returns whether the capability is supported on the given host kind.
 * Unknown capabilities return false (fail closed).
 */
export function supports(capability: BleCapability, host: HostKind = 'react-native'): boolean {
  const row = MATRIX[host]
  if (!row) return false
  return row[capability] === true
}

export function capabilitiesFor(host: HostKind): Readonly<Partial<Record<BleCapability, boolean>>> {
  return { ...MATRIX[host] }
}
