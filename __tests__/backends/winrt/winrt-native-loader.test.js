// __tests__/backends/winrt/winrt-native-loader.test.js

const nativeAddonPath = require('path').resolve(__dirname, '../../../../native/electron/winrt')

const nativeBoundaryMethodNames = [
  'listAdapters',
  'selectAdapter',
  'adapterSnapshot',
  'startScan',
  'stopScan',
  'connect',
  'disconnect',
  'discover',
  'read',
  'write',
  'readDescriptor',
  'writeDescriptor',
  'startNotify',
  'stopNotify',
  'onConnectionLost',
  'onDatabaseChanged',
  'onAdapterState',
  'onScanTerminal',
  'ingressTelemetry',
  'destroy'
]

function withWindowsPlatform(run) {
  const originalDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
  try {
    return run()
  } finally {
    if (originalDescriptor === undefined) {
      delete process.platform
    } else {
      Object.defineProperty(process, 'platform', originalDescriptor)
    }
  }
}

function loadBoundary() {
  let createNativeWinRtBoundary
  jest.isolateModules(() => {
    ;({ createNativeWinRtBoundary } = require('../../../src/node-winrt'))
  })
  return createNativeWinRtBoundary
}

function mockBoundary({ includeScanTerminal = true } = {}) {
  const boundary = {}
  for (const method of nativeBoundaryMethodNames) {
    if (includeScanTerminal || method !== 'onScanTerminal') {
      boundary[method] = jest.fn()
    }
  }
  return boundary
}

function captureError(call) {
  try {
    call()
  } catch (error) {
    return error
  }
  throw new Error('Expected the WinRT native boundary loader to throw')
}

describe('WinRT native boundary loader', () => {
  afterEach(() => {
    jest.resetModules()
    jest.dontMock(nativeAddonPath)
  })

  test('fails closed with a typed diagnostic when the packaged artifact is unavailable', () => {
    jest.doMock(
      nativeAddonPath,
      () => {
        throw new Error('Cannot find WinRT Node-API artifact')
      },
      { virtual: true }
    )

    const createNativeWinRtBoundary = loadBoundary()

    withWindowsPlatform(() => {
      expect(captureError(() => createNativeWinRtBoundary())).toMatchObject({
        normalized: {
          code: 'capability.unavailable',
          domain: 'platform',
          operation: 'winrt.native-boundary.load',
          platform: {
            domain: 'winrt',
            code: 'native-artifact-unavailable'
          }
        }
      })
    })
  })

  test('rejects a malformed native boundary export with a typed protocol diagnostic', () => {
    jest.doMock(nativeAddonPath, () => ({ boundaryVersion: 1, createContractBoundary: jest.fn() }), { virtual: true })

    const createNativeWinRtBoundary = loadBoundary()

    withWindowsPlatform(() => {
      expect(captureError(() => createNativeWinRtBoundary())).toMatchObject({
        normalized: {
          code: 'protocol.incompatible',
          domain: 'boundary',
          operation: 'winrt.native-boundary.version'
        }
      })
    })
  })

  test('rejects a v2 native boundary that omits the mandatory scan-terminal listener', () => {
    jest.doMock(
      nativeAddonPath,
      () => ({ boundaryVersion: 2, createContractBoundary: () => mockBoundary({ includeScanTerminal: false }) }),
      { virtual: true }
    )

    const createNativeWinRtBoundary = loadBoundary()

    withWindowsPlatform(() => {
      expect(captureError(() => createNativeWinRtBoundary())).toMatchObject({
        normalized: {
          code: 'protocol.incompatible',
          domain: 'boundary',
          operation: 'winrt.native-boundary.surface'
        }
      })
    })
  })

  test('fails closed with a typed diagnostic when the native boundary cannot be constructed', () => {
    jest.doMock(
      nativeAddonPath,
      () => ({
        boundaryVersion: 2,
        createContractBoundary: () => {
          throw new Error('WinRT apartment initialization failed')
        }
      }),
      { virtual: true }
    )

    const createNativeWinRtBoundary = loadBoundary()

    withWindowsPlatform(() => {
      expect(captureError(() => createNativeWinRtBoundary())).toMatchObject({
        normalized: {
          code: 'capability.unavailable',
          domain: 'platform',
          operation: 'winrt.native-boundary.create',
          platform: {
            domain: 'winrt',
            code: 'native-boundary-unavailable'
          }
        }
      })
    })
  })
})
