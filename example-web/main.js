/**
 * Minimal browser demo. Load via any static server from repo root after prepack,
 * or open through a bundler that resolves package exports.
 *
 * For local smoke without a bundler, we dynamically import the built CJS is awkward
 * in browsers — prefer: serve with a tool that understands package exports, or
 * run unit tests for the ship path. This file documents the call shape.
 */

import { BleManager } from '../src/hosts/web.ts'

const logEl = document.getElementById('log')
const log = (...args) => {
  const line = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
  logEl.textContent += line + '\n'
  console.log(...args)
}

const manager = new BleManager({
  optionalServices: ['battery_service', '0000180f-0000-1000-8000-00805f9b34fb']
})

log('supports(requestDevice)=', manager.supports('requestDevice'))
log('supports(continuousScan)=', manager.supports('continuousScan'))
log('supports(iosStateRestoration)=', manager.supports('iosStateRestoration'))

let deviceId = null

document.getElementById('btn-request').onclick = async () => {
  try {
    const ad = await manager.requestDevice([{ services: ['battery_service'] }])
    deviceId = ad.id
    log('selected', ad)
    document.getElementById('btn-connect').disabled = false
  } catch (e) {
    log('requestDevice error', String(e))
  }
}

document.getElementById('btn-connect').onclick = async () => {
  try {
    await manager.connectToDevice(deviceId)
    await manager.discoverAllServicesAndCharacteristicsForDevice(deviceId)
    log('connected + discovered')
    document.getElementById('btn-read').disabled = false
  } catch (e) {
    log('connect error', String(e))
  }
}

document.getElementById('btn-read').onclick = async () => {
  try {
    const services = await manager.servicesForDevice(deviceId)
    log('services', services)
    // Best-effort first readable characteristic
    for (const s of services) {
      const chars = await manager.characteristicsForDevice(deviceId, s.uuid)
      for (const c of chars) {
        try {
          const r = await manager.readCharacteristicForDeviceAsBytes(deviceId, s.uuid, c.uuid)
          log('read bytes', s.uuid, c.uuid, Array.from(r.value || []))
          return
        } catch {
          // try next
        }
      }
    }
    log('no readable characteristic found')
  } catch (e) {
    log('read error', String(e))
  }
}
