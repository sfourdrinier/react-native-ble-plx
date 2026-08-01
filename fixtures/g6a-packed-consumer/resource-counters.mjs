// fixtures/g6a-packed-consumer/resource-counters.mjs

export const RESOURCE_COUNTER_KEYS = Object.freeze([
  'activeScanControllers',
  'scanConsumers',
  'chooserSessions',
  'connectionLeases',
  'physicalLinks',
  'databaseSnapshots',
  'physicalCccdEnablements',
  'subscriptionConsumers',
  'queuedOperations',
  'dispatchedOperations',
  'retainedByteBuffers',
  'restorationRecords',
  'orphanedIpcOwners'
])

export function strictNumericCounters(counters, hostLabel) {
  if (counters === null || typeof counters !== 'object' || Array.isArray(counters)) {
    throw new TypeError(`packed ${hostLabel} resource counters must be an object`)
  }
  const actualKeys = Object.keys(counters).sort()
  const expectedKeys = [...RESOURCE_COUNTER_KEYS].sort()
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new TypeError(`packed ${hostLabel} resource counters must contain exactly the canonical keys`)
  }
  return Object.fromEntries(
    RESOURCE_COUNTER_KEYS.map(key => {
      const value = counters[key]
      if (typeof value !== 'number' || Number.isSafeInteger(value) === false || value < 0) {
        throw new TypeError(`packed ${hostLabel} resource counter ${key} must be a finite non-negative safe integer`)
      }
      return [key, value]
    })
  )
}
