/**
 * 3.9-style Base64 golden call patterns (compat suite skeleton).
 * Drives FakeBlePort + encoding edge the same way apps use Base64 values today.
 */
const { FakeBlePort } = require('../src/port/BlePort')
const { base64ToBytes, bytesToBase64, roundTripBase64 } = require('../src/encoding')

describe('compat Base64 skeleton (3.9 golden patterns)', () => {
  const service = '0000180a-0000-1000-8000-00805f9b34fb'
  const characteristic = '00002a29-0000-1000-8000-00805f9b34fb'
  const deviceId = 'AA:BB:CC:DD:EE:FF'

  test('manufacturer-style payload survives Base64 edge round-trip', () => {
    // Simulate a small GATT payload apps often treat as Base64 on the wire
    const raw = new Uint8Array([0x00, 0xff, 0x10, 0x20, 0x7f])
    const asBase64 = bytesToBase64(raw)
    expect(roundTripBase64(asBase64)).toBe(asBase64)
    expect(Array.from(base64ToBytes(asBase64))).toEqual(Array.from(raw))
  })

  test('connect → writeCharacteristic(Base64) → readCharacteristic(Base64)', async () => {
    const port = new FakeBlePort({
      characteristics: {
        [deviceId]: {
          [service]: {
            [characteristic]: bytesToBase64(new Uint8Array([0x48, 0x69])) // "Hi"
          }
        }
      }
    })

    await port.connect(deviceId)
    expect(port.getConnectionState(deviceId)).toBe('connected')

    const before = await port.readCharacteristicBase64(deviceId, service, characteristic)
    expect(Array.from(base64ToBytes(before))).toEqual([0x48, 0x69])

    const payload = bytesToBase64(new Uint8Array([0x4f, 0x4b])) // "OK"
    await port.writeCharacteristicBase64(deviceId, service, characteristic, payload)

    const after = await port.readCharacteristicBase64(deviceId, service, characteristic)
    expect(after).toBe(payload)
    expect(Array.from(base64ToBytes(after))).toEqual([0x4f, 0x4b])
  })
})
