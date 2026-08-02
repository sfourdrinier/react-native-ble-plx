// __tests__/backends/corebluetooth/corebluetooth-provider-preparation.test.js

'use strict'

const {
  createCoreBluetoothBackendProvider
} = require('../../../src/backends/corebluetooth/corebluetooth-provider')
const { prepareNativeCoreBluetoothBoundary } = require('../../../src/node-corebluetooth')

function poweredOn() {
  return { availability: 'available', authorization: 'granted', power: 'on', safeReason: null }
}

describe('CoreBluetooth provider boundary preparation', () => {
  test('prepares the asynchronous native adapter before projecting adapters', async () => {
    const calls = []
    const boundary = {
      adapterSnapshot: () => poweredOn(),
      destroy: async () => calls.push('destroy')
    }
    const provider = createCoreBluetoothBackendProvider({
      boundaryFactory: () => boundary,
      prepareBoundary: async received => {
        expect(received).toBe(boundary)
        calls.push('prepare')
      },
      now: () => 1,
      hostKind: 'node'
    })

    await expect(provider.listAdapters()).resolves.toHaveLength(1)
    expect(calls).toEqual(['prepare', 'destroy'])
  })

  test('destroys a boundary whose asynchronous preparation fails', async () => {
    const failure = new Error('adapter initialization failed')
    const destroy = jest.fn(() => Promise.resolve())
    const provider = createCoreBluetoothBackendProvider({
      boundaryFactory: () => ({ adapterSnapshot: () => poweredOn(), destroy }),
      prepareBoundary: async () => {
        throw failure
      },
      now: () => 1,
      hostKind: 'node'
    })

    await expect(provider.listAdapters()).rejects.toBe(failure)
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  test('removes a synchronously satisfied native state listener exactly once', async () => {
    const remove = jest.fn()
    const boundary = {
      adapterSnapshot: () => poweredOn(),
      onAdapterState: listener => {
        listener(poweredOn())
        return remove
      }
    }

    await expect(prepareNativeCoreBluetoothBoundary(boundary)).resolves.toBeUndefined()
    expect(remove).toHaveBeenCalledTimes(1)
  })
})
