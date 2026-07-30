// __tests__/backends/corebluetooth/corebluetooth-native-loader.test.js

const nativeAddonPath = require('path').resolve(__dirname, '../../../../native/electron/corebluetooth')

function withDarwinPlatform(run) {
  const originalDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' })
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
  let createNativeCoreBluetoothBoundary
  jest.isolateModules(() => {
    ;({ createNativeCoreBluetoothBoundary } = require('../../../src/node-corebluetooth'))
  })
  return createNativeCoreBluetoothBoundary
}

function captureError(call) {
  try {
    call()
  } catch (error) {
    return error
  }
  throw new Error('Expected the CoreBluetooth native boundary loader to throw')
}

describe('CoreBluetooth native boundary loader', () => {
  afterEach(() => {
    jest.resetModules()
    jest.dontMock(nativeAddonPath)
  })

  test('fails closed with a typed diagnostic when the packaged artifact is unavailable', () => {
    jest.doMock(nativeAddonPath, () => {
      throw new Error('Cannot load CoreBluetooth Node-API artifact for this ABI')
    }, { virtual: true })

    const createNativeCoreBluetoothBoundary = loadBoundary()

    withDarwinPlatform(() => {
      expect(captureError(() => createNativeCoreBluetoothBoundary())).toMatchObject({
        normalized: {
          code: 'capability.unavailable',
          domain: 'platform',
          operation: 'corebluetooth.native-boundary.load',
          platform: {
            domain: 'corebluetooth',
            code: 'native-artifact-unavailable'
          }
        }
      })
    })
  })

  test('fails closed with a typed diagnostic when the native boundary cannot be constructed', () => {
    jest.doMock(
      nativeAddonPath,
      () => ({
        createContractBoundary: () => {
          throw new Error('CoreBluetooth central manager initialization failed')
        }
      }),
      { virtual: true }
    )

    const createNativeCoreBluetoothBoundary = loadBoundary()

    withDarwinPlatform(() => {
      expect(captureError(() => createNativeCoreBluetoothBoundary())).toMatchObject({
        normalized: {
          code: 'capability.unavailable',
          domain: 'platform',
          operation: 'corebluetooth.native-boundary.create',
          platform: {
            domain: 'corebluetooth',
            code: 'native-boundary-unavailable'
          }
        }
      })
    })
  })

  test('normalizes a forged BackendContractError name without leaking the raw host path', () => {
    const forgedError = new Error('/private/var/db/unified_ble_corebluetooth.node: wrong Node-API ABI')
    forgedError.name = 'BackendContractError'
    jest.doMock(nativeAddonPath, () => {
      throw forgedError
    }, { virtual: true })

    const createNativeCoreBluetoothBoundary = loadBoundary()

    withDarwinPlatform(() => {
      const captured = captureError(() => createNativeCoreBluetoothBoundary())
      expect(captured).not.toBe(forgedError)
      expect(captured).toMatchObject({
        normalized: {
          code: 'capability.unavailable',
          domain: 'platform',
          operation: 'corebluetooth.native-boundary.load',
          platform: {
            domain: 'corebluetooth',
            code: 'native-artifact-unavailable',
            safeMessage: 'The packaged CoreBluetooth native artifact could not be loaded for this Node or Electron runtime'
          }
        }
      })
      expect(captured.message).not.toContain('/private/var/db')
      expect(JSON.stringify(captured.normalized)).not.toContain('/private/var/db')
    })
  })
})
