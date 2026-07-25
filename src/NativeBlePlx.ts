import type { TurboModule } from 'react-native'
import { TurboModuleRegistry } from 'react-native'

type DeviceId = string
type Identifier = number
type UUID = string
type Base64 = string
type TransactionId = string
type ConnectionPriority = number
type CharacteristicSubscriptionType = 'notification' | 'indication'
type NativeState = 'Unknown' | 'Resetting' | 'Unsupported' | 'Unauthorized' | 'PoweredOff' | 'PoweredOn'
type NativeLogLevel = 'None' | 'Verbose' | 'Debug' | 'Info' | 'Warning' | 'Error'

type ScanOptions = {
  allowDuplicates?: boolean
  scanMode?: number
  callbackType?: number
  legacyScan?: boolean
}

type ConnectionOptions = {
  autoConnect?: boolean
  requestMTU?: number
  refreshGatt?: 'OnConnected'
  timeout?: number
}

type BackgroundModeOptions = {
  notificationTitle?: string
  notificationText?: string
}

type NativeDevice = {
  id: DeviceId
  name: string | null
  rssi: number | null
  mtu: number
  manufacturerData: Base64 | null
  rawScanRecord: Base64
  serviceData: { [uuid: string]: Base64 } | null
  serviceUUIDs: Array<UUID> | null
  localName: string | null
  txPowerLevel: number | null
  solicitedServiceUUIDs: Array<UUID> | null
  isConnectable: boolean | null
  overflowServiceUUIDs: Array<UUID> | null
}

type NativeService = {
  id: Identifier
  uuid: UUID
  deviceID: DeviceId
  isPrimary: boolean
}

type NativeCharacteristic = {
  id: Identifier
  uuid: UUID
  serviceID: Identifier
  serviceUUID: UUID
  deviceID: DeviceId
  isReadable: boolean
  isWritableWithResponse: boolean
  isWritableWithoutResponse: boolean
  isNotifiable: boolean
  isNotifying: boolean
  isIndicatable: boolean
  value: Base64 | null
}

type NativeDescriptor = {
  id: Identifier
  uuid: UUID
  characteristicID: Identifier
  characteristicUUID: UUID
  serviceID: Identifier
  serviceUUID: UUID
  deviceID: DeviceId
  value: Base64 | null
}

export type NativeBlePlxConstants = {
  ScanEvent: string
  ReadEvent: string
  StateChangeEvent: string
  RestoreStateEvent: string
  DisconnectionEvent: string
  /** GATT services-changed (iOS didModifyServices / Android onServiceChanged API 31+) */
  ServicesChangedEvent: string
}

export type RestorationStatus = {
  blePlxRestorationAdapterFound: boolean
  bleRestorationRegistryFound: boolean
  hasRegisterSelector: boolean
  initializeWasCalled: boolean
}

export interface Spec extends TurboModule {
  getConstants(): NativeBlePlxConstants

  addListener(eventType: string): void
  removeListeners(count: number): void

  createClient(restoreIdentifierKey: string | null): void
  checkRestorationStatus(): Promise<RestorationStatus>
  destroyClient(): Promise<void>

  state(): Promise<NativeState>

  startDeviceScan(filteredUUIDs: Array<UUID> | null, options: ScanOptions | null): Promise<void>
  stopDeviceScan(): Promise<void>

  requestConnectionPriorityForDevice(
    deviceIdentifier: DeviceId,
    connectionPriority: ConnectionPriority,
    transactionId: TransactionId
  ): Promise<NativeDevice>
  readRSSIForDevice(deviceIdentifier: DeviceId, transactionId: TransactionId): Promise<NativeDevice>
  requestMTUForDevice(deviceIdentifier: DeviceId, mtu: number, transactionId: TransactionId): Promise<NativeDevice>

  devices(deviceIdentifiers: Array<DeviceId>): Promise<Array<NativeDevice>>
  connectedDevices(serviceUUIDs: Array<UUID>): Promise<Array<NativeDevice>>

  connectToDevice(deviceIdentifier: DeviceId, options: ConnectionOptions | null): Promise<NativeDevice>
  cancelDeviceConnection(deviceIdentifier: DeviceId): Promise<NativeDevice>
  isDeviceConnected(deviceIdentifier: DeviceId): Promise<boolean>

  discoverAllServicesAndCharacteristicsForDevice(
    deviceIdentifier: DeviceId,
    transactionId: TransactionId
  ): Promise<NativeDevice>

  servicesForDevice(deviceIdentifier: DeviceId): Promise<Array<NativeService>>
  characteristicsForDevice(deviceIdentifier: DeviceId, serviceUUID: UUID): Promise<Array<NativeCharacteristic>>
  characteristicsForService(serviceIdentifier: Identifier): Promise<Array<NativeCharacteristic>>
  descriptorsForDevice(
    deviceIdentifier: DeviceId,
    serviceUUID: UUID,
    characteristicUUID: UUID
  ): Promise<Array<NativeDescriptor>>
  descriptorsForService(serviceIdentifier: Identifier, characteristicUUID: UUID): Promise<Array<NativeDescriptor>>
  descriptorsForCharacteristic(characteristicIdentifier: Identifier): Promise<Array<NativeDescriptor>>

  readCharacteristicForDevice(
    deviceIdentifier: DeviceId,
    serviceUUID: UUID,
    characteristicUUID: UUID,
    transactionId: TransactionId
  ): Promise<NativeCharacteristic>
  readCharacteristicForService(
    serviceIdentifier: Identifier,
    characteristicUUID: UUID,
    transactionId: TransactionId
  ): Promise<NativeCharacteristic>
  readCharacteristic(characteristicIdentifier: Identifier, transactionId: TransactionId): Promise<NativeCharacteristic>

  writeCharacteristicForDevice(
    deviceIdentifier: DeviceId,
    serviceUUID: UUID,
    characteristicUUID: UUID,
    valueBase64: Base64,
    withResponse: boolean,
    transactionId: TransactionId
  ): Promise<NativeCharacteristic>
  writeCharacteristicForService(
    serviceIdentifier: Identifier,
    characteristicUUID: UUID,
    valueBase64: Base64,
    withResponse: boolean,
    transactionId: TransactionId
  ): Promise<NativeCharacteristic>
  writeCharacteristic(
    characteristicIdentifier: Identifier,
    valueBase64: Base64,
    withResponse: boolean,
    transactionId: TransactionId
  ): Promise<NativeCharacteristic>

  monitorCharacteristicForDevice(
    deviceIdentifier: DeviceId,
    serviceUUID: UUID,
    characteristicUUID: UUID,
    transactionId: TransactionId,
    subscriptionType: CharacteristicSubscriptionType | null
  ): Promise<void>
  monitorCharacteristicForService(
    serviceIdentifier: Identifier,
    characteristicUUID: UUID,
    transactionId: TransactionId,
    subscriptionType: CharacteristicSubscriptionType | null
  ): Promise<void>
  monitorCharacteristic(
    characteristicIdentifier: Identifier,
    transactionId: TransactionId,
    subscriptionType: CharacteristicSubscriptionType | null
  ): Promise<void>

  readDescriptorForDevice(
    deviceIdentifier: DeviceId,
    serviceUUID: UUID,
    characteristicUUID: UUID,
    descriptorUUID: UUID,
    transactionId: TransactionId
  ): Promise<NativeDescriptor>
  readDescriptorForService(
    serviceIdentifier: Identifier,
    characteristicUUID: UUID,
    descriptorUUID: UUID,
    transactionId: TransactionId
  ): Promise<NativeDescriptor>
  readDescriptorForCharacteristic(
    characteristicIdentifier: Identifier,
    descriptorUUID: UUID,
    transactionId: TransactionId
  ): Promise<NativeDescriptor>
  readDescriptor(descriptorIdentifier: Identifier, transactionId: TransactionId): Promise<NativeDescriptor>

  writeDescriptorForDevice(
    deviceIdentifier: DeviceId,
    serviceUUID: UUID,
    characteristicUUID: UUID,
    descriptorUUID: UUID,
    valueBase64: Base64,
    transactionId: TransactionId
  ): Promise<NativeDescriptor>
  writeDescriptorForService(
    serviceIdentifier: Identifier,
    characteristicUUID: UUID,
    descriptorUUID: UUID,
    valueBase64: Base64,
    transactionId: TransactionId
  ): Promise<NativeDescriptor>
  writeDescriptorForCharacteristic(
    characteristicIdentifier: Identifier,
    descriptorUUID: UUID,
    valueBase64: Base64,
    transactionId: TransactionId
  ): Promise<NativeDescriptor>
  writeDescriptor(
    descriptorIdentifier: Identifier,
    valueBase64: Base64,
    transactionId: TransactionId
  ): Promise<NativeDescriptor>

  enableBackgroundMode(options: BackgroundModeOptions | null): Promise<boolean>
  disableBackgroundMode(): Promise<boolean>
  updateBackgroundNotification(options: BackgroundModeOptions | null): Promise<boolean>
  isBackgroundModeEnabled(): Promise<boolean>

  /** Android bonding (pairing). */
  createBond(deviceIdentifier: DeviceId): Promise<void>
  removeBond(deviceIdentifier: DeviceId): Promise<void>
  bondedDevices(): Promise<Array<NativeDevice>>
  /** Returns "none" | "bonding" | "bonded" */
  getBondState(deviceIdentifier: DeviceId): Promise<string>

  cancelTransaction(transactionId: TransactionId): Promise<void>
  setLogLevel(logLevel: NativeLogLevel): Promise<NativeLogLevel | void>
  logLevel(): Promise<NativeLogLevel>
}

export default TurboModuleRegistry.getEnforcing<Spec>('BlePlx')
