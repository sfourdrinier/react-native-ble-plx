/**
 * Headless Fake multi-device smoke (CI / Linux package job).
 * Exercises package **central helpers** (findDevice / connectAndDiscover / tryRead)
 * via createCentralDemo + direct helper imports.
 *
 * Not a UI — for the Electron window + live Polar use:
 *   pnpm run example:electron
 *   pnpm run example:electron:live
 *
 *   pnpm prepack && node example-electron/smoke.js
 */

const profiles = require('../example-shared/profiles')
const { createCentralDemo, createDemoFakeRadio } = require('../example-shared/centralDemo')

let ElectronHost
let helpers
try {
  ElectronHost = require('../lib/commonjs/hosts/electron')
  helpers = require('../lib/commonjs/helpers')
} catch {
  try {
    require('@babel/register')({
      extensions: ['.ts', '.js'],
      presets: ['module:@react-native/babel-preset', '@babel/preset-typescript'],
      ignore: [/node_modules/]
    })
    ElectronHost = require('../src/hosts/electron.ts')
    helpers = require('../src/helpers')
  } catch (e) {
    console.error('Could not load electron host / helpers. Run `pnpm prepack` first.\n', e.message)
    process.exit(1)
  }
}

const { BleManager, FakeBlePort } = ElectronHost
const {
  waitForState,
  findDevice,
  connectAndDiscover,
  tryReadCharacteristicBytes,
  firstNotification,
  safeTeardown
} = helpers

async function main() {
  const { port, devices: ids } = createDemoFakeRadio(FakeBlePort, profiles)
  const manager = new BleManager({ port, backend: 'mock' })
  // Full inventory: clinical sims (HT/BP) do not advertise HR
  const demo = createCentralDemo(manager, profiles, {
    log: (...a) => console.log('[demo]', ...a),
    heartRateOnly: false,
    helpers
  })

  console.log('hostInfo', manager.getHostInfo())
  console.log('capabilities', demo.capabilities())
  console.log('hasHelpers', demo.hasHelpers())
  if (!demo.hasHelpers()) {
    throw new Error('expected package helpers to load (pnpm prepack)')
  }

  console.log('\n== waitForState (Port → assumed PoweredOn) ==')
  const radio = await waitForState(manager)
  console.log('  ', radio)

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

  console.log('\n== Helpers: findDevice(Polar) + connectAndDiscover ==')
  const found = await findDevice(
    manager,
    d => d.id === ids.polarId || (d.name || '').includes('Polar'),
    { timeoutMs: 3000, serviceUUIDs: null }
  )
  console.log('  found', found.id, found.name)
  if (found.id !== ids.polarId) {
    throw new Error(`findDevice expected ${ids.polarId}, got ${found.id}`)
  }
  await connectAndDiscover(manager, found.id, { timeoutMs: 10000 })
  const batSvc = '0000180f-0000-1000-8000-00805f9b34fb'
  const batLevel = '00002a19-0000-1000-8000-00805f9b34fb'
  const bat = await tryReadCharacteristicBytes(manager, found.id, batSvc, batLevel)
  if (!bat.ok) {
    throw new Error(`tryRead battery failed: ${JSON.stringify(bat)}`)
  }
  const level = bat.value[0]
  console.log('  battery level bytes', level)
  if (level !== 81) {
    throw new Error(`expected battery 81, got ${level}`)
  }

  console.log('\n== Helpers: firstNotification (HR) ==')
  const firstP = firstNotification(
    manager,
    ids.polarId,
    profiles.HR_SERVICE_UUID,
    profiles.HR_MEASUREMENT_UUID,
    { timeoutMs: 3000 }
  )
  await new Promise(r => setTimeout(r, 20))
  await port.emitNotification(
    ids.polarId,
    profiles.HR_SERVICE_UUID,
    profiles.HR_MEASUREMENT_UUID,
    profiles.encodeHeartRateMeasurement(88, { rrIntervalsSec: [60 / 88] })
  )
  const firstRaw = await firstP
  const firstParsed = profiles.parseHeartRateMeasurement(firstRaw)
  console.log('  first HR', firstParsed.heartRate, 'bpm')
  if (firstParsed.heartRate !== 88) {
    throw new Error(`firstNotification expected 88, got ${firstParsed.heartRate}`)
  }
  await manager.cancelDeviceConnection(ids.polarId)

  console.log('\n== Inspect non-HR beacon (demo.connect → helpers.connectAndDiscover) ==')
  await demo.connect(ids.beaconId)
  const beaconInfo = await demo.inspectDevice(ids.beaconId)
  console.log(JSON.stringify(beaconInfo, null, 2))
  if (beaconInfo.serviceCount < 1) throw new Error('beacon should expose Device Information-like service')
  await demo.disconnect(ids.beaconId)

  console.log('\n== Polar H10 connect + inspect + Battery/DIS + HR stream ==')
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

  // R3-F007: Electron host keeps supports('bonding') false — do not pair/list/unpair here.
  if (demo.capabilities().bonding === true) {
    throw new Error('Electron smoke must not advertise bonding:true (manager.supports is fail-closed)')
  }

  console.log('\n== safeTeardown ==')
  const { warnings } = await safeTeardown(manager, { stopScan: true, destroy: false })
  if (warnings.length) console.log('  warnings', warnings)

  console.log('\nexample-electron smoke OK (helpers + Fake multi-device + common SIG profiles)')
  console.log('UI + live Polar: pnpm run example:electron / example:electron:live')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
