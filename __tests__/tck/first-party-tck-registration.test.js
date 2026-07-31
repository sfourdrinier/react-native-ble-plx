// __tests__/tck/first-party-tck-registration.test.js

const {
  createFirstPartyBackendTckRegistry,
  createWebBluetoothFirstPartyTckRegistration,
  createCoreBluetoothFirstPartyTckRegistration,
  createBluezFirstPartyTckRegistration
} = require('../../src/testing')
const { InMemoryCoreBluetoothBoundary } = require('../../test-support/corebluetooth/in-memory-corebluetooth-boundary')
const { InMemoryWebBluetoothTckBoundary } = require('../../test-support/web/in-memory-web-bluetooth-tck-boundary')
const { createWebBluetoothFeatureRegistry } = require('../../src/web/web-feature-registry')
const {
  BLUEZ_ADAPTER_INTERFACE,
  BLUEZ_DEVICE_INTERFACE,
  BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
  BLUEZ_GATT_SERVICE_INTERFACE,
  InMemoryBluezBoundary
} = require('../../test-support/bluez/in-memory-bluez-object-manager')

const SERVICE_UUID = '0000180d-0000-1000-8000-00805f9b34fb'
const CHARACTERISTIC_UUID = '00002a37-0000-1000-8000-00805f9b34fb'
const BLUEZ_ADAPTER_PATH = '/org/bluez/hci0'
const BLUEZ_DEVICE_PATH = `${BLUEZ_ADAPTER_PATH}/dev_AA_BB_CC_DD_EE_FF`
const BLUEZ_SERVICE_PATH = `${BLUEZ_DEVICE_PATH}/service0001`
const BLUEZ_CHARACTERISTIC_PATH = `${BLUEZ_SERVICE_PATH}/char0001`

describe('first-party backend standard TCK registrations', () => {
  test('runs Web applicable provider and capability suites while retaining explicit platform exclusions', async () => {
    const boundaries = []
    const registration = createWebBluetoothFirstPartyTckRegistration({
      createBoundary: () => {
        const boundary = createWebTckBoundary()
        boundaries.push(boundary)
        return boundary
      },
      chooserRequest: webChooserRequest()
    })
    const registry = createFirstPartyBackendTckRegistry([
      registration
    ])

    const report = await registry.run('unified-ble:web-bluetooth')

    expect(report.standard.baseScenarioIds).toEqual([
      'identity.provider-loadability-and-adapter-availability',
      'identity.adapter-selection-and-unique-instance',
      'identity.valid-all-axis-negotiation',
      'identity.version-skew-and-malformed-offers',
      'capability.truth-limits-evidence-and-binding'
    ])
    expect(registration.featureSuites).toEqual([
      expect.objectContaining({
        suiteId: 'web-chooser-discovery',
        scenarioIds: [
          'web.chooser-connect-discover-read-notify-destroy',
          'web.unsupported-capabilities-reject-and-remain-honest'
        ]
      })
    ])
    expect(report.standard.featureSuiteIds).toEqual(['web-chooser-discovery'])
    expect(report.standard.featureBindings).toEqual([
      expect.objectContaining({
        featureId: 'web:chooser-discovery',
        suiteId: 'web-chooser-discovery',
        requiredScenarioIds: [
          'web.chooser-connect-discover-read-notify-destroy',
          'web.unsupported-capabilities-reject-and-remain-honest'
        ],
        evidenceScenarioIds: [
          'web.chooser-connect-discover-read-notify-destroy',
          'web.unsupported-capabilities-reject-and-remain-honest'
        ]
      })
    ])
    expect(report.standard.receipts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scenarioId: 'web.chooser-connect-discover-read-notify-destroy',
          error: null,
          facts: [
            expect.objectContaining({
              id: 'web-chooser-vertical-slice-preserves-selection-and-cleans-up',
              holds: true,
              detail: expect.objectContaining({ cancelledPeerRejected: true })
            })
          ]
        }),
        expect.objectContaining({
          scenarioId: 'web.unsupported-capabilities-reject-and-remain-honest',
          error: null,
          facts: [
            expect.objectContaining({
              id: 'web-unsupported-capabilities-reject-and-report-runtime-truth',
              holds: true,
              detail: expect.objectContaining({
                scanRejected: true,
                resourcesReleased: true,
                unsupportedFeatureIds: [
                  'web:background-operation',
                  'web:continuous-scan',
                  'web:state-restoration'
                ]
              })
            })
          ]
        })
      ])
    )
    const scenarioBoundary = boundaries.find(boundary => boundary.resourceSnapshot().chooserRequests === 2)
    expect(scenarioBoundary).toBeDefined()
    expect(scenarioBoundary.resourceSnapshot()).toMatchObject({
      lastChooserRequest: {
        filters: [{ services: [SERVICE_UUID], manufacturerData: [], namePrefix: null }],
        acceptAllDevices: false,
        optionalServices: [SERVICE_UUID]
      },
      connected: false,
      disconnectListeners: 0,
      notificationListeners: 0,
      activeTimers: 0
    })
    expect([...scenarioBoundary.expectedReadValue]).toEqual([0, 72])
    expect([...scenarioBoundary.expectedInitialNotificationValue]).toEqual([0, 73])
    const controllerFixture = await registration.factory.create({
      scenarioId: 'web.chooser-connect-discover-read-notify-destroy'
    })
    expect(controllerFixture.controller.availableActions).toEqual(['resolve-chooser', 'emit-notification'])
    expect(controllerFixture.controller.availableActions).not.toContain('queue-advertisement')
    const controllerBoundary = boundaries[boundaries.length - 1]
    expect(controllerBoundary).toBeDefined()
    expect(controllerFixture.featureScenarioAdapters.webChooser.expectedSelectedPeerId).toBe(
      controllerBoundary.expectedSelectedPeerId
    )
    expect(typeof controllerFixture.featureScenarioAdapters.webChooser.expectedSelectedPeerId).toBe('string')
    await controllerFixture.dispose()
    expect(report.capabilityExclusions.map(exclusion => exclusion.featureId)).toEqual([
      'web:continuous-scan',
      'web:background-operation',
      'web:state-restoration',
      'web:live-radio'
    ])
  })

  test('binds every blocked Web capability to the runner-owned unsupported-capability receipt', () => {
    const registry = createWebBluetoothFeatureRegistry('web-registry-receipt-binding-test')
    const canonicalReceiptId = 'web.unsupported-capabilities-reject-and-remain-honest'
    const expectedFeatureIds = [
      'web:background-operation',
      'web:continuous-scan',
      'web:state-restoration'
    ]

    for (const featureId of expectedFeatureIds) {
      const feature = registry.registrations.find(registration => registration.id === featureId)
      if (feature === undefined) {
        throw new Error(`Web feature registry lacks ${featureId}`)
      }
      expect(feature.tck.requiredScenarioIds).toEqual([canonicalReceiptId])
      expect(feature.evidence.scenarioIds).toEqual([canonicalReceiptId])
    }
  })

  test('executes the Web chooser scenario with contract-valid empty read and initial notification values', async () => {
    const boundaries = []
    const registry = createFirstPartyBackendTckRegistry([
      createWebBluetoothFirstPartyTckRegistration({
        createBoundary: () => {
          const boundary = new InMemoryWebBluetoothTckBoundary({
            implementationVersion: 'web-zero-length-tck-boundary',
            browserEngine: 'web-zero-length-tck-browser',
            expectedReadValue: new Uint8Array(),
            expectedInitialNotificationValue: new Uint8Array()
          })
          boundaries.push(boundary)
          return boundary
        },
        chooserRequest: webChooserRequest()
      })
    ])

    const report = await registry.run('unified-ble:web-bluetooth')
    const receipt = report.standard.receipts.find(
      candidate => candidate.scenarioId === 'web.chooser-connect-discover-read-notify-destroy'
    )
    expect(receipt).toMatchObject({
      error: null,
      facts: [
        expect.objectContaining({
          id: 'web-chooser-vertical-slice-preserves-selection-and-cleans-up',
          holds: true,
          detail: expect.objectContaining({
            cancelledPeerRejected: true,
            exactInitialNotification: true,
            exactReadBytes: true,
            exactSecondNotification: true,
            ownedReadBytes: true
          })
        })
      ]
    })
    const scenarioBoundary = boundaries.find(boundary => boundary.resourceSnapshot().chooserRequests === 2)
    expect(scenarioBoundary).toBeDefined()
    expect([...scenarioBoundary.expectedReadValue]).toEqual([])
    expect([...scenarioBoundary.expectedInitialNotificationValue]).toEqual([])
    expect(scenarioBoundary.resourceSnapshot()).toMatchObject({
      connected: false,
      disconnectListeners: 0,
      notificationListeners: 0,
      activeTimers: 0
    })
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

  test('runs the exact BlueZ provider and public vertical scenario profile with explicit exclusions', async () => {
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
      'capability.truth-limits-evidence-and-binding',
      'scenario.scan-connect-discover-read-notify-destroy'
    ])
    expect(report.standard.receipts).toHaveLength(6)
    expect(report.standard.receipts).toEqual(
      report.standard.baseScenarioIds.map(scenarioId =>
        expect.objectContaining({
          scenarioId,
          error: null,
          facts: expect.arrayContaining([expect.objectContaining({ holds: true })])
        })
      )
    )
    expect(report.standard.receipts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scenarioId: 'scenario.scan-connect-discover-read-notify-destroy',
          error: null,
          facts: [expect.objectContaining({ id: 'vertical-slice-preserves-scan-and-cleans-up', holds: true })]
        })
      ])
    )
    expect(
      report.capabilityExclusions.map(exclusion => ({ featureId: exclusion.featureId, state: exclusion.state }))
    ).toEqual([
      { featureId: 'bluez:acquire-write', state: 'unsupported' },
      { featureId: 'bluez:acquire-notify', state: 'unsupported' },
      { featureId: 'bluez:pairing-agent', state: 'unsupported' },
      { featureId: 'bluez:deterministic-advanced-scenario-controls', state: 'unavailable' },
      { featureId: 'bluez:live-radio', state: 'unavailable' }
    ])
    expect(report.capabilityExclusions.every(exclusion => exclusion.reason.length > 0)).toBe(true)
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
  return new InMemoryWebBluetoothTckBoundary({
    implementationVersion: 'web-first-party-tck-boundary',
    browserEngine: 'first-party-tck-browser'
  })
}

function webChooserRequest() {
  return {
    filters: [{ serviceUuids: [SERVICE_UUID], manufacturerData: [], localNamePrefix: null }],
    acceptAllDevices: false,
    optionalServices: [SERVICE_UUID]
  }
}

function createBluezTckBoundary(busKind = 'system') {
  const boundary = new InMemoryBluezBoundary({
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
      },
      {
        path: BLUEZ_DEVICE_PATH,
        interfaces: [
          {
            name: BLUEZ_DEVICE_INTERFACE,
            properties: {
              Address: { signature: 's', value: 'AA:BB:CC:DD:EE:FF' },
              AddressType: { signature: 's', value: 'random' },
              Alias: { signature: 's', value: 'BlueZ TCK peer' },
              RSSI: { signature: 'n', value: -40 },
              UUIDs: { signature: 'as', value: [SERVICE_UUID] },
              Connected: { signature: 'b', value: true },
              ServicesResolved: { signature: 'b', value: true }
            }
          }
        ]
      },
      {
        path: BLUEZ_SERVICE_PATH,
        interfaces: [
          {
            name: BLUEZ_GATT_SERVICE_INTERFACE,
            properties: {
              Device: { signature: 'o', value: BLUEZ_DEVICE_PATH },
              UUID: { signature: 's', value: SERVICE_UUID },
              Primary: { signature: 'b', value: true }
            }
          }
        ]
      },
      {
        path: BLUEZ_CHARACTERISTIC_PATH,
        interfaces: [
          {
            name: BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
            properties: {
              Service: { signature: 'o', value: BLUEZ_SERVICE_PATH },
              UUID: { signature: 's', value: CHARACTERISTIC_UUID },
              Flags: { signature: 'as', value: ['read', 'write', 'notify'] },
              Value: { signature: 'ay', value: new Uint8Array([1]) },
              Notifying: { signature: 'b', value: false }
            }
          }
        ]
      }
    ]
  })
  boundary.onCall(
    BLUEZ_CHARACTERISTIC_PATH,
    BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
    'ReadValue',
    async () => new Uint8Array([1])
  )
  return boundary
}
