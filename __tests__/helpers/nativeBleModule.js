/**
 * Shared RN BleModule mock surface for package suites (F086).
 * Keeps event constants (including ServicesChangedEvent) and mock factories in one place.
 * All RN BleManager-style suites should install via installBleModuleMock() — do not
 * copy-paste partial Native.BleModule = { ... } objects (drift → false greens).
 */
/* eslint-disable no-import-assign */

/** Full event name surface used by BleManager (must stay complete). */
const BLE_MODULE_EVENT_CONSTANTS = {
  ScanEvent: 'scan_event',
  ReadEvent: 'read_event',
  StateChangeEvent: 'state_change_event',
  RestoreStateEvent: 'restore_state_event',
  DisconnectionEvent: 'disconnection_event',
  ServicesChangedEvent: 'services_changed_event'
}

function createMockDevice(overrides = {}) {
  return {
    id: 'mock-device-id',
    name: 'Mock Device',
    rssi: -50,
    mtu: 23,
    manufacturerData: null,
    rawScanRecord: '',
    serviceData: null,
    serviceUUIDs: null,
    localName: null,
    txPowerLevel: null,
    solicitedServiceUUIDs: null,
    isConnectable: true,
    overflowServiceUUIDs: null,
    ...overrides
  }
}

function createMockService(overrides = {}) {
  return {
    id: 'mock-service-id',
    uuid: 'mock-service-uuid',
    deviceID: 'mock-device-id',
    isPrimary: true,
    ...overrides
  }
}

function createMockCharacteristic(overrides = {}) {
  return {
    id: 'mock-characteristic-id',
    uuid: 'mock-characteristic-uuid',
    serviceID: 'mock-service-id',
    serviceUUID: 'mock-service-uuid',
    deviceID: 'mock-device-id',
    isReadable: true,
    isWritableWithResponse: true,
    isWritableWithoutResponse: false,
    isNotifiable: true,
    isNotifying: false,
    isIndicatable: false,
    value: null,
    ...overrides
  }
}

function createMockDescriptor(overrides = {}) {
  return {
    id: 'mock-descriptor-id',
    uuid: 'mock-descriptor-uuid',
    characteristicID: 'mock-characteristic-id',
    characteristicUUID: 'mock-characteristic-uuid',
    serviceID: 'mock-service-id',
    serviceUUID: 'mock-service-uuid',
    deviceID: 'mock-device-id',
    value: null,
    ...overrides
  }
}

/**
 * Full BleModule mock with all event names used by BleManager (incl. ServicesChangedEvent).
 * @param {object} [overrides] per-method overrides merged on top of defaults
 */
function createBleModuleMock(overrides = {}) {
  return {
    createClient: jest.fn(),
    destroyClient: jest.fn().mockResolvedValue(undefined),
    cancelTransaction: jest.fn(),
    setLogLevel: jest.fn(),
    logLevel: jest.fn(),
    enable: jest.fn(),
    disable: jest.fn(),
    state: jest.fn().mockResolvedValue('PoweredOn'),
    startDeviceScan: jest.fn().mockResolvedValue(undefined),
    stopDeviceScan: jest.fn().mockResolvedValue(undefined),
    readRSSIForDevice: jest.fn().mockResolvedValue(createMockDevice()),
    connectToDevice: jest.fn().mockResolvedValue(createMockDevice()),
    cancelDeviceConnection: jest.fn().mockResolvedValue(createMockDevice()),
    isDeviceConnected: jest.fn().mockResolvedValue(false),
    discoverAllServicesAndCharacteristicsForDevice: jest
      .fn()
      .mockResolvedValue(createMockDevice()),
    servicesForDevice: jest.fn().mockResolvedValue([]),
    characteristicsForDevice: jest.fn().mockResolvedValue([]),
    characteristicsForService: jest.fn().mockResolvedValue([]),
    descriptorsForDevice: jest.fn().mockResolvedValue([]),
    descriptorsForService: jest.fn().mockResolvedValue([]),
    descriptorsForCharacteristic: jest.fn().mockResolvedValue([]),
    readCharacteristicForDevice: jest.fn().mockResolvedValue(createMockCharacteristic()),
    readCharacteristicForService: jest.fn().mockResolvedValue(createMockCharacteristic()),
    readCharacteristic: jest.fn().mockResolvedValue(createMockCharacteristic()),
    writeCharacteristicForDevice: jest.fn().mockResolvedValue(createMockCharacteristic()),
    writeCharacteristicForService: jest.fn().mockResolvedValue(createMockCharacteristic()),
    writeCharacteristic: jest.fn().mockResolvedValue(createMockCharacteristic()),
    monitorCharacteristicForDevice: jest.fn().mockResolvedValue(null),
    monitorCharacteristicForService: jest.fn().mockResolvedValue(null),
    monitorCharacteristic: jest.fn().mockResolvedValue(null),
    readDescriptorForDevice: jest.fn().mockResolvedValue(createMockDescriptor()),
    readDescriptorForService: jest.fn().mockResolvedValue(createMockDescriptor()),
    readDescriptorForCharacteristic: jest.fn().mockResolvedValue(createMockDescriptor()),
    readDescriptor: jest.fn().mockResolvedValue(createMockDescriptor()),
    writeDescriptorForDevice: jest.fn().mockResolvedValue(createMockDescriptor()),
    writeDescriptorForService: jest.fn().mockResolvedValue(createMockDescriptor()),
    writeDescriptorForCharacteristic: jest.fn().mockResolvedValue(createMockDescriptor()),
    writeDescriptor: jest.fn().mockResolvedValue(createMockDescriptor()),
    devices: jest.fn().mockResolvedValue([]),
    connectedDevices: jest.fn().mockResolvedValue([]),
    requestMTUForDevice: jest.fn().mockResolvedValue(createMockDevice({ mtu: 512 })),
    requestConnectionPriorityForDevice: jest.fn().mockResolvedValue(createMockDevice()),
    createBond: jest.fn().mockResolvedValue(undefined),
    removeBond: jest.fn().mockResolvedValue(undefined),
    getBondState: jest.fn().mockResolvedValue('none'),
    enableBackgroundMode: jest.fn(),
    disableBackgroundMode: jest.fn(),
    updateBackgroundNotification: jest.fn(),
    isBackgroundModeEnabled: jest.fn().mockResolvedValue(false),
    checkRestorationStatus: jest.fn(),
    ...BLE_MODULE_EVENT_CONSTANTS,
    ...overrides
  }
}

/**
 * Install mock onto BleModule export (mutates Native.BleModule).
 * Always installs the full event surface (incl. ServicesChangedEvent).
 * @param {typeof import('../../src/BleModule')} Native
 * @param {object} [overrides]
 */
function installBleModuleMock(Native, overrides = {}) {
  Native.BleModule = createBleModuleMock(overrides)
  return Native.BleModule
}

/**
 * Assert the installed mock still has the complete event constant surface (F086 guard).
 * @param {object} bleModule
 */
function assertBleModuleEventConstants(bleModule) {
  for (const [key, value] of Object.entries(BLE_MODULE_EVENT_CONSTANTS)) {
    if (bleModule[key] !== value) {
      throw new Error(
        `BleModule mock missing/mismatched event constant ${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(bleModule[key])}`
      )
    }
  }
}

module.exports = {
  BLE_MODULE_EVENT_CONSTANTS,
  createMockDevice,
  createMockService,
  createMockCharacteristic,
  createMockDescriptor,
  createBleModuleMock,
  installBleModuleMock,
  assertBleModuleEventConstants
}
