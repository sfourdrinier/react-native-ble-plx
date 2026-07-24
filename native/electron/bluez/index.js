/**
 * Linux BlueZ packaging entry — re-exports TS BluezBlePort when built, or requires source via package.
 * Prefer: import { BluezBlePort } from 'unified-ble-manager' host native path.
 */
module.exports = {
  radioId: 'bluez-dbus-v1',
  // Binding is implemented in src/hosts/native/bluez/BluezBlePort.ts
  implementedIn: 'src/hosts/native/bluez/BluezBlePort.ts'
}
