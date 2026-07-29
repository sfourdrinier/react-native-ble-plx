// __tests__/backends/winrt/winrt-native-loader.test.js

const nativeAddonPath = require('path').resolve(__dirname, '../../../../native/electron/winrt')

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
    jest.doMock(nativeAddonPath, () => {
      throw new Error('Cannot find WinRT Node-API artifact')
    }, { virtual: true })

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
    jest.doMock(nativeAddonPath, () => ({ nativeProtocolVersion: 1 }), { virtual: true })

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

  test('fails closed with a typed diagnostic when the native boundary cannot be constructed', () => {
    jest.doMock(
      nativeAddonPath,
      () => ({
        nativeProtocolVersion: 1,
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
