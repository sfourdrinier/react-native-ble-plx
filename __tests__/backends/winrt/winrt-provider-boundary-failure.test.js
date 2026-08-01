// __tests__/backends/winrt/winrt-provider-boundary-failure.test.js

const { createWinRtBackendProvider } = require('../../../src/backends/winrt/winrt-provider')
const { assertWinRtAdapterReady } = require('../../../src/backends/winrt/winrt-adapter-state')
const { opaqueId } = require('../../../src/backend-contract/primitives')

function completed(value) {
  return { completion: Promise.resolve(value), cancel: async () => 'already-terminal' }
}

function rejected(error) {
  return { completion: Promise.reject(error), cancel: async () => 'already-terminal' }
}

function adapter() {
  return {
    nativeAdapterId: 'native-winrt-adapter',
    displayName: 'WinRT adapter',
    state: { availability: 'available', authorization: 'granted', power: 'on', safeReason: null },
    deployment: 'unpackaged'
  }
}

function providerFor(boundary) {
  return createWinRtBackendProvider({
    boundaryFactory: () => boundary,
    now: () => 1,
    hostKind: 'node'
  })
}

describe('WinRT provider boundary failures', () => {
  test('does not admit an adapter with unavailable authorization or unknown power', () => {
    expect(() =>
      assertWinRtAdapterReady(
        { availability: 'available', authorization: 'unavailable', power: 'on', safeReason: null },
        'winrt.test.authorization'
      )
    ).toThrow('adapter.unavailable')
    expect(() =>
      assertWinRtAdapterReady(
        { availability: 'available', authorization: 'granted', power: 'unknown', safeReason: null },
        'winrt.test.power'
      )
    ).toThrow('adapter.unavailable')
  })

  test('rejects malformed adapter enumeration records before exposing provider descriptors', async () => {
    const boundary = {
      listAdapters: () =>
        completed([
          {
            nativeAdapterId: 'native-winrt-adapter',
            displayName: 'WinRT adapter',
            state: { availability: 'available', authorization: 'granted', power: 'on', safeReason: null },
            deployment: 'unpackaged',
            unexpected: true
          }
        ]),
      destroy: jest.fn(() => completed(undefined))
    }

    await expect(providerFor(boundary).listAdapters()).rejects.toMatchObject({
      normalized: {
        code: 'protocol.malformed',
        domain: 'boundary',
        operation: 'winrt.boundary.adapter-record'
      }
    })
    expect(boundary.destroy).toHaveBeenCalledTimes(1)
  })

  test('rejects adapter state vocabularies at the boundary', async () => {
    const boundary = {
      listAdapters: () =>
        completed([
          {
            nativeAdapterId: 'native-winrt-adapter',
            displayName: 'WinRT adapter',
            state: { availability: 'available', authorization: 'granted', power: 'sleeping', safeReason: null },
            deployment: 'unpackaged'
          }
        ]),
      destroy: jest.fn(() => completed(undefined))
    }

    await expect(providerFor(boundary).listAdapters()).rejects.toMatchObject({
      normalized: {
        code: 'protocol.malformed',
        domain: 'boundary',
        operation: 'winrt.boundary.adapter-snapshot'
      }
    })
    expect(boundary.destroy).toHaveBeenCalledTimes(1)
  })

  test('reports native adapter enumeration failure as a typed unavailable capability', async () => {
    const boundary = {
      listAdapters: () => rejected(new Error('Windows Bluetooth enumeration failed')),
      destroy: jest.fn(() => completed(undefined))
    }

    await expect(providerFor(boundary).listAdapters()).rejects.toMatchObject({
      normalized: {
        code: 'capability.unavailable',
        domain: 'platform',
        operation: 'winrt.provider.list-adapters',
        platform: {
          domain: 'winrt',
          code: 'native-adapter-enumeration-failed'
        }
      }
    })
    expect(boundary.destroy).toHaveBeenCalledTimes(1)
  })

  test('reports native adapter selection failure as a typed unavailable adapter', async () => {
    const boundary = {
      listAdapters: () => completed([adapter()]),
      selectAdapter: () => rejected(new Error('Windows Bluetooth adapter was removed')),
      destroy: jest.fn(() => completed(undefined))
    }

    await expect(
      providerFor(boundary).create({ selectedAdapterId: opaqueId('native-winrt-adapter', 'adapter', 'winrt') })
    ).rejects.toMatchObject({
      normalized: {
        code: 'adapter.unavailable',
        domain: 'adapter',
        operation: 'winrt.provider.select-adapter',
        platform: {
          domain: 'winrt',
          code: 'native-adapter-selection-failed'
        }
      }
    })
    expect(boundary.destroy).toHaveBeenCalledTimes(1)
  })
})
