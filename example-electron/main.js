/**
 * Electron / Node main-process demo: Heart Rate Service (Polar H10 shape).
 *
 * Without a BlueZ port this runs a FakeBlePort that simulates a Polar H10
 * advertising Heart Rate Service and streaming BPM notifications — so CI/Linux
 * still validates the vertical slice. Plug a real BlePort for live straps.
 *
 *   pnpm prepack && node example-electron/main.js
 */

const path = require('path')
const {
  HR_SERVICE_UUID,
  HR_MEASUREMENT_UUID,
  encodeHeartRateMeasurement,
  parseHeartRateMeasurement,
  isHeartRateService,
  isHeartRateMeasurement
} = require('../example-shared/heartRate')

let ElectronHost
try {
  ElectronHost = require('../lib/commonjs/hosts/electron')
} catch {
  try {
    require('@babel/register')({
      extensions: ['.ts', '.js'],
      presets: ['module:@react-native/babel-preset', '@babel/preset-typescript'],
      ignore: [/node_modules/]
    })
    ElectronHost = require('../src/hosts/electron.ts')
  } catch (e) {
    console.error(
      'Could not load electron host. Run `pnpm prepack` from the repo root first.\n',
      e.message
    )
    process.exit(1)
  }
}

const { BleManager, FakeBlePort } = ElectronHost

/** Simulated Polar H10 device id */
const DEVICE_ID = 'polar-h10-sim'
const DEVICE_NAME = 'Polar H10 12345678'

function createPolarH10FakePort() {
  const initialBpm = 72
  return new FakeBlePort({
    id: 'example-electron-polar-h10',
    advertisements: [{ id: DEVICE_ID, name: DEVICE_NAME, rssi: -52 }],
    services: {
      [DEVICE_ID]: {
        [HR_SERVICE_UUID]: {
          [HR_MEASUREMENT_UUID]: {
            value: encodeHeartRateMeasurement(initialBpm),
            properties: { read: true, write: false, notify: true }
          }
        }
      }
    }
  })
}

async function main() {
  const port = createPolarH10FakePort()
  const manager = new BleManager({ port, backend: 'mock' })
  const info = manager.getHostInfo()
  console.log('hostInfo', info)
  if (!info.isMainProcessOriented) {
    throw new Error('expected main-process-oriented host')
  }

  console.log('Scanning for Heart Rate bands (simulated Polar H10)…')
  const seen = []
  await manager.startDeviceScan(null, null, (err, device) => {
    if (err) {
      console.error('scan error', err)
      return
    }
    if (device) seen.push(device)
  })
  await new Promise(r => setTimeout(r, 20))
  await manager.stopDeviceScan()
  console.log(
    'scan results',
    seen.map(d => ({ id: d.id, name: d.name }))
  )
  if (!seen.some(d => d.id === DEVICE_ID)) {
    throw new Error('expected simulated Polar H10 advertisement')
  }

  console.log('Connecting to', DEVICE_NAME)
  await manager.connectToDevice(DEVICE_ID)
  await manager.discoverAllServicesAndCharacteristicsForDevice(DEVICE_ID)

  const services = await manager.servicesForDevice(DEVICE_ID)
  const hrSvc = services.find(s => isHeartRateService(s.uuid))
  if (!hrSvc) throw new Error('Heart Rate Service missing on simulated device')
  console.log('HR service', hrSvc.uuid)

  const chars = await manager.characteristicsForDevice(DEVICE_ID, HR_SERVICE_UUID)
  const meas = chars.find(c => isHeartRateMeasurement(c.uuid))
  if (!meas) throw new Error('Heart Rate Measurement characteristic missing')
  console.log('HR measurement', meas.uuid)

  // One-shot read (many straps only notify; FakeBlePort supports both)
  const initial = await manager.readCharacteristicForDeviceAsBytes(
    DEVICE_ID,
    HR_SERVICE_UUID,
    HR_MEASUREMENT_UUID
  )
  const initialParsed = parseHeartRateMeasurement(initial.value)
  console.log('initial HR', initialParsed.heartRate, 'bpm')

  const samples = []
  const sub = manager.monitorCharacteristicForDeviceAsBytes(
    DEVICE_ID,
    HR_SERVICE_UUID,
    HR_MEASUREMENT_UUID,
    (err, snap) => {
      if (err) {
        console.error('notify error', err)
        return
      }
      if (!snap?.value) return
      const parsed = parseHeartRateMeasurement(snap.value)
      samples.push(parsed.heartRate)
      console.log('HR notify', parsed.heartRate, 'bpm', 'raw', Array.from(snap.value))
    }
  )

  // Stream a few Polar-like samples through the fake radio
  const sequence = [72, 75, 78, 80]
  for (const bpm of sequence) {
    await port.emitNotification(
      DEVICE_ID,
      HR_SERVICE_UUID,
      HR_MEASUREMENT_UUID,
      encodeHeartRateMeasurement(bpm)
    )
    await new Promise(r => setTimeout(r, 5))
  }

  sub.remove()
  await manager.cancelDeviceConnection(DEVICE_ID)

  if (samples.length < sequence.length) {
    throw new Error(`expected ${sequence.length} HR samples, got ${samples.length}`)
  }
  if (samples[samples.length - 1] !== 80) {
    throw new Error(`last BPM should be 80, got ${samples[samples.length - 1]}`)
  }

  console.log('supports(central)', manager.supports('central'))
  console.log('supports(androidForegroundService)', manager.supports('androidForegroundService'))
  console.log('example-electron Polar H10 HR smoke OK')
  console.log(
    '(Live straps: inject a BlueZ BlePort and filter advertisements for',
    HR_SERVICE_UUID,
    '— see docs/ELECTRON.md)'
  )
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
