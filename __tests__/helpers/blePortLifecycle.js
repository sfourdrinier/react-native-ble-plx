/**
 * Shared BlePort full-central lifecycle driver for Fake / BlueZ / Web mocks.
 */
const { base64ToBytes, bytesToBase64 } = require('../../src/encoding')

/**
 * @typedef {object} BlePortLifecycleContext
 * @property {string} deviceId
 * @property {string} serviceUUID
 * @property {string} characteristicUUID
 * @property {Uint8Array} [initialBytes]
 * @property {(port: import('../../src/port/BlePort').BlePort, context: BlePortLifecycleContext) => Promise<void>|void} [prepare]
 * @property {(port: import('../../src/port/BlePort').BlePort, context: BlePortLifecycleContext, bytes: Uint8Array) => Promise<void>|void} [emitNotification]
 * @property {(port: import('../../src/port/BlePort').BlePort, onDevice: (advertisement: import('../../src/port/BlePort').PortAdvertisement) => void) => Promise<void>} [startScan]
 * @property {() => Promise<void>} [flush]
 */

/**
 * Run scan → connect → discover → read/write Base64 + bytes → notify → disconnect.
 *
 * @param {import('../../src/port/BlePort').BlePort} port
 * @param {BlePortLifecycleContext} ctx
 */
async function runBlePortLifecycle(port, ctx) {
  const {
    deviceId,
    serviceUUID,
    characteristicUUID,
    initialBytes = new Uint8Array([0x64]),
    prepare,
    emitNotification,
    startScan,
    flush = async () => undefined
  } = ctx

  if (prepare) {
    await prepare(port, ctx)
  }

  const seen = []
  if (startScan) {
    await startScan(port, ad => seen.push(ad))
  } else {
    await port.startScan(ad => seen.push(ad))
  }
  await flush()
  expect(seen.map(a => a.id)).toContain(deviceId)
  if (typeof port.stopScan === 'function') {
    await port.stopScan()
  }

  await port.connect(deviceId)
  expect(port.getConnectionState(deviceId)).toBe('connected')

  const services = await port.discoverServices(deviceId)
  expect(services.map(s => String(s).toLowerCase())).toEqual(
    expect.arrayContaining([serviceUUID.toLowerCase()])
  )
  const chars = await port.discoverCharacteristics(deviceId, serviceUUID)
  expect(chars.map(c => String(c.uuid).toLowerCase())).toEqual(
    expect.arrayContaining([characteristicUUID.toLowerCase()])
  )

  const b64 = await port.readCharacteristicBase64(deviceId, serviceUUID, characteristicUUID)
  expect(Array.from(base64ToBytes(b64))).toEqual(Array.from(initialBytes))

  const bytes = await port.readCharacteristicBytes(deviceId, serviceUUID, characteristicUUID)
  expect(bytes).toBeInstanceOf(Uint8Array)
  expect(Array.from(bytes)).toEqual(Array.from(initialBytes))

  await port.writeCharacteristicBytes(deviceId, serviceUUID, characteristicUUID, new Uint8Array([0x2a]))
  expect(
    Array.from(await port.readCharacteristicBytes(deviceId, serviceUUID, characteristicUUID))
  ).toEqual([0x2a])

  await port.writeCharacteristicBase64(
    deviceId,
    serviceUUID,
    characteristicUUID,
    bytesToBase64(new Uint8Array([0x01, 0x02]))
  )
  expect(
    Array.from(await port.readCharacteristicBytes(deviceId, serviceUUID, characteristicUUID))
  ).toEqual([0x01, 0x02])

  const notifications = []
  const unsub = await port.monitorCharacteristic(
    deviceId,
    serviceUUID,
    characteristicUUID,
    value => {
      notifications.push(Array.from(value))
    }
  )
  const notifyPayload = new Uint8Array([0xee])
  if (emitNotification) {
    await emitNotification(port, ctx, notifyPayload)
  } else if (typeof port.emitNotification === 'function') {
    await port.emitNotification(deviceId, serviceUUID, characteristicUUID, notifyPayload)
  } else {
    throw new Error('runBlePortLifecycle requires emitNotification for this port')
  }
  await flush()
  expect(notifications).toEqual([[0xee]])
  await unsub()

  await port.disconnect(deviceId)
  expect(port.getConnectionState(deviceId)).toBe('disconnected')
  await expect(
    port.readCharacteristicBytes(deviceId, serviceUUID, characteristicUUID)
  ).rejects.toThrow(/not connected|Not connected|Unknown|DeviceNotConnected/i)
}

module.exports = { runBlePortLifecycle }
