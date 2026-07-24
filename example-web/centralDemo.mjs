/**
 * ESM twin of example-shared/centralDemo.js — same behavior for the web example.
 * Keep in sync with the CJS source of truth when changing discovery/inspect APIs.
 */

export function createCentralDemo(manager, hr, options = {}) {
  const log = options.log || (() => {})
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

  async function startScan(onDevice) {
    const caps = capabilities()
    if (!caps.continuousScan) {
      const hint = caps.requestDevice
        ? ' This host only supports requestDevice() (chooser). Call pickDevice() instead.'
        : ''
      throw new Error(`Continuous scan is not supported on this host.${hint}`)
    }
    if (scanning) await stopScan()
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
        /* ignore */
      }
      return
    }
    scanning = false
    await manager.stopDeviceScan()
    log('scan stop')
  }

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
    remember(
      { id: deviceId, name: device?.name ?? getDevice(deviceId)?.name ?? null, rssi: null },
      'connected'
    )
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
