// src/manager/index.ts

export {
  attachBleBackend,
  BleManager,
  createBleManager,
  createBleManagerFromProvider,
  createManagerOwnershipAuthority,
  Connection,
  DEFAULT_BLE_MANAGER_OPTIONS,
  DiscoveredGattDatabase,
  ScanSession,
  Subscription
} from './ble-manager'
export type { BleManagerOptions, ProviderBleManagerConstruction } from './ble-manager'
export { ManagerOwnershipAuthority } from './manager-ownership-authority'
export type { ManagerOwnershipParticipant, OwnershipTransferGrant } from './manager-ownership-authority'
