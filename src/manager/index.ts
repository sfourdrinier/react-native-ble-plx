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
export {
  collectNotifications,
  connectAndDiscover,
  find,
  firstNotification,
  scanUntil,
  withConnection
} from './public-helpers'
export type { CollectNotificationsOptions, ConnectedGattDatabase, ScanUntilOptions } from './public-helpers'
export { ManagerOwnershipAuthority } from './manager-ownership-authority'
export type { ManagerOwnershipParticipant, OwnershipTransferGrant } from './manager-ownership-authority'
