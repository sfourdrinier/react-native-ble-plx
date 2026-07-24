/**
 * Host-agnostic central demo: scan / pick device / list / inspect / HR stream.
 * Used by example-electron (CJS) and mirrored for example-web (ESM).
 *
 * Discovery modes (honest supports()):
 * - continuousScan/scan → startDeviceScan (Electron, mobile, fake radio)
 * - requestDevice only → pickDevice() chooser (Web Bluetooth)
 */

'use strict'

/**
 * @param {object} manager PortBleManager / web / electron BleManager
 * @param {object} hr heartRate helpers module
 * @param {{ log?: (...args: unknown[]) => void }} [options]
 */
function createCentralDemo(manager, hr, options = {}) {
  const log = options.log || (() => {})
  /** @type {Map<string, { id: string, name: string|null, rssi: number|null, lastSeen: number, source: string }>} */
  const devices = new Map()
  let scanning = false
  let hrSub = null
  let connectedId = null

  function capabilities() {
    const continuousScan = manager.supports('continuousScan') === true || manager.supports('scan') === true
    const requestDevice =
      manager.supports('requestDevice') === true && typeof manager.requestDevice === 'function'
    return {
      continuousScan,
      requestDevice,
      notify: manager.supports('notify') !== false,
      bytesPath: manager.supports('bytesPath') !== false
    }
  }

  function remember(device, source) {
    if (!device || !device.id) return null
    const prev = devices.get(device.id)
    const entry = {
      id: device.id,
      name: device.name != null ? device.name : prev?.name ?? null,
      rssi: device.rssi != null ? device.rssi : prev?.rssi ?? null,
      lastSeen: Date.now(),
      source: source || prev?.source || 'unknown'
    }
    devices.set(device.id, entry)
    return entry
  }

  function listDevices() {
    return Array.from(devices.values()).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))
  }

  function getDevice(id) {
    return devices.get(id) || null
  }

  function clearDevices() {
    devices.clear()
  }

  /**
   * Start continuous scan when supported. On web, throws with guidance to use pickDevice.
   * @param {(device: object) => void} [onDevice]
   */
  async function startScan(onDevice) {
    const caps = capabilities()
    if (!caps.continuousScan) {
      const hint = caps.requestDevice
        ? ' This host only supports requestDevice() (chooser). Call pickDevice() instead.'
        : ''
      throw new Error(`Continuous scan is not supported on this host.${hint}`)
    }
    if (scanning) {
      await stopScan()
    }
    scanning = true
    log('scan start')
    await manager.startDeviceScan(null, null, (error, device) => {
      if (error) {
        log('scan error', error.message || String(error))
        return
      }
      if (!device) return
      const entry = remember(device, 'scan')
      if (entry && onDevice) onDevice(entry)
    })
  }

  async function stopScan() {
    if (!scanning) {
      try {
        await manager.stopDeviceScan()
      } catch {
        // ignore
      }
      return
    }
    scanning = false
    await manager.stopDeviceScan()
    log('scan stop')
  }

  /**
   * Web Bluetooth (or any host with requestDevice): one-shot chooser, adds to device list.
   * @param {Array<object>} [filters] default heart-rate / Polar filters
   */
  async function pickDevice(filters) {
    const caps = capabilities()
    if (!caps.requestDevice) {
      throw new Error(
        'requestDevice is not supported on this host. Use startScan() for continuous discovery.'
      )
    }
    const f = filters || hr.heartRateRequestFilters()
    log('requestDevice', f)
    const ad = await manager.requestDevice(f)
    const entry = remember(ad, 'chooser')
    log('picked', entry)
    return entry
  }

  /**
   * Unified discovery entry:
   * - continuousScan hosts → startScan
   * - requestDevice-only hosts → pickDevice (single result, still fills list)
   */
  async function discover(onDevice) {
    const caps = capabilities()
    if (caps.continuousScan) {
      await startScan(onDevice)
      return { mode: 'scan' }
    }
    if (caps.requestDevice) {
      const entry = await pickDevice()
      if (entry && onDevice) onDevice(entry)
      return { mode: 'chooser', device: entry }
    }
    throw new Error('No discovery method available (neither scan nor requestDevice)')
  }

  async function connect(deviceId) {
    if (scanning) await stopScan()
    log('connect', deviceId)
    const device = await manager.connectToDevice(deviceId)
    remember({ id: deviceId, name: device?.name ?? getDevice(deviceId)?.name ?? null, rssi: null }, 'connected')
    await manager.discoverAllServicesAndCharacteristicsForDevice(deviceId)
    connectedId = deviceId
    log('connected + discovered', deviceId)
    return device
  }

  async function disconnect(deviceId) {
    const id = deviceId || connectedId
    if (!id) return
    await stopHeartRate()
    await manager.cancelDeviceConnection(id)
    if (connectedId === id) connectedId = null
    log('disconnect', id)
  }

  /**
   * Rich device + GATT summary for UI / logs.
   */
  async function inspectDevice(deviceId) {
    const id = deviceId || connectedId
    if (!id) throw new Error('deviceId required')
    const listed = getDevice(id)
    const connected = await manager.isDeviceConnected(id)
    const services = connected ? await manager.servicesForDevice(id) : []
    const serviceDetails = []
    for (const s of services) {
      let characteristics = []
      try {
        characteristics = await manager.characteristicsForDevice(id, s.uuid)
      } catch (e) {
        characteristics = [{ error: e.message || String(e) }]
      }
      serviceDetails.push({
        uuid: s.uuid,
        isHeartRate: hr.isHeartRateService(s.uuid),
        characteristics: characteristics.map(c => ({
          uuid: c.uuid,
          valueBase64: c.value != null ? c.value : null,
          isHeartRateMeasurement: hr.isHeartRateMeasurement(c.uuid)
        }))
      })
    }
    return {
      id,
      name: listed?.name ?? null,
      rssi: listed?.rssi ?? null,
      source: listed?.source ?? null,
      lastSeen: listed?.lastSeen ?? null,
      connected,
      serviceCount: services.length,
      services: serviceDetails
    }
  }

  async function startHeartRate(deviceId, onSample) {
    const id = deviceId || connectedId
    if (!id) throw new Error('deviceId required')
    await stopHeartRate()

    let serviceUUID = hr.HR_SERVICE_UUID
    let charUUID = hr.HR_MEASUREMENT_UUID
    try {
      const services = await manager.servicesForDevice(id)
      const hrSvc = services.find(s => hr.isHeartRateService(s.uuid))
      if (hrSvc) {
        serviceUUID = hrSvc.uuid
        const chars = await manager.characteristicsForDevice(id, serviceUUID)
        const meas = chars.find(c => hr.isHeartRateMeasurement(c.uuid))
        if (meas) charUUID = meas.uuid
      }
    } catch (e) {
      log('HR uuid resolve note', e.message || String(e))
    }

    log('HR monitor', serviceUUID, charUUID)
    hrSub = manager.monitorCharacteristicForDeviceAsBytes(id, serviceUUID, charUUID, (error, snap) => {
      if (error) {
        log('HR error', error.message || String(error))
        if (onSample) onSample({ error })
        return
      }
      if (!snap?.value) return
      try {
        const parsed = hr.parseHeartRateMeasurement(snap.value)
        const sample = {
          heartRate: parsed.heartRate,
          raw: Array.from(snap.value),
          parsed,
          deviceId: id
        }
        if (onSample) onSample(sample)
      } catch (parseErr) {
        log('HR parse error', parseErr.message || String(parseErr))
        if (onSample) onSample({ error: parseErr, raw: Array.from(snap.value) })
      }
    })
    return { serviceUUID, charUUID }
  }

  async function stopHeartRate() {
    if (hrSub) {
      hrSub.remove()
      hrSub = null
      log('HR monitor stopped')
    }
  }

  function formatDeviceLine(d) {
    const name = d.name || '(no name)'
    const rssi = d.rssi != null ? `${d.rssi} dBm` : 'rssi?'
    return `${d.id}  ${name}  ${rssi}  [${d.source || '?'}]`
  }

  return {
    manager,
    capabilities,
    listDevices,
    getDevice,
    clearDevices,
    startScan,
    stopScan,
    pickDevice,
    discover,
    connect,
    disconnect,
    inspectDevice,
    startHeartRate,
    stopHeartRate,
    formatDeviceLine,
    isScanning: () => scanning,
    connectedId: () => connectedId
  }
}

/**
 * Multi-device FakeBlePort config: Polar H10 + a second HR band + a non-HR beacon.
 * Shared by electron smoke so scan list is interesting.
 */
function createDemoFakeRadio(FakeBlePort, hr) {
  const polarId = 'polar-h10-sim'
  const otherHrId = 'hr-band-sim'
  const beaconId = 'beacon-no-hr'
  const port = new FakeBlePort({
    id: 'example-multi-device-radio',
    advertisements: [
      { id: polarId, name: 'Polar H10 12345678', rssi: -52 },
      { id: otherHrId, name: 'Generic HR Band', rssi: -61 },
      { id: beaconId, name: 'Office Beacon', rssi: -70 }
    ],
    services: {
      [polarId]: {
        [hr.HR_SERVICE_UUID]: {
          [hr.HR_MEASUREMENT_UUID]: {
            value: hr.encodeHeartRateMeasurement(72),
            properties: { read: true, write: false, notify: true }
          }
        }
      },
      [otherHrId]: {
        [hr.HR_SERVICE_UUID]: {
          [hr.HR_MEASUREMENT_UUID]: {
            value: hr.encodeHeartRateMeasurement(88),
            properties: { read: true, write: false, notify: true }
          }
        }
      },
      [beaconId]: {
        '0000180a-0000-1000-8000-00805f9b34fb': {
          '00002a29-0000-1000-8000-00805f9b34fb': {
            // Device Information Manufacturer Name-ish payload "Demo"
            value: new Uint8Array([0x44, 0x65, 0x6d, 0x6f]),
            properties: { read: true, write: false, notify: false }
          }
        }
      }
    }
  })
  return {
    port,
    devices: {
      polarId,
      otherHrId,
      beaconId,
      polarName: 'Polar H10 12345678',
      otherHrName: 'Generic HR Band',
      beaconName: 'Office Beacon'
    }
  }
}

module.exports = {
  createCentralDemo,
  createDemoFakeRadio
}
