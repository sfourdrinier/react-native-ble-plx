// scripts/evidence/corebluetooth-live.js

'use strict'

const DEFAULT_OPERATION_TIMEOUT_MILLISECONDS = 60_000

function zeroResourceCounters() {
  return {
    activeScanControllers: 0,
    scanConsumers: 0,
    chooserSessions: 0,
    connectionLeases: 0,
    physicalLinks: 0,
    databaseSnapshots: 0,
    physicalCccdEnablements: 0,
    subscriptionConsumers: 0,
    queuedOperations: 0,
    dispatchedOperations: 0,
    retainedByteBuffers: 0,
    restorationRecords: 0,
    orphanedIpcOwners: 0
  }
}

function assertReleased(cleanup, operation) {
  if (cleanup?.state !== 'released' || !Array.isArray(cleanup.failures) || cleanup.failures.length !== 0) {
    throw new Error(`${operation} did not release every owned resource`)
  }
}

function assertZeroResources(counters) {
  const expectedKeys = Object.keys(zeroResourceCounters())
  if (
    counters === null ||
    typeof counters !== 'object' ||
    expectedKeys.some(key => !Object.hasOwn(counters, key) || Number(counters[key]) !== 0)
  ) {
    throw new Error('manager destroy retained one or more local resources')
  }
}

function toError(error) {
  return error instanceof Error ? error : new Error(String(error))
}

async function captureCleanup(failures, operation) {
  try {
    await operation()
  } catch (error) {
    failures.push(toError(error))
  }
}

async function firstNotificationValue(subscription) {
  const iterator = subscription.values[Symbol.asyncIterator]()
  let primaryFailure = null
  try {
    const result = await iterator.next()
    if (result.done === true || result.value?.kind !== 'value') {
      throw new Error(`notification stream ended with ${String(result.value?.kind ?? 'closed')} before a value`)
    }
    return result.value.value.value
  } catch (error) {
    primaryFailure = toError(error)
    throw primaryFailure
  } finally {
    try {
      await iterator.return()
    } catch (error) {
      const cleanupFailure = toError(error)
      if (primaryFailure !== null) {
        throw new AggregateError([primaryFailure, cleanupFailure], 'notification read and iterator cleanup failed')
      }
      throw cleanupFailure
    }
  }
}

function emitEvent(emit, operation, details = {}) {
  emit(Object.freeze({ operation, result: 'passed', ...details }))
}

function scanOptions(api, heartRateService, signal, deadlineAt) {
  return {
    filter: { serviceUuids: [heartRateService], manufacturerData: [], localNamePrefix: null },
    duplicatePolicy: 'first',
    timestampPolicy: 'source-then-receipt',
    delivery: {
      itemCapacity: api.capacity(32),
      byteCapacity: api.capacity(16 * 1024),
      reservedControlCapacity: api.capacity(2),
      overflowPolicy: 'drop-oldest'
    },
    deadline: deadlineAt,
    signal,
    sharing: { mode: 'owner', allowSharing: false }
  }
}

function subscriptionOptions(api, signal, deadlineAt) {
  return {
    signal,
    deadline: deadlineAt,
    delivery: {
      itemCapacity: api.capacity(16),
      byteCapacity: api.capacity(8 * 1024),
      reservedControlCapacity: api.capacity(2),
      overflowPolicy: 'drop-oldest'
    }
  }
}

async function cleanupAcquiredResources(state) {
  const failures = []
  if (state.subscription !== null) {
    await captureCleanup(failures, async () => {
      assertReleased(await state.subscription.remove(), 'notification removal')
      state.subscription = null
    })
  }
  if (state.connection !== null) {
    await captureCleanup(failures, async () => {
      assertReleased(await state.connection.disconnect(), 'connection disconnect')
      state.connection = null
    })
  }
  if (state.manager !== null) {
    await captureCleanup(failures, async () => {
      assertReleased(await state.manager.destroy(), 'manager destroy')
      assertZeroResources(state.manager.localResourceCounters())
      state.manager = null
    })
  }
  return failures
}

async function runCoreBluetoothLiveVerticalSlice(options) {
  const { api, coreBluetooth, profiles, emit, now } = options
  const timeoutMilliseconds = options.operationTimeoutMilliseconds ?? DEFAULT_OPERATION_TIMEOUT_MILLISECONDS
  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), timeoutMilliseconds)
  const deadlineAt = now() + timeoutMilliseconds
  const operationOptions = { signal: abortController.signal, deadline: deadlineAt }
  const state = { manager: null, connection: null, subscription: null }
  let result = null
  let primaryFailure = null

  try {
    const provider = coreBluetooth.createNativeCoreBluetoothBackendProvider({ now })
    const adapters = await provider.listAdapters()
    const adapter = adapters[0]
    if (adapter === undefined || adapters.length !== 1) {
      throw new Error('CoreBluetooth must expose exactly one selected default central adapter')
    }
    emitEvent(emit, 'adapter', { adapterCount: adapters.length })

    state.manager = await api.createBleManagerFromProvider(
      {
        provider,
        selection: { selectedAdapterId: adapter.adapterId },
        coreCompatibility: coreBluetooth.coreBluetoothCompatibility,
        manager: {
          clientId: 'corebluetooth-live-evidence-client',
          managerId: 'corebluetooth-live-evidence-manager',
          ownerMode: 'owning'
        }
      },
      { ...api.DEFAULT_BLE_MANAGER_OPTIONS, now }
    )

    const observation = await api.scanUntil(state.manager, {
      scan: scanOptions(api, profiles.HEART_RATE_SERVICE, abortController.signal, deadlineAt),
      matches: () => true
    })
    emitEvent(emit, 'scan', { matchedService: 'heart-rate' })

    state.connection = await state.manager.connect(observation.device.id, operationOptions)
    const firstGeneration = String(state.connection.connectionGeneration)
    emitEvent(emit, 'connect')

    let database = await state.connection.discover(operationOptions)
    let snapshot = await database.snapshot()
    emitEvent(emit, 'discover', {
      services: snapshot.services.length,
      characteristics: snapshot.characteristics.length,
      descriptors: snapshot.descriptors.length
    })

    const batteryPercent = await profiles.readBatteryLevel(database, operationOptions)
    emitEvent(emit, 'read', { profile: 'battery-level', valueRangeValidated: batteryPercent >= 0 && batteryPercent <= 100 })

    state.subscription = await profiles.subscribeHeartRateMeasurements(
      database,
      subscriptionOptions(api, abortController.signal, deadlineAt)
    )
    const notificationBytes = await firstNotificationValue(state.subscription)
    const heartRate = profiles.parseHeartRateMeasurement(notificationBytes)
    assertReleased(await state.subscription.remove(), 'notification removal')
    state.subscription = null
    emitEvent(emit, 'notify', { profile: 'heart-rate-measurement', parsed: true })

    assertReleased(await state.connection.disconnect(), 'connection disconnect')
    state.connection = null
    emitEvent(emit, 'disconnect')

    state.connection = await state.manager.connect(observation.device.id, operationOptions)
    const reconnectGenerationChanged = String(state.connection.connectionGeneration) !== firstGeneration
    if (!reconnectGenerationChanged) {
      throw new Error('reconnect did not create a new connection generation')
    }
    database = await state.connection.discover(operationOptions)
    snapshot = await database.snapshot()
    assertReleased(await state.connection.disconnect(), 'reconnect disconnect')
    state.connection = null
    emitEvent(emit, 'reconnect', { generationChanged: true, rediscovered: true })

    assertReleased(await state.manager.destroy(), 'manager destroy')
    const resources = state.manager.localResourceCounters()
    assertZeroResources(resources)
    state.manager = null
    emitEvent(emit, 'destroy', { resourcesZero: true })

    result = {
      batteryPercent,
      beatsPerMinute: heartRate.beatsPerMinute,
      services: snapshot.services.length,
      characteristics: snapshot.characteristics.length,
      descriptors: snapshot.descriptors.length,
      reconnectGenerationChanged,
      resources
    }
  } catch (error) {
    primaryFailure = toError(error)
  } finally {
    clearTimeout(timeout)
  }

  const cleanupFailures = await cleanupAcquiredResources(state)
  if (primaryFailure !== null || cleanupFailures.length > 0) {
    const failures = primaryFailure === null ? cleanupFailures : [primaryFailure, ...cleanupFailures]
    throw failures.length === 1 ? failures[0] : new AggregateError(failures, 'CoreBluetooth live vertical slice failed')
  }
  if (result === null) {
    throw new Error('CoreBluetooth live vertical slice completed without a result')
  }
  return result
}

function productionDependencies() {
  const api = require('unified-ble-manager')
  const coreBluetooth = require('unified-ble-manager/node/corebluetooth')
  const standardCommands = require('unified-ble-manager/profiles/standard-commands')
  const heartRate = require('unified-ble-manager/profiles/heart-rate')
  return {
    api,
    coreBluetooth,
    profiles: { ...standardCommands, ...heartRate },
    emit: event => process.stdout.write(`${JSON.stringify(event)}\n`),
    now: () => performance.now()
  }
}

async function main() {
  const result = await runCoreBluetoothLiveVerticalSlice(productionDependencies())
  process.stdout.write(`${JSON.stringify({ operation: 'vertical-slice', result: 'passed', summary: result })}\n`)
}

if (require.main === module) {
  main().catch(error => {
    const failure = toError(error)
    process.stderr.write(`${JSON.stringify({ operation: 'vertical-slice', result: 'failed', error: failure.message })}\n`)
    process.exitCode = 1
  })
}

module.exports = { runCoreBluetoothLiveVerticalSlice, zeroResourceCounters }
