// __tests__/backends/corebluetooth/corebluetooth-native-advertisement-boundary.test.js

const fs = require('fs')
const path = require('path')

const repositoryRoot = path.resolve(__dirname, '../../..')
const addonSource = fs.readFileSync(path.join(repositoryRoot, 'native/electron/corebluetooth/src/addon.mm'), 'utf8')
const bridgePath = path.join(repositoryRoot, 'native/electron/corebluetooth')
const nativeAddonPath = path.join(
  bridgePath,
  'build',
  'Release',
  'unified_ble_corebluetooth.node'
)

function withDarwinPlatform(run) {
  const originalDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' })
  try {
    return run()
  } finally {
    if (originalDescriptor === undefined) {
      delete process.platform
    } else {
      Object.defineProperty(process, 'platform', originalDescriptor)
    }
  }
}

function loadBoundary(radio) {
  let createContractBoundary
  jest.isolateModules(() => {
    jest.doMock('fs', () => ({
      ...jest.requireActual('fs'),
      existsSync: candidate => candidate === nativeAddonPath
    }))
    jest.doMock(nativeAddonPath, () => ({ createNativeRadio: () => radio }), { virtual: true })
    ;({ createContractBoundary } = require(bridgePath))
  })
  return createContractBoundary
}

function createRadio() {
  return {
    startScan: jest.fn(() => Promise.resolve()),
    stopScan: jest.fn(() => Promise.resolve()),
    connect: jest.fn(() => Promise.resolve()),
    disconnect: jest.fn(() => Promise.resolve()),
    getConnectionState: jest.fn(() => 'disconnected'),
    getAdapterState: jest.fn(() => 'PoweredOn'),
    readRssi: jest.fn(() => Promise.resolve(-61)),
    maximumWriteValueLengthForType: jest.fn(() => Promise.resolve(182)),
    discoverServices: jest.fn(() => Promise.resolve([])),
    discoverCharacteristicsAt: jest.fn(() => Promise.resolve([])),
    readDescriptorAt: jest.fn(() => Promise.resolve(Buffer.alloc(0))),
    writeDescriptorAt: jest.fn(() => Promise.resolve()),
    readCharacteristicAt: jest.fn(() => Promise.resolve(Buffer.alloc(0))),
    writeCharacteristicAt: jest.fn(() => Promise.resolve()),
    startNotifyAt: jest.fn(() => Promise.resolve()),
    stopNotifyAt: jest.fn(() => Promise.resolve()),
    setDisconnectHandler: jest.fn(),
    setDatabaseChangedHandler: jest.fn(),
    setAdapterStateHandler: jest.fn(),
    destroy: jest.fn()
  }
}

describe('CoreBluetooth native advertisement boundary', () => {
  afterEach(() => {
    jest.resetModules()
    jest.dontMock('fs')
    jest.dontMock(nativeAddonPath)
  })

  test('projects the complete native advertisement shape without inventing unavailable records', async () => {
    const radio = createRadio()
    const createContractBoundary = loadBoundary(radio)

    await withDarwinPlatform(async () => {
      const boundary = createContractBoundary()
      const received = []
      await boundary.startScan(advertisement => received.push(advertisement), [])

      const scanCallback = radio.startScan.mock.calls[0][0]
      const serviceData = Buffer.from([0x01, 0x02])
      const manufacturerValue = Buffer.from([0x03, 0x04, 0x05])
      scanCallback({
        id: 'peripheral-id',
        name: 'advertised name',
        rssi: -54,
        serviceUuids: ['0000180d-0000-1000-8000-00805f9b34fb'],
        solicitedServiceUuids: ['0000180f-0000-1000-8000-00805f9b34fb'],
        overflowServiceUuids: ['12345678-1234-5678-9abc-def012345678'],
        serviceData: [{ serviceUuid: '0000180d-0000-1000-8000-00805f9b34fb', value: serviceData }],
        manufacturerData: [{ companyIdentifier: 76, value: manufacturerValue }],
        txPower: -7,
        connectable: true,
        appearance: null,
        rawRecord: null,
        scanResponseRecord: null
      })

      expect(received).toEqual([
        expect.objectContaining({
          nativePeerId: 'peripheral-id',
          localName: 'advertised name',
          rssi: -54,
          serviceUuids: ['0000180d-0000-1000-8000-00805f9b34fb'],
          solicitedServiceUuids: ['0000180f-0000-1000-8000-00805f9b34fb'],
          overflowServiceUuids: ['12345678-1234-5678-9abc-def012345678'],
          serviceData: [
            expect.objectContaining({
              serviceUuid: '0000180d-0000-1000-8000-00805f9b34fb',
              value: Uint8Array.from([0x01, 0x02])
            })
          ],
          manufacturerData: [
            expect.objectContaining({ companyIdentifier: 76, value: Uint8Array.from([0x03, 0x04, 0x05]) })
          ],
          txPower: -7,
          connectable: true,
          appearance: null,
          rawRecord: null,
          scanResponseRecord: null
        })
      ])
      expect(received[0].serviceData[0].value).not.toBe(serviceData)
      expect(received[0].manufacturerData[0].value).not.toBe(manufacturerValue)
    })
  })

  test('forwards native RSSI, write limits, and database changes without a radio', async () => {
    const radio = createRadio()
    const createContractBoundary = loadBoundary(radio)

    await withDarwinPlatform(async () => {
      const boundary = createContractBoundary()
      await expect(boundary.readRssi('peripheral-id')).resolves.toBe(-61)
      await expect(boundary.maximumWriteValueLength('peripheral-id', true)).resolves.toBe(182)
      expect(radio.readRssi).toHaveBeenCalledWith('peripheral-id')
      expect(radio.maximumWriteValueLengthForType).toHaveBeenCalledWith('peripheral-id', true)

      const changes = []
      const stop = boundary.onDatabaseChanged(nativePeerId => changes.push(nativePeerId))
      const nativeHandler = radio.setDatabaseChangedHandler.mock.calls[0][0]
      nativeHandler('peripheral-id')
      stop()
      nativeHandler('peripheral-id-ignored')
      expect(changes).toEqual(['peripheral-id'])
    })
  })

  test('waits for native invalidation before resolving destroy', async () => {
    const radio = createRadio()
    let completeInvalidation
    radio.destroy.mockImplementation(
      () =>
        new Promise(resolve => {
          completeInvalidation = resolve
        })
    )
    const createContractBoundary = loadBoundary(radio)

    await withDarwinPlatform(async () => {
      const boundary = createContractBoundary()
      const destroyed = boundary.destroy()
      let settled = false
      destroyed.then(() => {
        settled = true
      })
      await Promise.resolve()
      expect(radio.destroy).toHaveBeenCalledTimes(1)
      expect(settled).toBe(false)
      completeInvalidation()
      await expect(destroyed).resolves.toBeUndefined()
    })
  })

  test('uses CoreBluetooth public advertisement keys, copies byte payloads before TSFN handoff, and settles lifecycle waiters', () => {
    expect(addonSource).toContain('CBAdvertisementDataLocalNameKey')
    expect(addonSource).toContain('CBAdvertisementDataServiceUUIDsKey')
    expect(addonSource).toContain('CBAdvertisementDataSolicitedServiceUUIDsKey')
    expect(addonSource).toContain('CBAdvertisementDataOverflowServiceUUIDsKey')
    expect(addonSource).toContain('CBAdvertisementDataServiceDataKey')
    expect(addonSource).toContain('CBAdvertisementDataManufacturerDataKey')
    expect(addonSource).toContain('CBAdvertisementDataTxPowerLevelKey')
    expect(addonSource).toContain('CBAdvertisementDataIsConnectable')
    expect(addonSource).toContain('maximumWriteValueLengthForType')
    expect(addonSource).toContain('didReadRSSI')
    expect(addonSource).toContain('didModifyServices')
    expect(addonSource).toContain('pendingReadRssi')
    expect(addonSource).toContain('CopyBytes')
    expect(addonSource).toContain('Radio invalidated')
    expect(addonSource).toContain('pendingDisconnect')
  })
})
