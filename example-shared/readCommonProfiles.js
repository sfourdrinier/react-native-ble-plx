/**
 * Host-agnostic Battery / DIS / HT / BP profile reads.
 * Single source for centralDemo and mobile BLEService parity (R2-F062).
 *
 * Temperature Measurement and Blood Pressure Measurement are often **Indicate-only**
 * (not readable). We skip when meta.isReadable===false before attempting a read.
 *
 * @param {object} manager PortBleManager / RN BleManager (byte read API)
 * @param {string} deviceId
 * @param {object} profiles package profile helpers (parse* / is*)
 * @param {{
 *   listCharacteristicsMeta?: (deviceId: string, serviceUUID: string) => Promise<Array<{
 *     uuid: string, isReadable?: boolean, error?: string
 *   }>>
 * }} [options]
 */
'use strict'

/**
 * @returns {Promise<{
 *   battery: object|null,
 *   deviceInformation: object|null,
 *   temperature: object|null,
 *   bloodPressure: object|null
 * }>}
 */
async function readCommonProfiles(manager, deviceId, profiles, options = {}) {
  if (!deviceId) throw new Error('deviceId required')
  if (!manager || typeof manager.servicesForDevice !== 'function') {
    throw new Error('manager.servicesForDevice required')
  }
  const p = profiles || {}
  const out = {
    battery: null,
    deviceInformation: null,
    temperature: null,
    bloodPressure: null
  }
  const services = await manager.servicesForDevice(deviceId)

  /**
   * Best-effort read. Returns { ok, value?, reason?, skipped? }.
   * Does not throw for missing/unreadable characteristics (Indicate-only).
   */
  async function tryReadBytes(serviceUUID, charUUID, label, meta) {
    if (meta && meta.isReadable === false) {
      return {
        ok: false,
        skipped: true,
        reason: `${label}: not readable (indicate/notify-only; subscribe for live data)`
      }
    }
    if (typeof manager.readCharacteristicForDeviceAsBytes !== 'function') {
      return { ok: false, skipped: true, reason: 'host has no byte read API' }
    }
    try {
      const snap = await manager.readCharacteristicForDeviceAsBytes(deviceId, serviceUUID, charUUID)
      const value = snap?.value ?? null
      if (value && (value.byteLength > 0 || value.length > 0)) {
        return { ok: true, value }
      }
      return {
        ok: false,
        skipped: true,
        reason: `${label}: empty value (may be indicate/notify-only; subscribe for live data)`
      }
    } catch (e) {
      return {
        ok: false,
        skipped: true,
        reason: `${label}: ${e.message || String(e)} (often indicate-only on real devices)`
      }
    }
  }

  async function charsForService(serviceUUID) {
    if (typeof options.listCharacteristicsMeta === 'function') {
      try {
        return await options.listCharacteristicsMeta(deviceId, serviceUUID)
      } catch {
        // fall through
      }
    }
    // PortBleManager metadata-only inventory (includes isReadable; no eager reads)
    if (typeof manager.characteristicsMetaForDevice === 'function') {
      try {
        return await manager.characteristicsMetaForDevice(deviceId, serviceUUID)
      } catch {
        // fall through
      }
    }
    try {
      const chars = await manager.characteristicsForDevice(deviceId, serviceUUID)
      return (chars || []).map(c => ({
        uuid: c.uuid,
        isReadable: c.isReadable,
        valueBase64: null
      }))
    } catch {
      return []
    }
  }

  // Battery (typically readable)
  if (typeof p.isBatteryService === 'function') {
    const batSvc = services.find(s => p.isBatteryService(s.uuid))
    if (batSvc && typeof p.parseBatteryLevel === 'function') {
      try {
        const chars = await charsForService(batSvc.uuid)
        const levelChar = chars.find(c => p.isBatteryLevel(c.uuid))
        if (levelChar) {
          const r = await tryReadBytes(batSvc.uuid, levelChar.uuid, 'Battery Level', levelChar)
          if (r.ok) out.battery = p.parseBatteryLevel(r.value)
          else out.battery = { skipped: true, reason: r.reason }
        }
      } catch (e) {
        out.battery = { error: e.message || String(e) }
      }
    }
  }

  // Device Information (readable strings)
  if (typeof p.isDeviceInformationService === 'function') {
    const disSvc = services.find(s => p.isDeviceInformationService(s.uuid))
    if (disSvc && typeof p.assembleDeviceInformation === 'function') {
      try {
        const chars = await charsForService(disSvc.uuid)
        const snaps = []
        for (const c of chars) {
          const r = await tryReadBytes(disSvc.uuid, c.uuid, 'DIS', c)
          if (r.ok) snaps.push({ uuid: c.uuid, value: r.value })
        }
        out.deviceInformation = p.assembleDeviceInformation(snaps)
      } catch (e) {
        out.deviceInformation = { error: e.message || String(e) }
      }
    }
  }

  // Health Thermometer — often Indicate-only (0x2A1C)
  if (typeof p.isHealthThermometerService === 'function') {
    const htSvc = services.find(s => p.isHealthThermometerService(s.uuid))
    if (htSvc && typeof p.parseTemperatureMeasurement === 'function') {
      try {
        const chars = await charsForService(htSvc.uuid)
        const meas = chars.find(c => p.isTemperatureMeasurement(c.uuid))
        if (meas) {
          const r = await tryReadBytes(htSvc.uuid, meas.uuid, 'Temperature Measurement', meas)
          if (r.ok) out.temperature = p.parseTemperatureMeasurement(r.value)
          else out.temperature = { skipped: true, reason: r.reason }
        }
      } catch (e) {
        out.temperature = { error: e.message || String(e) }
      }
    }
  }

  // Blood Pressure — often Indicate-only (0x2A35)
  if (typeof p.isBloodPressureService === 'function') {
    const bpSvc = services.find(s => p.isBloodPressureService(s.uuid))
    if (bpSvc && typeof p.parseBloodPressureMeasurement === 'function') {
      try {
        const chars = await charsForService(bpSvc.uuid)
        const meas = chars.find(c => p.isBloodPressureMeasurement(c.uuid))
        if (meas) {
          const r = await tryReadBytes(bpSvc.uuid, meas.uuid, 'Blood Pressure Measurement', meas)
          if (r.ok) out.bloodPressure = p.parseBloodPressureMeasurement(r.value)
          else out.bloodPressure = { skipped: true, reason: r.reason }
        }
      } catch (e) {
        out.bloodPressure = { error: e.message || String(e) }
      }
    }
  }

  return out
}

module.exports = {
  readCommonProfiles
}
