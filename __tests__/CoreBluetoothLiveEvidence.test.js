// __tests__/CoreBluetoothLiveEvidence.test.js

'use strict'

const {
  runCoreBluetoothLiveVerticalSlice,
  zeroResourceCounters
} = require('../scripts/evidence/corebluetooth-live')

function released() {
  return { state: 'released', failures: [] }
}

function notificationStream(bytes) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { kind: 'value', value: { value: bytes } }
    }
  }
}

function failingNotificationStream(error) {
  return {
    async *[Symbol.asyncIterator]() {
      throw error
    }
  }
}

describe('CoreBluetooth physical evidence harness', () => {
  test('runs scan, connect, discover, read, notify, disconnect, reconnect, and zero-resource cleanup', async () => {
    const events = []
    const calls = []
    const peerId = 'opaque-peer-id-that-must-not-be-logged'
    const firstConnection = {
      connectionGeneration: 'generation-1',
      discover: async () => {
        calls.push('discover-1')
        return database
      },
      disconnect: async () => {
        calls.push('disconnect-1')
        return released()
      }
    }
    const secondConnection = {
      connectionGeneration: 'generation-2',
      discover: async () => {
        calls.push('discover-2')
        return database
      },
      disconnect: async () => {
        calls.push('disconnect-2')
        return released()
      }
    }
    const snapshot = { services: [{ path: {} }], characteristics: [{ path: {} }], descriptors: [] }
    const database = { snapshot: async () => snapshot }
    const subscription = {
      values: notificationStream(new Uint8Array([0, 72])),
      remove: async () => {
        calls.push('unsubscribe')
        return released()
      }
    }
    let connectionNumber = 0
    const manager = {
      connect: async receivedPeerId => {
        expect(receivedPeerId).toBe(peerId)
        connectionNumber += 1
        calls.push(`connect-${String(connectionNumber)}`)
        return connectionNumber === 1 ? firstConnection : secondConnection
      },
      destroy: async () => {
        calls.push('destroy')
        return released()
      },
      localResourceCounters: () => zeroResourceCounters()
    }
    const provider = {
      listAdapters: async () => [{ adapterId: 'corebluetooth-default-adapter' }]
    }

    const result = await runCoreBluetoothLiveVerticalSlice({
      api: {
        capacity: value => value,
        createBleManagerFromProvider: async construction => {
          expect(construction.selection.selectedAdapterId).toBe('corebluetooth-default-adapter')
          return manager
        },
        DEFAULT_BLE_MANAGER_OPTIONS: {},
        scanUntil: async () => ({ device: { id: peerId } })
      },
      coreBluetooth: {
        coreBluetoothCompatibility: {},
        createNativeCoreBluetoothBackendProvider: () => provider
      },
      profiles: {
        HEART_RATE_SERVICE: '0000180d-0000-1000-8000-00805f9b34fb',
        parseHeartRateMeasurement: bytes => ({ beatsPerMinute: bytes[1] }),
        readBatteryLevel: async () => 91,
        subscribeHeartRateMeasurements: async () => subscription
      },
      emit: event => events.push(event),
      now: () => 100,
      operationTimeoutMilliseconds: 1_000
    })

    expect(result).toEqual({
      batteryPercent: 91,
      beatsPerMinute: 72,
      services: 1,
      characteristics: 1,
      descriptors: 0,
      reconnectGenerationChanged: true,
      resources: zeroResourceCounters()
    })
    expect(calls).toEqual([
      'connect-1',
      'discover-1',
      'unsubscribe',
      'disconnect-1',
      'connect-2',
      'discover-2',
      'disconnect-2',
      'destroy'
    ])
    expect(JSON.stringify(events)).not.toContain(peerId)
    expect(events.map(event => event.operation)).toEqual([
      'adapter',
      'scan',
      'connect',
      'discover',
      'read',
      'notify',
      'disconnect',
      'reconnect',
      'destroy'
    ])
  })

  test('releases every acquired resource and reports operation plus cleanup failures together', async () => {
    const primaryFailure = new Error('read failed')
    const unsubscribeFailure = new Error('unsubscribe failed')
    const disconnectFailure = new Error('disconnect failed')
    const destroyFailure = new Error('destroy failed')
    const calls = []
    const subscription = {
      values: failingNotificationStream(primaryFailure),
      remove: async () => {
        calls.push('unsubscribe')
        throw unsubscribeFailure
      }
    }
    const connection = {
      connectionGeneration: 'generation-1',
      discover: async () => ({ snapshot: async () => ({ services: [], characteristics: [], descriptors: [] }) }),
      disconnect: async () => {
        calls.push('disconnect')
        throw disconnectFailure
      }
    }
    const manager = {
      connect: async () => connection,
      destroy: async () => {
        calls.push('destroy')
        throw destroyFailure
      },
      localResourceCounters: () => zeroResourceCounters()
    }

    await expect(runCoreBluetoothLiveVerticalSlice({
      api: {
        capacity: value => value,
        createBleManagerFromProvider: async () => manager,
        DEFAULT_BLE_MANAGER_OPTIONS: {},
        scanUntil: async () => ({ device: { id: 'peer' } })
      },
      coreBluetooth: {
        coreBluetoothCompatibility: {},
        createNativeCoreBluetoothBackendProvider: () => ({
          listAdapters: async () => [{ adapterId: 'corebluetooth-default-adapter' }]
        })
      },
      profiles: {
        HEART_RATE_SERVICE: 'heart-rate-service',
        parseHeartRateMeasurement: () => ({ beatsPerMinute: 72 }),
        readBatteryLevel: async () => 91,
        subscribeHeartRateMeasurements: async () => subscription
      },
      emit: () => undefined,
      now: () => 100,
      operationTimeoutMilliseconds: 1_000
    })).rejects.toMatchObject({
      name: 'AggregateError',
      errors: [primaryFailure, unsubscribeFailure, disconnectFailure, destroyFailure]
    })
    expect(calls).toEqual(['unsubscribe', 'disconnect', 'destroy'])
  })
})
