/**
 * Web demo UI — same CentralDemo as Electron.
 * Discovery: requestDevice chooser (Web has no continuous scan).
 * Then list / inspect / HR stream for Polar H10 and other HR bands.
 */

import * as hr from './heartRate.mjs'
import { createCentralDemo } from './centralDemo.mjs'

async function loadWebBleManager() {
  try {
    return await import('unified-ble-manager/web')
  } catch {
    return await import('../src/hosts/web.ts')
  }
}

const { BleManager } = await loadWebBleManager()

const logEl = document.getElementById('log')
const bpmEl = document.getElementById('bpm')
const statusEl = document.getElementById('status')
const deviceListEl = document.getElementById('device-list')
const inspectEl = document.getElementById('inspect')
const capsEl = document.getElementById('caps')

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
  optionalServices: hr.heartRateOptionalServices()
})

const demo = createCentralDemo(manager, hr, { log })
const caps = demo.capabilities()
capsEl.textContent = `Discovery: ${
  caps.continuousScan ? 'continuous scan' : caps.requestDevice ? 'chooser (requestDevice)' : 'none'
} · notify=${caps.notify} · bytes=${caps.bytesPath}`

let selectedId = null

function renderDeviceList() {
  const list = demo.listDevices()
  deviceListEl.innerHTML = ''
  if (list.length === 0) {
    deviceListEl.innerHTML = '<li class="empty">No devices yet — use Discover</li>'
    return
  }
  for (const d of list) {
    const li = document.createElement('li')
    li.className = d.id === selectedId ? 'selected' : ''
    li.tabIndex = 0
    li.innerHTML = `<strong>${escapeHtml(d.name || '(no name)')}</strong>
      <span class="meta">${escapeHtml(d.id)}</span>
      <span class="meta">${d.rssi != null ? d.rssi + ' dBm' : 'rssi n/a'} · ${escapeHtml(d.source || '')}</span>`
    li.onclick = () => {
      selectedId = d.id
      renderDeviceList()
      setStatus(`Selected ${d.name || d.id}`)
      document.getElementById('btn-connect').disabled = false
      document.getElementById('btn-inspect').disabled = false
    }
    deviceListEl.appendChild(li)
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function setButtons(state) {
  for (const [id, enabled] of Object.entries(state)) {
    const el = document.getElementById(id)
    if (el) el.disabled = !enabled
  }
}

log('Shared CentralDemo on Web Bluetooth')
log('Target: Heart Rate Service / Polar H10 (and any HR broadcaster)')
renderDeviceList()
setButtons({
  'btn-discover': true,
  'btn-stop-scan': false,
  'btn-connect': false,
  'btn-inspect': false,
  'btn-monitor': false,
  'btn-stop-hr': false,
  'btn-disconnect': false
})

document.getElementById('btn-discover').onclick = async () => {
  setStatus('Discovering…')
  try {
    // Web path: discover() → pickDevice chooser (user gesture required)
    const result = await demo.discover(entry => {
      log('device', demo.formatDeviceLine(entry))
      renderDeviceList()
    })
    log('discover mode', result.mode)
    if (result.device) {
      selectedId = result.device.id
      renderDeviceList()
      setButtons({
        'btn-discover': true,
        'btn-stop-scan': false,
        'btn-connect': true,
        'btn-inspect': true,
        'btn-monitor': false,
        'btn-stop-hr': false,
        'btn-disconnect': false
      })
      setStatus(`Found ${result.device.name || result.device.id}`)
    } else if (result.mode === 'scan') {
      setButtons({
        'btn-discover': false,
        'btn-stop-scan': true,
        'btn-connect': false,
        'btn-inspect': false,
        'btn-monitor': false,
        'btn-stop-hr': false,
        'btn-disconnect': false
      })
      setStatus('Scanning… select a device from the list')
    }
  } catch (e) {
    log('discover error', String(e))
    setStatus('Discover failed (need user gesture / secure context / BLE)')
  }
}

document.getElementById('btn-stop-scan').onclick = async () => {
  await demo.stopScan()
  setButtons({
    'btn-discover': true,
    'btn-stop-scan': false,
    'btn-connect': !!selectedId,
    'btn-inspect': !!selectedId,
    'btn-monitor': false,
    'btn-stop-hr': false,
    'btn-disconnect': false
  })
  setStatus('Scan stopped')
}

document.getElementById('btn-connect').onclick = async () => {
  if (!selectedId) return
  setStatus('Connecting…')
  try {
    await demo.connect(selectedId)
    const info = await demo.inspectDevice(selectedId)
    inspectEl.textContent = JSON.stringify(info, null, 2)
    log('inspect', info.id, 'services', info.serviceCount)
    setStatus(`Connected to ${info.name || info.id}`)
    setButtons({
      'btn-discover': true,
      'btn-stop-scan': false,
      'btn-connect': false,
      'btn-inspect': true,
      'btn-monitor': true,
      'btn-stop-hr': false,
      'btn-disconnect': true
    })
  } catch (e) {
    log('connect error', String(e))
    setStatus('Connect failed')
  }
}

document.getElementById('btn-inspect').onclick = async () => {
  if (!selectedId) return
  try {
    const info = await demo.inspectDevice(selectedId)
    inspectEl.textContent = JSON.stringify(info, null, 2)
    log('inspect refresh', info.connected ? 'connected' : 'not connected', info.serviceCount, 'services')
    setStatus(`Inspected ${info.name || info.id}`)
  } catch (e) {
    log('inspect error', String(e))
  }
}

document.getElementById('btn-monitor').onclick = async () => {
  if (!selectedId) return
  try {
    await demo.startHeartRate(selectedId, sample => {
      if (sample.error) {
        log('HR', String(sample.error))
        return
      }
      bpmEl.textContent = String(sample.heartRate)
      log(`HR ${sample.heartRate} bpm`, sample.raw)
      setStatus(`Streaming ${sample.heartRate} bpm`)
    })
    setButtons({
      'btn-discover': true,
      'btn-stop-scan': false,
      'btn-connect': false,
      'btn-inspect': true,
      'btn-monitor': false,
      'btn-stop-hr': true,
      'btn-disconnect': true
    })
    setStatus('HR stream active')
  } catch (e) {
    log('HR start error', String(e))
  }
}

document.getElementById('btn-stop-hr').onclick = async () => {
  await demo.stopHeartRate()
  bpmEl.textContent = '—'
  setStatus('HR stopped')
  setButtons({
    'btn-discover': true,
    'btn-stop-scan': false,
    'btn-connect': false,
    'btn-inspect': true,
    'btn-monitor': true,
    'btn-stop-hr': false,
    'btn-disconnect': true
  })
}

document.getElementById('btn-disconnect').onclick = async () => {
  await demo.disconnect(selectedId)
  bpmEl.textContent = '—'
  inspectEl.textContent = ''
  setStatus('Disconnected')
  setButtons({
    'btn-discover': true,
    'btn-stop-scan': false,
    'btn-connect': !!selectedId,
    'btn-inspect': !!selectedId,
    'btn-monitor': false,
    'btn-stop-hr': false,
    'btn-disconnect': false
  })
}
