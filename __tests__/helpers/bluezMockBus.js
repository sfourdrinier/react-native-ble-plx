/**
 * Shared BlueZ D-Bus mock bus for BluezBlePort + BlePort.contract suites (R2-F078).
 * Includes StartNotify / StopNotify spies so notify arming and cleanup are testable.
 */

/**
 * @param {object} [options]
 * @param {Uint8Array|Buffer|number[]} [options.initialValue]
 * @param {boolean} [options.connectReject]
 * @param {boolean} [options.startNotifyReject]
 * @returns {object} mock bus with spies + lastWritten helper
 */
function makeBluezMockBus(options = {}) {
  const initial = options.initialValue != null ? Buffer.from(options.initialValue) : Buffer.from([0x48, 0x69])
  let lastWritten = Buffer.from(initial)

  const writeValue = jest.fn(async (ay /*, dbusOptions */) => {
    lastWritten = Buffer.from(ay)
  })
  const readValue = jest.fn(async () => Buffer.from(lastWritten))
  const startNotify = jest.fn(async () => {
    if (options.startNotifyReject) {
      throw new Error('org.bluez.Error.Failed: StartNotify failed')
    }
  })
  const stopNotify = jest.fn(async () => undefined)
  const connect = jest.fn(async () => {
    if (options.connectReject) {
      throw new Error('org.bluez.Error.Failed: Connection refused')
    }
  })
  const disconnect = jest.fn(async () => undefined)

  const ifaces = {
    'org.bluez.Adapter1': {
      StartDiscovery: jest.fn(async () => undefined),
      StopDiscovery: jest.fn(async () => undefined)
    },
    'org.bluez.Device1': {
      Connect: connect,
      Disconnect: disconnect
    },
    'org.bluez.GattCharacteristic1': {
      ReadValue: readValue,
      WriteValue: writeValue,
      StartNotify: startNotify,
      StopNotify: stopNotify
    }
  }

  return {
    writeValue,
    readValue,
    startNotify,
    stopNotify,
    connect,
    disconnectDevice: disconnect,
    ifaces,
    getLastWritten: () => lastWritten,
    lastWritten: () => lastWritten,
    getProxyObject: jest.fn(async (_name, _path) => ({
      getInterface: name => ifaces[name] || {}
    })),
    disconnect: jest.fn()
  }
}

/** Alias used by BluezBlePort.test.js historical name. */
function mockBus(options) {
  return makeBluezMockBus(options)
}

module.exports = {
  makeBluezMockBus,
  mockBus
}
