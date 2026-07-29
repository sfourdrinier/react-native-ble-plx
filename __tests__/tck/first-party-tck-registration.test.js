// __tests__/tck/first-party-tck-registration.test.js

const {
  createFirstPartyBackendTckRegistry,
  createWebBluetoothFirstPartyTckRegistration,
  createCoreBluetoothFirstPartyTckRegistration
} = require('../../src/testing')
const { InMemoryCoreBluetoothBoundary } = require('../../test-support/corebluetooth/in-memory-corebluetooth-boundary')

const SERVICE_UUID = '0000180d-0000-1000-8000-00805f9b34fb'
const CHARACTERISTIC_UUID = '00002a37-0000-1000-8000-00805f9b34fb'

describe('first-party backend standard TCK registrations', () => {
  test('runs Web applicable provider and capability suites while retaining explicit platform exclusions', async () => {
    const registry = createFirstPartyBackendTckRegistry([
      createWebBluetoothFirstPartyTckRegistration({ createBoundary: createWebTckBoundary })
    ])

    const report = await registry.run('unified-ble:web-bluetooth')

    expect(report.standard.baseScenarioIds).toEqual([
      'identity.provider-loadability-and-adapter-availability',
      'identity.adapter-selection-and-unique-instance',
      'identity.valid-all-axis-negotiation',
      'identity.version-skew-and-malformed-offers',
      'capability.truth-limits-evidence-and-binding'
    ])
    expect(report.capabilityExclusions.map(exclusion => exclusion.featureId)).toEqual([
      'web:continuous-scan',
      'web:background-operation',
      'web:state-restoration'
    ])
  })

  test('runs CoreBluetooth deterministic boundary vertical suite through the standard runner', async () => {
    const registry = createFirstPartyBackendTckRegistry([
      createCoreBluetoothFirstPartyTckRegistration({
        now: () => 20,
        nativePeerId: 'native-polar-h10',
        createBoundary: () =>
          new InMemoryCoreBluetoothBoundary({ serviceUuid: SERVICE_UUID, characteristicUuid: CHARACTERISTIC_UUID })
      })
    ])

    const report = await registry.run('unified-ble:corebluetooth')

    expect(report.standard.baseScenarioIds).toContain('scenario.scan-connect-discover-read-notify-destroy')
    expect(
      report.standard.receipts.find(
        receipt => receipt.scenarioId === 'scenario.scan-connect-discover-read-notify-destroy'
      )
    ).toMatchObject({
      error: null,
      facts: [expect.objectContaining({ id: 'vertical-slice-preserves-scan-and-cleans-up', holds: true })]
    })
  })
})

function createWebTckBoundary() {
  return {
    implementationVersion: 'web-first-party-tck-boundary',
    browserEngine: 'first-party-tck-browser',
    isSecureContext: () => true,
    hasTransientUserActivation: () => true,
    bluetoothAvailable: async () => true,
    requestDevice: async () => {
      throw new Error('Web provider/capability TCK suite must not open a chooser')
    },
    permittedDevices: async () => [],
    now: () => 20,
    setTimer: () => ({ id: 'web-first-party-tck-timer' }),
    clearTimer: () => undefined,
    addPageLifecycleListener: () => () => undefined
  }
}
