import type { TurboModule } from 'react-native'
import { TurboModuleRegistry } from 'react-native'

export type NativeBlePlxConstants = {
  ScanEvent: string
  ReadEvent: string
  StateChangeEvent: string
  RestoreStateEvent: string
  DisconnectionEvent: string
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

  state(): Promise<string>

  startDeviceScan(filteredUUIDs: Array<string> | null, options: Object | null): Promise<void>
  stopDeviceScan(): Promise<void>

  requestConnectionPriorityForDevice(
    deviceIdentifier: string,
    connectionPriority: number,
    transactionId: string
  ): Promise<Object>
  readRSSIForDevice(deviceIdentifier: string, transactionId: string): Promise<Object>
  requestMTUForDevice(deviceIdentifier: string, mtu: number, transactionId: string): Promise<Object>

  devices(deviceIdentifiers: Array<string>): Promise<Array<Object>>
  connectedDevices(serviceUUIDs: Array<string>): Promise<Array<Object>>

  connectToDevice(deviceIdentifier: string, options: Object | null): Promise<Object>
  cancelDeviceConnection(deviceIdentifier: string): Promise<Object>
  isDeviceConnected(deviceIdentifier: string): Promise<boolean>

  discoverAllServicesAndCharacteristicsForDevice(deviceIdentifier: string, transactionId: string): Promise<Object>

  servicesForDevice(deviceIdentifier: string): Promise<Array<Object>>
  characteristicsForDevice(deviceIdentifier: string, serviceUUID: string): Promise<Array<Object>>
  characteristicsForService(serviceIdentifier: number): Promise<Array<Object>>
  descriptorsForDevice(
    deviceIdentifier: string,
    serviceUUID: string,
    characteristicUUID: string
  ): Promise<Array<Object>>
  descriptorsForService(serviceIdentifier: number, characteristicUUID: string): Promise<Array<Object>>
  descriptorsForCharacteristic(characteristicIdentifier: number): Promise<Array<Object>>

  readCharacteristicForDevice(
    deviceIdentifier: string,
    serviceUUID: string,
    characteristicUUID: string,
    transactionId: string
  ): Promise<Object>
  readCharacteristicForService(
    serviceIdentifier: number,
    characteristicUUID: string,
    transactionId: string
  ): Promise<Object>
  readCharacteristic(characteristicIdentifier: number, transactionId: string): Promise<Object>

  writeCharacteristicForDevice(
    deviceIdentifier: string,
    serviceUUID: string,
    characteristicUUID: string,
    valueBase64: string,
    withResponse: boolean,
    transactionId: string
  ): Promise<Object>
  writeCharacteristicForService(
    serviceIdentifier: number,
    characteristicUUID: string,
    valueBase64: string,
    withResponse: boolean,
    transactionId: string
  ): Promise<Object>
  writeCharacteristic(
    characteristicIdentifier: number,
    valueBase64: string,
    withResponse: boolean,
    transactionId: string
  ): Promise<Object>

  monitorCharacteristicForDevice(
    deviceIdentifier: string,
    serviceUUID: string,
    characteristicUUID: string,
    transactionId: string,
    subscriptionType: string | null
  ): Promise<void>
  monitorCharacteristicForService(
    serviceIdentifier: number,
    characteristicUUID: string,
    transactionId: string,
    subscriptionType: string | null
  ): Promise<void>
  monitorCharacteristic(
    characteristicIdentifier: number,
    transactionId: string,
    subscriptionType: string | null
  ): Promise<void>

  readDescriptorForDevice(
    deviceIdentifier: string,
    serviceUUID: string,
    characteristicUUID: string,
    descriptorUUID: string,
    transactionId: string
  ): Promise<Object>
  readDescriptorForService(
    serviceIdentifier: number,
    characteristicUUID: string,
    descriptorUUID: string,
    transactionId: string
  ): Promise<Object>
  readDescriptorForCharacteristic(
    characteristicIdentifier: number,
    descriptorUUID: string,
    transactionId: string
  ): Promise<Object>
  readDescriptor(descriptorIdentifier: number, transactionId: string): Promise<Object>

  writeDescriptorForDevice(
    deviceIdentifier: string,
    serviceUUID: string,
    characteristicUUID: string,
    descriptorUUID: string,
    valueBase64: string,
    transactionId: string
  ): Promise<Object>
  writeDescriptorForService(
    serviceIdentifier: number,
    characteristicUUID: string,
    descriptorUUID: string,
    valueBase64: string,
    transactionId: string
  ): Promise<Object>
  writeDescriptorForCharacteristic(
    characteristicIdentifier: number,
    descriptorUUID: string,
    valueBase64: string,
    transactionId: string
  ): Promise<Object>
  writeDescriptor(descriptorIdentifier: number, valueBase64: string, transactionId: string): Promise<Object>

  enableBackgroundMode(options: Object | null): Promise<boolean>
  disableBackgroundMode(): Promise<boolean>
  updateBackgroundNotification(options: Object | null): Promise<boolean>
  isBackgroundModeEnabled(): Promise<boolean>

  cancelTransaction(transactionId: string): Promise<void>
  setLogLevel(logLevel: string): Promise<string | void>
  logLevel(): Promise<string>
}

export default TurboModuleRegistry.getEnforcing<Spec>('BlePlx')
