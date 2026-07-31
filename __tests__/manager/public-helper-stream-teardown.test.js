// __tests__/manager/public-helper-stream-teardown.test.js

const { capacity } = require('../../src/backend-contract/primitives')
const { CoreBoundedStream } = require('../../src/core/bounded-stream')
const { find } = require('../../src/manager/public-helpers')

function limits() {
  return {
    itemCapacity: capacity(2),
    byteCapacity: capacity(6),
    reservedControlCapacity: capacity(1)
  }
}

function createPendingScanManager(stream) {
  let monotonicNow = 0
  let stopCalls = 0
  const deadlines = []
  return {
    manager: {
      scan: async () => ({
        observations: stream,
        stop: async () => {
          stopCalls += 1
          return { state: 'released', failures: [] }
        }
      }),
      monotonicNow: () => monotonicNow,
      scheduleDeadline: (deadline, action) => {
        const entry = { deadline, action, cancelled: false }
        deadlines.push(entry)
        return {
          cancel: () => {
            entry.cancelled = true
          }
        }
      }
    },
    advanceTo: nextTime => {
      monotonicNow = nextTime
      for (const deadline of deadlines) {
        if (!deadline.cancelled && deadline.deadline <= monotonicNow) {
          deadline.cancelled = true
          deadline.action()
        }
      }
    },
    stopCalls: () => stopCalls
  }
}

function options(signal, deadline) {
  return {
    scan: { signal, deadline },
    matches: () => false
  }
}

async function flush() {
  for (let turn = 0; turn < 4; turn += 1) {
    await Promise.resolve()
  }
}

describe('public helper stream teardown', () => {
  test('repeated aborts and deadlines return pending iterators before cleanup without source activity', async () => {
    for (let index = 0; index < 3; index += 1) {
      const abortedStream = new CoreBoundedStream(limits(), 'drop-newest')
      const abortedRuntime = createPendingScanManager(abortedStream)
      const aborted = new AbortController()
      const abortedFind = find(abortedRuntime.manager, options(aborted.signal, null))

      await flush()
      expect(abortedStream.consumers).toHaveLength(1)
      aborted.abort()

      await expect(abortedFind).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
      expect(abortedStream.consumers).toHaveLength(0)
      expect(abortedStream.retainedBytes()).toBe(1)
      expect(abortedRuntime.stopCalls()).toBe(1)

      const timedOutStream = new CoreBoundedStream(limits(), 'drop-newest')
      const timedOutRuntime = createPendingScanManager(timedOutStream)
      const timedOutFind = find(timedOutRuntime.manager, options(null, 5))

      await flush()
      expect(timedOutStream.consumers).toHaveLength(1)
      timedOutRuntime.advanceTo(5)

      await expect(timedOutFind).rejects.toMatchObject({ normalized: { code: 'operation.timed-out' } })
      expect(timedOutStream.consumers).toHaveLength(0)
      expect(timedOutStream.retainedBytes()).toBe(1)
      expect(timedOutRuntime.stopCalls()).toBe(1)
    }
  })
})
