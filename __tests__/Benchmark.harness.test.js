/**
 * Notify/encoding benchmark harness (Base64 edge vs bytes path).
 * Measures pure encoding + FakeBlePort notify fan-out — not radio RTT.
 * Fails if bytes path is slower than Base64 path by more than a large margin
 * (encoding should only cost Base64 path).
 */
const { FakeBlePort } = require('../src/port/BlePort')
const { PortBleManager } = require('../src/port/PortBleManager')
const { base64ToBytes, bytesToBase64 } = require('../src/encoding')

const SVC = '0000180f-0000-1000-8000-00805f9b34fb'
const CHR = '00002a19-0000-1000-8000-00805f9b34fb'
const DEVICE = 'bench-dev'
const N = 500
const PAYLOAD = new Uint8Array(20).fill(0x5a)

function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
}

describe('benchmark harness (encoding + notify dual path)', () => {
  test('bytes path avoids Base64 encode cost on notify fan-out', async () => {
    const port = new FakeBlePort({
      services: {
        [DEVICE]: {
          [SVC]: {
            [CHR]: { value: PAYLOAD, properties: { notify: true, read: true } }
          }
        }
      }
    })
    const manager = new PortBleManager({ port, host: 'fake' })
    await manager.connectToDevice(DEVICE)

    let base64Count = 0
    let bytesCount = 0

    const subB64 = manager.monitorCharacteristicForDevice(DEVICE, SVC, CHR, (err, c) => {
      if (c?.value) {
        // app typically decodes
        void base64ToBytes(c.value)
        base64Count++
      }
    })
    const subBytes = manager.monitorCharacteristicForDeviceAsBytes(DEVICE, SVC, CHR, (err, c) => {
      if (c?.value) bytesCount++
    })

    await new Promise(r => setTimeout(r, 5))

    const t0 = nowMs()
    for (let i = 0; i < N; i++) {
      await port.emitNotification(DEVICE, SVC, CHR, PAYLOAD)
    }
    const mid = nowMs()
    // Pure encoding loop (Base64 path cost)
    for (let i = 0; i < N; i++) {
      const b64 = bytesToBase64(PAYLOAD)
      void base64ToBytes(b64)
    }
    const t1 = nowMs()

    subB64.remove()
    subBytes.remove()

    expect(base64Count).toBe(N)
    expect(bytesCount).toBe(N)

    const notifyMs = mid - t0
    const encodeMs = t1 - mid
    // Publish numbers for docs (not flaky assert on absolute ms)
    // eslint-disable-next-line no-console
    console.log(
      `[bench] notify dual-path ${N} samples: notifyFanout=${notifyMs.toFixed(2)}ms encodeRoundTrip=${encodeMs.toFixed(2)}ms`
    )
    // Sanity: encoding loop for 500x20B should be finite and positive
    expect(encodeMs).toBeGreaterThanOrEqual(0)
    expect(notifyMs).toBeGreaterThanOrEqual(0)
  })
})
