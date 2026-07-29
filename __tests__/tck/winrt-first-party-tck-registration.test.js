// __tests__/tck/winrt-first-party-tck-registration.test.js

const { createWinRtFirstPartyTckRegistration } = require('../../src/testing')
const { runBackendTck } = require('../../src/tck')

const SERVICE_UUID = '0000180d-0000-1000-8000-00805f9b34fb'
const CHARACTERISTIC_UUID = '00002a37-0000-1000-8000-00805f9b34fb'

test('WinRT first-party factory executes provider and deterministic-boundary vertical standard scenarios', async () => {
  const registration = createWinRtFirstPartyTckRegistration({
    now: () => 20,
    nativePeerId: 'C0FFEE000001',
    createBoundary: () => new DeterministicWinRtBoundary()
  })

  const report = await runBackendTck(registration.factory, registration.featureSuites, {
    proofScope: 'deterministic',
    baseScenarioIds: registration.suites.flatMap(suite => suite.baseScenarioIds)
  })

  expect(report.baseScenarioIds).toContain('scenario.scan-connect-discover-read-notify-destroy')
  expect(
    report.receipts.find(receipt => receipt.scenarioId === 'scenario.scan-connect-discover-read-notify-destroy')
  ).toMatchObject({
    error: null,
    facts: [expect.objectContaining({ id: 'vertical-slice-preserves-scan-and-cleans-up', holds: true })]
  })
  expect(registration.capabilityExclusions).toEqual(
    expect.arrayContaining([expect.objectContaining({ featureId: 'winrt:live-radio', state: 'unavailable' })])
  )
})

class DeterministicWinRtBoundary {
  constructor() {
    this.scanHandler = null
    this.notificationHandlers = new Map()
    this.connected = new Set()
    this.connectionListeners = new Set()
    this.databaseListeners = new Set()
    this.adapterListeners = new Set()
  }

  listAdapters() {
    return operation([
      {
        nativeAdapterId: 'winrt-tck-adapter',
        displayName: 'WinRT TCK adapter',
        state: this.adapterSnapshot(),
        deployment: 'unpackaged'
      }
    ])
  }
  selectAdapter() {
    return operation(undefined)
  }
  adapterSnapshot() {
    return { availability: 'available', authorization: 'granted', power: 'on', safeReason: null }
  }
  startScan(_services, handler) {
    this.scanHandler = handler
    return operation(undefined)
  }
  stopScan() {
    this.scanHandler = null
    return operation(undefined)
  }
  connect(peerId) {
    this.connected.add(peerId)
    return operation(undefined)
  }
  disconnect(peerId) {
    this.connected.delete(peerId)
    return operation(undefined)
  }
  discover() {
    return operation({
      cacheMode: 'uncached',
      services: [
        {
          uuid: SERVICE_UUID,
          occurrence: 0,
          characteristics: [
            {
              uuid: CHARACTERISTIC_UUID,
              occurrence: 0,
              readable: true,
              writableWithResponse: true,
              writableWithoutResponse: true,
              notifiable: true,
              indicatable: false,
              descriptors: []
            }
          ]
        }
      ]
    })
  }
  read(address) {
    return operation(new Uint8Array([address.serviceOccurrence, address.characteristicOccurrence]))
  }
  write() {
    return operation(undefined)
  }
  readDescriptor() {
    return operation(new Uint8Array([0]))
  }
  writeDescriptor() {
    return operation(undefined)
  }
  startNotify(address, _mode, handler) {
    this.notificationHandlers.set(addressKey(address), handler)
    return operation(undefined)
  }
  stopNotify(address) {
    this.notificationHandlers.delete(addressKey(address))
    return operation(undefined)
  }
  onConnectionLost(listener) {
    this.connectionListeners.add(listener)
    return () => this.connectionListeners.delete(listener)
  }
  onDatabaseChanged(listener) {
    this.databaseListeners.add(listener)
    return () => this.databaseListeners.delete(listener)
  }
  onAdapterState(listener) {
    this.adapterListeners.add(listener)
    return () => this.adapterListeners.delete(listener)
  }
  ingressTelemetry() {
    return {
      notificationQueueDrops: 0,
      advertisementQueueDrops: 0,
      notificationCloseDrops: 0,
      advertisementCloseDrops: 0
    }
  }
  destroy() {
    this.scanHandler = null
    this.notificationHandlers.clear()
    return operation(undefined)
  }
  emitAdvertisement() {
    if (this.scanHandler === null) throw new Error('scan is not active')
    this.scanHandler({
      nativePeerId: 'C0FFEE000001',
      localName: 'WinRT TCK peer',
      rssi: -40,
      serviceUuids: [SERVICE_UUID],
      connectable: true
    })
  }
  emitNotification(address, bytes) {
    const handler = this.notificationHandlers.get(addressKey(address))
    if (handler === undefined) throw new Error('notification is not active')
    handler(new Uint8Array(bytes))
  }
}

function operation(value) {
  return { completion: Promise.resolve(value), cancel: async () => 'already-terminal' }
}
function addressKey(address) {
  return [
    address.nativePeerId,
    address.serviceUuid,
    address.serviceOccurrence,
    address.characteristicUuid,
    address.characteristicOccurrence
  ].join('|')
}
