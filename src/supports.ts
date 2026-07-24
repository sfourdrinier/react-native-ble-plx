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
    bonding: true, // Android yes; iOS OS-driven — still "available" surface
    requestMtu: true,
    connectionPriority: true,
    iosStateRestoration: true,
    androidForegroundService: true,
    l2cap: false,
    preferredPhy: false
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
    preferredPhy: false
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
    preferredPhy: false
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
    preferredPhy: false
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
    bonding: false,
    requestMtu: false,
    connectionPriority: false,
    iosStateRestoration: false,
    androidForegroundService: false,
    l2cap: false,
    preferredPhy: false
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
