/**
 * Web Bluetooth bridge implementing the same surface as Electron preload `bleApi`.
 * Used only in the browser (not in Electron renderer).
 */
import * as profiles from '../profiles.mjs'
import { createCentralDemo } from '../centralDemo.mjs'

async function loadWebBleManager() {
  try {
    return await import('unified-ble-manager/web')
  } catch {
    return await import('../../src/hosts/web.ts')
  }
}

function webOptionalServices() {
  const set = new Set([
    ...profiles.heartRateOptionalServices(),
    ...(typeof profiles.batteryOptionalServices === 'function' ? profiles.batteryOptionalServices() : []),
    ...(typeof profiles.deviceInformationOptionalServices === 'function'
      ? profiles.deviceInformationOptionalServices()
      : []),
    ...(typeof profiles.healthThermometerOptionalServices === 'function'
      ? profiles.healthThermometerOptionalServices()
      : []),
    ...(typeof profiles.bloodPressureOptionalServices === 'function'
      ? profiles.bloodPressureOptionalServices()
      : [])
  ])
  return Array.from(set)
}

/**
 * @returns {Promise<import('./app.js').BleBridge>}
 */
export async function createWebBleBridge() {
  const { BleManager } = await loadWebBleManager()
  const manager = new BleManager({
    optionalServices: webOptionalServices()
  })

  /** @type {Set<(entry: object) => void>} */
  const deviceListeners = new Set()
  /** @type {Set<(sample: object) => void>} */
  const hrListeners = new Set()
  /** @type {Set<(payload: { line?: string }) => void>} */
  const logListeners = new Set()

  const log = (...args) => {
    const line = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
    for (const l of logListeners) l({ line })
  }

  const demo = createCentralDemo(manager, profiles, { log })
  const caps = demo.capabilities()

  /** @type {import('./app.js').BleBridge} */
  const bridge = {
    async getState() {
      // live:false — Web Bluetooth is a chooser host, not continuous live OS radio.
      // Shared UI badge uses backend==='web' → WEB (not LIVE).
      return {
        radio: { backend: 'web', portId: 'web-bluetooth', live: false },
        capabilities: demo.capabilities(),
        devices: demo.listDevices(),
        heartRateOnly: demo.getHeartRateOnly()
      }
    },

    async setHeartRateOnly(enabled) {
      demo.setHeartRateOnly(!!enabled)
      return demo.getHeartRateOnly()
    },

    async getHeartRateOnly() {
      return demo.getHeartRateOnly()
    },

    async discover(opts = {}) {
      if (typeof demo.clearDevices === 'function') demo.clearDevices()
      const result = await demo.discover(entry => {
        for (const l of deviceListeners) l(entry)
      }, opts)
      return {
        mode: result.mode,
        device: result.device || null,
        devices: demo.listDevices(),
        heartRateOnly: result.heartRateOnly
      }
    },

    async stopScan() {
      await demo.stopScan()
      return { devices: demo.listDevices() }
    },

    async listDevices(opts = {}) {
      return demo.listDevices(opts || {})
    },

    /**
     * R3-F061: Chromium multi-session reconnect surface.
     * Returns permitted devices from manager.getDevices() when available; registers them in demo.
     * Handles OperationNotSupported without throwing for UI callers.
     */
    async getPermittedDevices() {
      if (typeof manager.getDevices !== 'function') {
        return []
      }
      try {
        const devices = await manager.getDevices()
        const list = Array.isArray(devices) ? devices : []
        for (const d of list) {
          if (d && d.id && typeof demo.rememberDevice === 'function') {
            demo.rememberDevice(d, 'permitted')
          }
        }
        return list.map(d => ({
          id: d.id,
          name: d.name != null ? d.name : null,
          rssi: d.rssi != null ? d.rssi : null,
          source: 'permitted'
        }))
      } catch (err) {
        const msg = String((err && err.message) || err)
        if (/OperationNotSupported|not supported|not available/i.test(msg)) {
          return []
        }
        throw err
      }
    },

    async listPairedDevices() {
      // Web has no bond list — always empty (honest)
      return []
    },

    async connect(deviceId) {
      await demo.connect(deviceId)
      return demo.inspectDevice(deviceId)
    },

    async inspect(deviceId) {
      return demo.inspectDevice(deviceId)
    },

    async startHr(deviceId) {
      await demo.startHeartRate(deviceId, sample => {
        for (const l of hrListeners) l(sample)
      })
      return { ok: true }
    },

    async stopHr() {
      await demo.stopHeartRate()
      return { ok: true }
    },

    async disconnect(deviceId) {
      await demo.disconnect(deviceId)
      return { ok: true }
    },

    onDevice(handler) {
      deviceListeners.add(handler)
      return () => deviceListeners.delete(handler)
    },

    onHr(handler) {
      hrListeners.add(handler)
      return () => hrListeners.delete(handler)
    },

    onLog(handler) {
      logListeners.add(handler)
      return () => logListeners.delete(handler)
    }
  }

  // R2-F066: omit pair/unpair stubs when bonding is not supported (Web).
  // Always-throw wrappers left Pair enabled in the UI for typeof checks.
  if (caps.bonding === true) {
    bridge.pairDevice = async deviceId => demo.pairDevice(deviceId)
    bridge.unpairDevice = async deviceId => demo.unpairDevice(deviceId)
    bridge.listPairedDevices = async () => {
      if (typeof demo.listPairedDevices !== 'function') return []
      return demo.listPairedDevices()
    }
  }

  return bridge
}
