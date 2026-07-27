// __tests__/tck/deterministic/deterministic-resource-counters.test.js

const { capacity, opaqueId } = require('../../../src/backend-contract/primitives')
const { createDeterministicTestBackend } = require('../../../src/testing/deterministic/deterministic-test-backend')

function scanOptions() {
  return {
    filter: { serviceUuids: [], localNamePrefix: null },
    duplicatePolicy: 'all',
    timestampPolicy: 'receipt-monotonic',
    delivery: {
      itemCapacity: capacity(1),
      byteCapacity: capacity(2),
      reservedControlCapacity: capacity(1),
      overflowPolicy: 'drop-oldest'
    },
    deadline: null,
    signal: null,
    sharing: { mode: 'owner', allowSharing: false }
  }
}

describe('deterministic resource counters', () => {
  test('reports retained records rather than idle control-capacity reservations', async () => {
    const fixture = createDeterministicTestBackend()

    expect(Number(fixture.backend.resourceCounters().retainedByteBuffers)).toBe(0)

    const events = fixture.backend.events()[Symbol.asyncIterator]()
    fixture.controller.setAdapterState('available', 'granted', 'off', 'counter regression')

    expect(Number(fixture.backend.resourceCounters().retainedByteBuffers)).toBe(1)
    await events.next()
    expect(Number(fixture.backend.resourceCounters().retainedByteBuffers)).toBe(0)

    await fixture.backend.destroy()
  })

  test('admits an idle control reservation exactly at the aggregate quota', async () => {
    const fixture = createDeterministicTestBackend({ aggregateStreamByteQuota: 1 })

    const started = fixture.backend.scanner.start(
      scanOptions(),
      opaqueId('counter-client', 'client', 'deterministic:counter')
    )
    fixture.controller.clock.runUntilIdle()
    const scan = await started

    expect(Number(fixture.backend.resourceCounters().retainedByteBuffers)).toBe(0)
    const stopped = scan.stop()
    fixture.controller.clock.runUntilIdle()
    await stopped
    await fixture.backend.destroy()
  })
})
