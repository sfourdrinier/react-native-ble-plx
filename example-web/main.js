/**
 * Web Bluetooth demo: Polar H10 (or any Heart Rate Service broadcaster).
 *
 * Flow: user gesture → requestDevice (HR filters) → connect → discover →
 * monitor Heart Rate Measurement (0x2A37) → parse BPM.
 *
 * Serve from a secure context (localhost/https), Chromium, BLE adapter on.
 * Prefer loading the built package; falls back to source for dev:
 *
 *   pnpm prepack
 *   npx --yes serve .   # from repo root with import map, or use Vite — see README
 */

import {
  HR_SERVICE_UUID,
  HR_MEASUREMENT_UUID,
  heartRateRequestFilters,
  heartRateOptionalServices,
  parseHeartRateMeasurement,
  isHeartRateService,
  isHeartRateMeasurement
} from './heartRate.mjs'

async function loadWebBleManager() {
  // Prefer published-style entry (works when app is bundled / package linked).
  try {
    return await import('unified-ble-manager/web')
  } catch {
    // Dev: direct host module (bundler or TS-capable server required).
    return await import('../src/hosts/web.ts')
  }
}

const { BleManager } = await loadWebBleManager()

const logEl = document.getElementById('log')
const bpmEl = document.getElementById('bpm')
const statusEl = document.getElementById('status')

const log = (...args) => {
  const line = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
  logEl.textContent += line + '\n'
  logEl.scrollTop = logEl.scrollHeight
  console.log(...args)
}

const setStatus = text => {
  statusEl.textContent = text
}

const manager = new BleManager({
  optionalServices: heartRateOptionalServices()
})

log('Target: Heart Rate Service (Polar H10 compatible)')
log('  service', HR_SERVICE_UUID, '/ heart_rate')
log('  measurement', HR_MEASUREMENT_UUID)
log('supports(requestDevice)=', manager.supports('requestDevice'))
log('supports(continuousScan)=', manager.supports('continuousScan'))

let deviceId = null
let hrSub = null

function setButtons({ request, connect, monitor, stop }) {
  document.getElementById('btn-request').disabled = !request
  document.getElementById('btn-connect').disabled = !connect
  document.getElementById('btn-monitor').disabled = !monitor
  document.getElementById('btn-stop').disabled = !stop
}

setButtons({ request: true, connect: false, monitor: false, stop: false })

document.getElementById('btn-request').onclick = async () => {
  setStatus('Chooser open — pick your Polar H10 / HR band…')
  try {
    const ad = await manager.requestDevice(heartRateRequestFilters())
    deviceId = ad.id
    log('selected', ad)
    setStatus(`Selected: ${ad.name || ad.id}`)
    setButtons({ request: true, connect: true, monitor: false, stop: false })
  } catch (e) {
    log('requestDevice error', String(e))
    setStatus('Chooser cancelled or Web Bluetooth unavailable')
  }
}

document.getElementById('btn-connect').onclick = async () => {
  if (!deviceId) return
  setStatus('Connecting…')
  try {
    await manager.connectToDevice(deviceId)
    await manager.discoverAllServicesAndCharacteristicsForDevice(deviceId)
    const services = await manager.servicesForDevice(deviceId)
    log(
      'services',
      services.map(s => s.uuid)
    )
    const hrSvc = services.find(s => isHeartRateService(s.uuid))
    if (!hrSvc) {
      log('warning: Heart Rate Service not found after discover — strap may need pairing or different filter')
    } else {
      log('Heart Rate Service OK', hrSvc.uuid)
    }
    setStatus('Connected — start HR monitor')
    setButtons({ request: true, connect: false, monitor: true, stop: false })
  } catch (e) {
    log('connect error', String(e))
    setStatus('Connect failed')
  }
}

document.getElementById('btn-monitor').onclick = async () => {
  if (!deviceId) return
  if (hrSub) {
    hrSub.remove()
    hrSub = null
  }

  // Prefer known UUIDs; fall back to discover matching measurement char.
  let serviceUUID = HR_SERVICE_UUID
  let charUUID = HR_MEASUREMENT_UUID
  try {
    const services = await manager.servicesForDevice(deviceId)
    const hrSvc = services.find(s => isHeartRateService(s.uuid))
    if (hrSvc) {
      serviceUUID = hrSvc.uuid
      const chars = await manager.characteristicsForDevice(deviceId, serviceUUID)
      const meas = chars.find(c => isHeartRateMeasurement(c.uuid))
      if (meas) charUUID = meas.uuid
      log(
        'characteristics',
        chars.map(c => c.uuid)
      )
    }
  } catch (e) {
    log('discover chars note', String(e))
  }

  setStatus('Monitoring Heart Rate Measurement…')
  log('monitor', serviceUUID, charUUID)

  hrSub = manager.monitorCharacteristicForDeviceAsBytes(deviceId, serviceUUID, charUUID, (err, snap) => {
    if (err) {
      log('notify error', String(err))
      return
    }
    if (!snap?.value) return
    try {
      const parsed = parseHeartRateMeasurement(snap.value)
      bpmEl.textContent = String(parsed.heartRate)
      const contact =
        parsed.sensorContactSupported && !parsed.sensorContactDetected ? ' (no contact?)' : ''
      log(`HR ${parsed.heartRate} bpm${contact}`, 'raw', Array.from(snap.value))
      setStatus(`Streaming ${parsed.heartRate} bpm`)
    } catch (parseErr) {
      log('parse error', String(parseErr), Array.from(snap.value))
    }
  })

  setButtons({ request: true, connect: false, monitor: false, stop: true })
}

document.getElementById('btn-stop').onclick = async () => {
  if (hrSub) {
    hrSub.remove()
    hrSub = null
  }
  bpmEl.textContent = '—'
  setStatus('Monitor stopped')
  setButtons({ request: true, connect: true, monitor: true, stop: false })
  log('monitor stopped')
}
