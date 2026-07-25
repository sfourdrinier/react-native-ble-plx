/**
 * Headless Fake multi-device smoke (CI / Linux package job).
 * Not a UI — for the Electron window + live Polar use:
 *   pnpm run example:electron
 *
 *   pnpm prepack && node example-electron/smoke.js
 */

const profiles = require('../example-shared/profiles')
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
  const { port, devices: ids } = createDemoFakeRadio(FakeBlePort, profiles)
  const manager = new BleManager({ port, backend: 'mock' })
  // Full inventory: clinical sims (HT/BP) do not advertise HR
  const demo = createCentralDemo(manager, profiles, {
    log: (...a) => console.log('[demo]', ...a),
    heartRateOnly: false
  })

  console.log('hostInfo', manager.getHostInfo())
  console.log('capabilities', demo.capabilities())

  console.log('\n== Scan for devices (all profiles) ==')
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
  if (listed.length < 5) {
    throw new Error(`expected ≥5 simulated devices, got ${listed.length}`)
  }
  if (!listed.some(d => d.id === ids.polarId)) {
    throw new Error('Polar H10 sim missing from scan results')
  }

  console.log('\n== Inspect non-HR beacon ==')
  await demo.connect(ids.beaconId)
  const beaconInfo = await demo.inspectDevice(ids.beaconId)
  console.log(JSON.stringify(beaconInfo, null, 2))
  if (beaconInfo.serviceCount < 1) throw new Error('beacon should expose Device Information-like service')
  await demo.disconnect(ids.beaconId)

  console.log('\n== Polar H10 connect + inspect + Battery/DIS + HR ==')
  await demo.connect(ids.polarId)
  const polarInfo = await demo.inspectDevice(ids.polarId)
  console.log(JSON.stringify(polarInfo, null, 2))
  if (!polarInfo.services.some(s => s.isHeartRate)) {
    throw new Error('Polar sim missing Heart Rate Service in inspect')
  }
  if (!polarInfo.services.some(s => s.isBattery)) {
    throw new Error('Polar sim missing Battery Service')
  }
  if (polarInfo.common?.battery?.level !== 81) {
    throw new Error(`expected battery 81, got ${JSON.stringify(polarInfo.common?.battery)}`)
  }
  if (!polarInfo.common?.deviceInformation?.manufacturerName?.includes('Polar')) {
    throw new Error('expected Polar manufacturer in DIS')
  }

  const samples = []
  await demo.startHeartRate(ids.polarId, sample => {
    if (sample.error) {
      console.error('HR error', sample.error)
      return
    }
    samples.push(sample)
    const ibi =
      sample.ibiMs && sample.ibiMs.length ? ` IBI(ms)=${sample.ibiMs.join(',')}` : ''
    const rr =
      sample.rrIntervalsSec && sample.rrIntervalsSec.length
        ? ` RR(s)=${sample.rrIntervalsSec.map(s => s.toFixed(3)).join(',')}`
        : ''
    console.log('  HR', sample.heartRate, 'bpm' + ibi + rr, sample.raw)
  })

  const sequence = [
    { bpm: 72, rrIntervalsSec: [60 / 72] },
    { bpm: 75, rrIntervalsSec: [60 / 75, 60 / 76] },
    { bpm: 78, rrIntervalsSec: [60 / 78] },
    { bpm: 80, rrIntervalsSec: [60 / 80] }
  ]
  for (const step of sequence) {
    await port.emitNotification(
      ids.polarId,
      profiles.HR_SERVICE_UUID,
      profiles.HR_MEASUREMENT_UUID,
      profiles.encodeHeartRateMeasurement(step.bpm, { rrIntervalsSec: step.rrIntervalsSec })
    )
    await new Promise(r => setTimeout(r, 5))
  }

  await demo.stopHeartRate()
  await demo.disconnect(ids.polarId)

  if (samples.length < sequence.length) {
    throw new Error(`expected ${sequence.length} HR samples, got ${samples.length}`)
  }
  const withIbi = samples.filter(s => s.ibiMs && s.ibiMs.length > 0)
  if (withIbi.length < sequence.length) {
    throw new Error(`expected RR/IBI on all samples, got ${withIbi.length}/${samples.length}`)
  }
  console.log('  HR+IBI samples OK', withIbi.map(s => ({ bpm: s.heartRate, ibiMs: s.ibiMs })))

  console.log('\n== Health Thermometer + Blood Pressure sims (indicate-only; reads skipped) ==')
  await demo.connect(ids.thermoId)
  const thermo = await demo.inspectDevice(ids.thermoId)
  if (!thermo.services.some(s => s.isHealthThermometer)) {
    throw new Error('thermo sim missing Health Thermometer service')
  }
  if (!thermo.common?.temperature?.skipped) {
    throw new Error(
      `thermo should skip indicate-only read, got: ${JSON.stringify(thermo.common?.temperature)}`
    )
  }
  console.log('  thermo skipped (indicate-only)', thermo.common.temperature.reason)
  // Inventory is metadata-only — no pre-read valueBase64
  const thermoMeas = thermo.services
    .flatMap(s => s.characteristics || [])
    .find(c => c.isTemperatureMeasurement)
  if (thermoMeas && thermoMeas.valueBase64 != null) {
    throw new Error('inspect inventory must not auto-read characteristic values')
  }
  await demo.disconnect(ids.thermoId)

  await demo.connect(ids.bpId)
  const bp = await demo.inspectDevice(ids.bpId)
  if (!bp.services.some(s => s.isBloodPressure)) {
    throw new Error('bp sim missing Blood Pressure service')
  }
  if (!bp.common?.bloodPressure?.skipped) {
    throw new Error(
      `bp should skip indicate-only read, got: ${JSON.stringify(bp.common?.bloodPressure)}`
    )
  }
  console.log('  BP skipped (indicate-only)', bp.common.bloodPressure.reason)
  await demo.disconnect(ids.bpId)

  console.log('\n== Second HR band inspect ==')
  await demo.connect(ids.otherHrId)
  const other = await demo.inspectDevice(ids.otherHrId)
  console.log(other.name, 'services', other.services.map(s => s.uuid))
  await demo.disconnect(ids.otherHrId)

  // R2-F061: pair / list / unpair round-trip against FakeBlePort bonding helpers
  console.log('\n== Pair / unpair (Fake bonding) ==')
  await demo.pairDevice(ids.polarId)
  const paired = await demo.listPairedDevices()
  if (!paired.some(d => d.id === ids.polarId)) {
    throw new Error(`expected polar in paired list, got ${JSON.stringify(paired)}`)
  }
  console.log('  paired', paired.map(d => d.id).join(', '))
  await demo.unpairDevice(ids.polarId)
  const after = await demo.listPairedDevices()
  if (after.some(d => d.id === ids.polarId)) {
    throw new Error('polar still paired after unpair')
  }
  console.log('  unpaired OK')

  console.log('\nexample-electron smoke OK (Fake multi-device + common SIG profiles + bonding)')
  console.log('UI + live Polar: pnpm run example:electron')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
