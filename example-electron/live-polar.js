/**
 * Live CoreBluetooth Polar H10 vertical slice (macOS Electron main / Node).
 *
 *   pnpm run build:electron:macos
 *   pnpm prepack
 *   node example-electron/live-polar.js
 *
 * Optional env:
 *   POLAR_SCAN_MS=15000   scan duration
 *   POLAR_NAME=Polar      name substring filter (default Polar)
 *   POLAR_DEVICE_ID=…    skip scan, connect this UUID
 */

const profiles = require('../example-shared/profiles')
const { createCentralDemo } = require('../example-shared/centralDemo')

let ElectronHost
try {
  ElectronHost = require('../lib/commonjs/hosts/electron')
} catch {
  require('@babel/register')({
    extensions: ['.ts', '.js'],
    presets: ['module:@react-native/babel-preset', '@babel/preset-typescript'],
    ignore: [/node_modules/]
  })
  ElectronHost = require('../src/hosts/electron.ts')
}

const { BleManager, createCoreBluetoothBlePort } = ElectronHost

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
    log: (...a) => console.log('[live]', ...a)
  })

  const scanMs = Number(process.env.POLAR_SCAN_MS || 15000)
  const nameFilter = (process.env.POLAR_NAME || 'Polar').toLowerCase()
  let deviceId = process.env.POLAR_DEVICE_ID || null

  if (!deviceId) {
    console.log(`\n== Scan ${scanMs}ms for "${nameFilter}" (wear Polar, Bluetooth on) ==`)
    await demo.startScan(d => {
      console.log('  +', demo.formatDeviceLine(d))
    })
    await new Promise(r => setTimeout(r, scanMs))
    await demo.stopScan()

    const listed = demo.listDevices()
    console.log('\n== Devices seen ==')
    for (const d of listed) console.log(' ', demo.formatDeviceLine(d))

    const polar =
      listed.find(d => (d.name || '').toLowerCase().includes(nameFilter)) ||
      listed.find(d => (d.name || '').toLowerCase().includes('h10'))
    if (!polar) {
      throw new Error(
        `No device matching name "${nameFilter}" — saw ${listed.length} device(s). ` +
          'Strap advertising? macOS Bluetooth permission granted for Terminal/Node?'
      )
    }
    deviceId = polar.id
    console.log('\nSelected', polar.name || deviceId, deviceId)
  } else {
    console.log('Using POLAR_DEVICE_ID', deviceId)
  }

  console.log('\n== Connect + inspect ==')
  await demo.connect(deviceId)
  const info = await demo.inspectDevice(deviceId)
  console.log(JSON.stringify(info, null, 2))
  if (!info.services.some(s => s.isHeartRate)) {
    console.warn('Warning: Heart Rate Service not listed — still trying monitor')
  }

  console.log('\n== HR stream (10s) — expect BPM + IBI ==')
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

  await new Promise(r => setTimeout(r, 10000))
  await demo.stopHeartRate()
  await demo.disconnect(deviceId)

  if (typeof port.destroy === 'function') port.destroy()

  if (samples.length < 1) {
    throw new Error('No HR notifications received in 10s — check strap contact / pairing')
  }
  console.log('\nLIVE CoreBluetooth Polar vertical slice OK')
  console.log('samples', samples.length, 'last', {
    bpm: samples[samples.length - 1].heartRate,
    ibiMs: samples[samples.length - 1].ibiMs
  })
}

main().catch(err => {
  console.error('\nLIVE Polar failed:', err.message || err)
  process.exit(1)
})
