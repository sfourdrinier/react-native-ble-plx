/**
 * Electron / Node main-process demo — same CentralDemo as web.
 *
 * Fake multi-device radio by default (Polar H10 + generic HR + beacon) so
 * scan → list → inspect → HR works on Linux/CI without BlueZ.
 *
 *   pnpm prepack && node example-electron/main.js
 */

const hr = require('../example-shared/heartRate')
const { createCentralDemo, createDemoFakeRadio } = require('../example-shared/centralDemo')

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
    console.error('Could not load electron host. Run `pnpm prepack` first.\n', e.message)
    process.exit(1)
  }
}

const { BleManager, FakeBlePort } = ElectronHost

async function main() {
  const { port, devices: ids } = createDemoFakeRadio(FakeBlePort, hr)
  const manager = new BleManager({ port, backend: 'mock' })
  const demo = createCentralDemo(manager, hr, {
    log: (...a) => console.log('[demo]', ...a)
  })

  console.log('hostInfo', manager.getHostInfo())
  console.log('capabilities', demo.capabilities())

  // --- Scan & list (same CentralDemo API as web) ---
  console.log('\n== Scan for devices ==')
  await demo.discover(d => {
    console.log('  +', demo.formatDeviceLine(d))
  })
  await new Promise(r => setTimeout(r, 30))
  await demo.stopScan()

  const listed = demo.listDevices()
  console.log('\n== Device list ==')
  for (const d of listed) {
    console.log(' ', demo.formatDeviceLine(d))
  }
  if (listed.length < 3) {
    throw new Error(`expected ≥3 simulated devices, got ${listed.length}`)
  }
  if (!listed.some(d => d.id === ids.polarId)) {
    throw new Error('Polar H10 sim missing from scan results')
  }

  // --- Inspect beacon without HR ---
  console.log('\n== Inspect non-HR beacon ==')
  await demo.connect(ids.beaconId)
  const beaconInfo = await demo.inspectDevice(ids.beaconId)
  console.log(JSON.stringify(beaconInfo, null, 2))
  if (beaconInfo.serviceCount < 1) throw new Error('beacon should expose Device Information-like service')
  await demo.disconnect(ids.beaconId)

  // --- Polar H10: connect, inspect, HR stream ---
  console.log('\n== Polar H10 connect + inspect + HR ==')
  await demo.connect(ids.polarId)
  const polarInfo = await demo.inspectDevice(ids.polarId)
  console.log(JSON.stringify(polarInfo, null, 2))
  if (!polarInfo.services.some(s => s.isHeartRate)) {
    throw new Error('Polar sim missing Heart Rate Service in inspect')
  }

  const samples = []
  await demo.startHeartRate(ids.polarId, sample => {
    if (sample.error) {
      console.error('HR error', sample.error)
      return
    }
    samples.push(sample.heartRate)
    console.log('  HR', sample.heartRate, 'bpm', sample.raw)
  })

  const sequence = [72, 75, 78, 80]
  for (const bpm of sequence) {
    await port.emitNotification(
      ids.polarId,
      hr.HR_SERVICE_UUID,
      hr.HR_MEASUREMENT_UUID,
      hr.encodeHeartRateMeasurement(bpm)
    )
    await new Promise(r => setTimeout(r, 5))
  }

  await demo.stopHeartRate()
  await demo.disconnect(ids.polarId)

  if (samples.length < sequence.length) {
    throw new Error(`expected ${sequence.length} HR samples, got ${samples.length}`)
  }

  // --- Second HR band briefly ---
  console.log('\n== Second HR band inspect ==')
  await demo.connect(ids.otherHrId)
  const other = await demo.inspectDevice(ids.otherHrId)
  console.log(
    other.name,
    'services',
    other.services.map(s => s.uuid)
  )
  await demo.disconnect(ids.otherHrId)

  console.log('\nexample-electron shared CentralDemo smoke OK')
  console.log('(Web uses the same createCentralDemo; discovery mode = chooser there.)')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
