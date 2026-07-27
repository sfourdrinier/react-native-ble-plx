// __tests__/tck/deterministic/deterministic-gatt-error-mapping.test.js

const { opaqueId } = require('../../../src/backend-contract/primitives')
const { createDeterministicTestBackend } = require('../../../src/testing/deterministic/deterministic-test-backend')

function noOperationOptions() {
  return { signal: null, deadline: null }
}

describe('deterministic GATT error mapping', () => {
  test('maps unsupported characteristic write modes to gatt.property-not-supported', async () => {
    const fixture = createDeterministicTestBackend()
    const peerId = opaqueId('write-policy-peer', 'peer', 'deterministic:write-policy')
    const clientId = opaqueId('write-policy-client', 'client', 'deterministic:write-policy')
    const connection = fixture.backend.connections.connect(peerId, clientId, noOperationOptions())
    fixture.controller.clock.runUntilIdle()
    const lease = await connection
    const discovery = fixture.backend.gatt.discover(lease.connection, noOperationOptions())
    fixture.controller.clock.runUntilIdle()
    const database = await discovery
    const snapshot = await database.snapshot()
    const policyCharacteristic = snapshot.characteristics[1]
    if (policyCharacteristic === undefined) {
      throw new Error('default virtual peripheral must expose the write-policy characteristic')
    }

    const write = fixture.backend.gatt.write(policyCharacteristic.path, {
      operation: {
        correlation: opaqueId('unsupported-write', 'core-operation', 'deterministic:write-policy'),
        signal: null,
        deadline: null
      },
      bytes: new Uint8Array([1]),
      mode: 'without-response'
    })
    fixture.controller.clock.runUntilIdle()

    await expect(write.completion).rejects.toMatchObject({ normalized: { code: 'gatt.property-not-supported' } })
    await fixture.backend.destroy()
  })
})
