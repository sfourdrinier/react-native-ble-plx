// __tests__/tck/first-party-tck-registration.test.js

const {
  createFirstPartyBackendTckRegistry,
  createWebBluetoothFirstPartyTckRegistration,
  createCoreBluetoothFirstPartyTckRegistration,
  createBluezFirstPartyTckRegistration
} = require('../../src/testing')
const { InMemoryCoreBluetoothBoundary } = require('../../test-support/corebluetooth/in-memory-corebluetooth-boundary')
const {
  BLUEZ_ADAPTER_INTERFACE,
  InMemoryBluezBoundary
} = require('../../test-support/bluez/in-memory-bluez-object-manager')

const SERVICE_UUID = '0000180d-0000-1000-8000-00805f9b34fb'
const CHARACTERISTIC_UUID = '00002a37-0000-1000-8000-00805f9b34fb'
const BLUEZ_ADAPTER_PATH = '/org/bluez/hci0'

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

  test('runs BlueZ provider scenarios and excludes lifecycle proof without its required deterministic controls', async () => {
    const registry = createFirstPartyBackendTckRegistry([
      createBluezFirstPartyTckRegistration({
        busKind: 'system',
        now: () => 20,
        selectedAdapterId: BLUEZ_ADAPTER_PATH,
        createBoundary: createBluezTckBoundary
      })
    ])

    const report = await registry.run('unified-ble:bluez-dbus')

    expect(report.standard.baseScenarioIds).toEqual([
      'identity.provider-loadability-and-adapter-availability',
      'identity.adapter-selection-and-unique-instance',
      'identity.valid-all-axis-negotiation',
      'identity.version-skew-and-malformed-offers',
      'capability.truth-limits-evidence-and-binding'
    ])
    expect(report.standard.receipts).toHaveLength(5)
    expect(report.standard.receipts).toEqual(
      report.standard.baseScenarioIds.map(scenarioId =>
        expect.objectContaining({
          scenarioId,
          error: null,
          facts: expect.arrayContaining([expect.objectContaining({ holds: true })])
        })
      )
    )
    expect(report.standard.baseScenarioIds).not.toContain(
      'lifecycle.destroy-idempotency-admission-and-exact-settlement'
    )
    expect(
      report.capabilityExclusions.map(exclusion => ({ featureId: exclusion.featureId, state: exclusion.state }))
    ).toEqual([
      { featureId: 'bluez:acquire-write', state: 'unsupported' },
      { featureId: 'bluez:acquire-notify', state: 'unsupported' },
      { featureId: 'bluez:pairing-agent', state: 'unsupported' },
      { featureId: 'bluez:deterministic-scenario-controls', state: 'unavailable' },
      { featureId: 'bluez:live-radio', state: 'unavailable' }
    ])
  })

  test('rejects a BlueZ TCK boundary that declares a bus different from the registration', async () => {
    const registration = createBluezFirstPartyTckRegistration({
      busKind: 'system',
      now: () => 20,
      selectedAdapterId: BLUEZ_ADAPTER_PATH,
      createBoundary: () => createBluezTckBoundary('session')
    })

    await expect(registration.factory.provider.listAdapters()).rejects.toThrow(
      'BlueZ TCK boundary expected system bus, received session'
    )
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

function createBluezTckBoundary(busKind = 'system') {
  return new InMemoryBluezBoundary({
    busKind,
    objects: [
      {
        path: BLUEZ_ADAPTER_PATH,
        interfaces: [
          {
            name: BLUEZ_ADAPTER_INTERFACE,
            properties: {
              Address: { signature: 's', value: '00:11:22:33:44:55' },
              Alias: { signature: 's', value: 'BlueZ TCK adapter' },
              Powered: { signature: 'b', value: true }
            }
          }
        ]
      }
    ]
  })
}
