/**
 * Live CoreBluetooth Polar H10 vertical slice (macOS Electron main / Node).
 * Uses package **central helpers** (waitForState → findDevice → connectAndDiscover
 * → tryRead / firstNotification) — same recipe as docs/HELPERS.md.
 *
 *   pnpm run build:electron:macos
 *   pnpm prepack
 *   node example-electron/live-polar.js
 *
 * Optional env:
 *   POLAR_SCAN_MS=15000   scan / findDevice timeout
 *   POLAR_NAME=Polar      name substring filter (default Polar)
 *   POLAR_DEVICE_ID=…    skip scan, connect this UUID
 *   POLAR_HR_MS=10000    HR stream window after firstNotification
 */

const profiles = require('../example-shared/profiles')
const { createCentralDemo } = require('../example-shared/centralDemo')

let ElectronHost
let helpers
try {
  ElectronHost = require('../lib/commonjs/hosts/electron')
  helpers = require('../lib/commonjs/helpers')
} catch {
  require('@babel/register')({
    extensions: ['.ts', '.js'],
    presets: ['module:@react-native/babel-preset', '@babel/preset-typescript'],
    ignore: [/node_modules/]
  })
  ElectronHost = require('../src/hosts/electron.ts')
  helpers = require('../src/helpers')
}

const { BleManager, createCoreBluetoothBlePort } = ElectronHost
const {
  waitForState,
  findDevice,
  connectAndDiscover,
  tryReadCharacteristicBytes,
  firstNotification,
  safeTeardown
} = helpers

async function main() {
  if (process.platform !== 'darwin') {
    console.error('live-polar.js requires macOS CoreBluetooth')
    process.exit(1)
  }

  console.log('Loading CoreBluetooth BlePort (requireNative)…')
  const port = createCoreBluetoothBlePort({ requireNative: true })
  console.log('port.id', port.id)
  if (typeof port.getAdapterState === 'function') {
    console.log('adapterState', port.getAdapterState())
  }

  const manager = new BleManager({ port, backend: 'corebluetooth' })
  const demo = createCentralDemo(manager, profiles, {
    log: (...a) => console.log('[live]', ...a),
    helpers
  })

  const scanMs = Number(process.env.POLAR_SCAN_MS || 15000)
  const hrMs = Number(process.env.POLAR_HR_MS || 10000)
  const nameFilter = (process.env.POLAR_NAME || 'Polar').toLowerCase()
  let deviceId = process.env.POLAR_DEVICE_ID || null

  console.log('\n== waitForState ==')
  try {
    const st = await waitForState(manager, { timeoutMs: 8000 })
    console.log('  ', st)
  } catch (e) {
    console.warn('  waitForState:', e.message || e, '(continuing)')
  }

  if (!deviceId) {
    console.log(`\n== findDevice name~"${nameFilter}" (timeout ${scanMs}ms; wear Polar, BT on) ==`)
    const serviceUUIDs =
      typeof profiles.resolveHeartRateScanUUIDs === 'function'
        ? profiles.resolveHeartRateScanUUIDs(true)
        : profiles.heartRateScanServiceUUIDs()
    const ad = await findDevice(
      manager,
      d => {
        const n = (d.name || '').toLowerCase()
        return n.includes(nameFilter) || n.includes('h10')
      },
      { timeoutMs: scanMs, serviceUUIDs }
    )
    deviceId = ad.id
    demo.rememberDevice(ad, 'findDevice')
    console.log('Selected', ad.name || deviceId, deviceId)
  } else {
    console.log('Using POLAR_DEVICE_ID', deviceId)
  }

  console.log('\n== connectAndDiscover ==')
  await connectAndDiscover(manager, deviceId, { timeoutMs: 20000 })
  demo.rememberDevice({ id: deviceId, name: null, rssi: null }, 'connected')

  console.log('\n== inspect (demo) + tryRead battery ==')
  const info = await demo.inspectDevice(deviceId)
  console.log(JSON.stringify(info, null, 2))
  if (!info.services.some(s => s.isHeartRate)) {
    console.warn('Warning: Heart Rate Service not listed — still trying monitor')
  }

  const bat = await tryReadCharacteristicBytes(
    manager,
    deviceId,
    '0000180f-0000-1000-8000-00805f9b34fb',
    '00002a19-0000-1000-8000-00805f9b34fb'
  )
  if (bat.ok) {
    console.log('  battery', bat.value[0], '%')
  } else {
    console.log('  battery', bat.skipped ? `skipped: ${bat.reason}` : bat.error?.message)
  }

  console.log('\n== firstNotification (HR) then stream ==')
  try {
    const raw = await firstNotification(
      manager,
      deviceId,
      profiles.HR_SERVICE_UUID,
      profiles.HR_MEASUREMENT_UUID,
      { timeoutMs: Math.min(scanMs, 20000) }
    )
    const first = profiles.parseHeartRateMeasurement(raw)
    console.log('  firstNotification BPM', first.heartRate, 'ibiMs', first.rrIntervalsSec)
  } catch (e) {
    console.warn('  firstNotification:', e.message || e, '— falling back to demo stream only')
  }

  console.log(`\n== HR stream (${hrMs}ms) via demo.startHeartRate ==`)
  const samples = []
  await demo.startHeartRate(deviceId, sample => {
    if (sample.error) {
      console.error('HR error', sample.error.message || sample.error)
      return
    }
    samples.push(sample)
    const ibi = sample.ibiMs?.length ? ` IBI(ms)=${sample.ibiMs.join(',')}` : ''
    const rr = sample.rrIntervalsSec?.length
      ? ` RR(s)=${sample.rrIntervalsSec.map(s => s.toFixed(3)).join(',')}`
      : ''
    console.log('  HR', sample.heartRate, 'bpm' + ibi + rr)
  })

  await new Promise(r => setTimeout(r, hrMs))
  await demo.stopHeartRate()

  await safeTeardown(manager, { deviceIds: [deviceId], stopScan: true, destroy: false })
  if (typeof port.destroy === 'function') port.destroy()

  if (samples.length < 1) {
    throw new Error('No HR notifications received — check strap contact / pairing / permissions')
  }
  console.log('\nLIVE CoreBluetooth Polar vertical slice OK (helpers recipe)')
  console.log('samples', samples.length, 'last', {
    bpm: samples[samples.length - 1].heartRate,
    ibiMs: samples[samples.length - 1].ibiMs
  })
}

main().catch(err => {
  console.error('\nLIVE Polar failed:', err.message || err)
  process.exit(1)
})
