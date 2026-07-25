/**
 * Host-agnostic central demo: scan / pick device / list / inspect / profiles.
 * Single source for CJS (Electron/smoke/tests) and ESM (web via centralDemo.mjs re-export).
 *
 * Discovery modes (honest supports()):
 * - continuousScan/scan → startDeviceScan (Electron, mobile, fake radio)
 * - requestDevice only → pickDevice() chooser (Web Bluetooth)
 *
 * Profile helpers (`hr` arg): Heart Rate module or full `example-shared/profiles`
 * package re-export (Battery, DIS, HT, BP included when present).
 */

'use strict'

const { readCommonProfiles: readCommonProfilesHelper } = require('./readCommonProfiles')

/**
 * @param {object} manager PortBleManager / web / electron BleManager
 * @param {object} hr heartRate helpers module (or full profiles re-export)
 * @param {{
 *   log?: (...args: unknown[]) => void,
 *   heartRateOnly?: boolean,
 *   sortDevices?: Function,
 *   bonding?: boolean,
 *   namePrefix?: string,
 *   profiles?: object
 * }} [options]
 *   `heartRateOnly` defaults to **true** — only devices advertising Heart Rate Service
 *   (scan filter / Web chooser filters). Toggle via setHeartRateOnly().
 *   `bonding` optional override; otherwise derived from supports() / Fake mock backend.
 */
function createCentralDemo(manager, hr, options = {}) {
  const log = options.log || (() => {})
  /** Full profiles bag when second arg is package re-export; falls back to hr-only. */
  const profiles = options.profiles || hr
  /** @type {Map<string, { id: string, name: string|null, rssi: number|null, lastSeen: number, source: string }>} */
  const devices = new Map()
  let scanning = false
  let hrSub = null
  let connectedId = null
  /** When true (default), discovery filters to Heart Rate Service broadcasters. */
  let heartRateOnly = options.heartRateOnly !== false

  function resolveBondingCapability() {
    if (typeof options.bonding === 'boolean') return options.bonding
    // Fail-closed: honest supports() first (charter).
    if (manager.supports('bonding') === true) return true
    // Electron Fake demos: host matrix is bonding:false for live OS, but mock backend
    // implements createBond/listBonded via FakeBlePort — surface that for Pair UI.
    try {
      const info = typeof manager.getHostInfo === 'function' ? manager.getHostInfo() : null
      if (
        info &&
        info.backend === 'mock' &&
        typeof manager.createBond === 'function' &&
        typeof manager.bondedDevices === 'function'
      ) {
        return true
      }
    } catch {
      // ignore
    }
    return false
  }

  function capabilities() {
    // Fail-closed: only advertise caps when supports() === true (charter).
    const continuousScan = manager.supports('continuousScan') === true || manager.supports('scan') === true
    const requestDevice =
      manager.supports('requestDevice') === true && typeof manager.requestDevice === 'function'
    return {
      continuousScan,
      requestDevice,
      notify: manager.supports('notify') === true,
      bytesPath: manager.supports('bytesPath') === true,
      bonding: resolveBondingCapability()
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

  /**
   * @param {{ sortBy?: 'name'|'rssi'|'lastSeen'|'id', order?: 'asc'|'desc' }} [opts]
   */
  function listDevices(opts = {}) {
    const list = Array.from(devices.values())
    const key = opts.sortBy || 'lastSeen'
    const order = opts.order || (key === 'name' || key === 'id' ? 'asc' : 'desc')
    // Prefer pure discovery helper (never package main — that pulls RN BleManager into web).
    // Injected sortDevices (options) wins; else resolve discovery/deviceSort only.
    const injected = options.sortDevices
    if (typeof injected === 'function') {
      return injected(list, { key, order })
    }
    try {
      // CJS: prefer compiled discovery path, then src (dev without prepack).
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const mod =
        (function loadSort() {
          const candidates = [
            '../lib/commonjs/discovery/deviceSort',
            '../src/discovery/deviceSort',
            // package subpath if published; never package root
            'unified-ble-manager/lib/commonjs/discovery/deviceSort'
          ]
          for (const p of candidates) {
            try {
              // eslint-disable-next-line global-require, import/no-dynamic-require
              return require(p)
            } catch {
              // try next
            }
          }
          return null
        })()
      if (mod && typeof mod.sortDevices === 'function') {
        return mod.sortDevices(list, { key, order })
      }
    } catch {
      // fall through
    }
    // Inline fallback aligned with discovery/deviceSort (empty names last via \uffff).
    return list.slice().sort((a, b) => {
      if (key === 'rssi') return order === 'asc' ? (a.rssi ?? -999) - (b.rssi ?? -999) : (b.rssi ?? -999) - (a.rssi ?? -999)
      if (key === 'name') {
        const an = (a.name == null || a.name === '' ? '\uffff' : String(a.name)).toLowerCase()
        const bn = (b.name == null || b.name === '' ? '\uffff' : String(b.name)).toLowerCase()
        return order === 'asc' ? an.localeCompare(bn) : bn.localeCompare(an)
      }
      if (key === 'id') return order === 'asc' ? String(a.id).localeCompare(String(b.id)) : String(b.id).localeCompare(String(a.id))
      return order === 'asc' ? (a.lastSeen || 0) - (b.lastSeen || 0) : (b.lastSeen || 0) - (a.lastSeen || 0)
    })
  }

  function getDevice(id) {
    return devices.get(id) || null
  }

  function clearDevices() {
    devices.clear()
  }

  /**
   * List OS / Fake bonded (paired) devices when the manager supports it.
   * Web returns []. Android uses bondedDevices(); Port/Fake uses listBondedDevices.
   */
  async function listPairedDevices() {
    if (typeof manager.bondedDevices === 'function') {
      try {
        const list = await manager.bondedDevices()
        return (list || []).map(d => ({
          id: d.id,
          name: d.name ?? null,
          rssi: d.rssi ?? null,
          bondState: 'bonded',
          source: 'bonded'
        }))
      } catch (e) {
        log('listPairedDevices', e.message || String(e))
      }
    }
    return []
  }

  async function pairDevice(deviceId) {
    const id = deviceId || connectedId
    if (!id) throw new Error('deviceId required')
    if (typeof manager.createBond === 'function') {
      await manager.createBond(id)
    } else {
      throw new Error('createBond is not available on this host')
    }
    log('paired', id)
    return listPairedDevices()
  }

  async function unpairDevice(deviceId) {
    const id = deviceId
    if (!id) throw new Error('deviceId required')
    if (typeof manager.removeBond === 'function') {
      await manager.removeBond(id)
    } else {
      throw new Error('removeBond is not available on this host')
    }
    log('unpaired', id)
    return listPairedDevices()
  }

  async function getBondState(deviceId) {
    if (typeof manager.getBondState !== 'function') return 'none'
    try {
      return await manager.getBondState(deviceId)
    } catch {
      return 'none'
    }
  }

  function setHeartRateOnly(enabled) {
    heartRateOnly = !!enabled
    log('heartRateOnly', heartRateOnly)
  }

  function getHeartRateOnly() {
    return heartRateOnly
  }

  /**
   * Start continuous scan when supported. On web, throws with guidance to use pickDevice.
   * Sets scanning=true only after startDeviceScan succeeds (avoids desync on throw).
   * @param {(device: object) => void} [onDevice]
   * @param {{ heartRateOnly?: boolean }} [scanOptions] override default heartRateOnly for this scan
   */
  async function startScan(onDevice, scanOptions = {}) {
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
    const filterHr = scanOptions.heartRateOnly !== undefined ? !!scanOptions.heartRateOnly : heartRateOnly
    // Prefer package helper resolveHeartRateScanUUIDs when present (generic profile API)
    let serviceUUIDs = null
    if (filterHr) {
      if (typeof hr.resolveHeartRateScanUUIDs === 'function') {
        serviceUUIDs = hr.resolveHeartRateScanUUIDs(true)
      } else if (typeof hr.heartRateScanServiceUUIDs === 'function') {
        serviceUUIDs = hr.heartRateScanServiceUUIDs()
      } else {
        serviceUUIDs = [hr.HR_SERVICE_UUID, '180d']
      }
    }
    log('scan start', filterHr ? `heartRateOnly services=${(serviceUUIDs || []).join(',')}` : 'all devices')
    try {
      await manager.startDeviceScan(serviceUUIDs, null, (error, device) => {
        if (error) {
          log('scan error', error.message || String(error))
          return
        }
        if (!device) return
        const entry = remember(device, 'scan')
        if (entry && onDevice) onDevice(entry)
      })
      scanning = true
    } catch (e) {
      scanning = false
      throw e
    }
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
   * Web Bluetooth chooser. When heartRateOnly (default), uses HR service filters
   * (optionally + namePrefix for Polar-friendly demos via opts.namePrefix).
   * when false, acceptAllDevices with optionalServices still listing HR for access after pick.
   * @param {Array<object>|null} [filters] explicit filters, or null to derive from heartRateOnly
   * @param {{ heartRateOnly?: boolean, namePrefix?: string }} [opts]
   */
  async function pickDevice(filters, opts = {}) {
    const caps = capabilities()
    if (!caps.requestDevice) {
      throw new Error(
        'requestDevice is not supported on this host. Use startScan() for continuous discovery.'
      )
    }
    const filterHr = opts.heartRateOnly !== undefined ? !!opts.heartRateOnly : heartRateOnly
    // null filters → derive from heartRateOnly; empty array / undefined → acceptAllDevices on web
    let f = filters
    if (f == null) {
      // namePrefix is optional (no brand default in package); demos may pass 'Polar'
      const prefix = opts.namePrefix !== undefined ? opts.namePrefix : options.namePrefix
      f = filterHr
        ? hr.heartRateRequestFilters(prefix ? { namePrefix: prefix } : {})
        : undefined
    }
    log('requestDevice', filterHr ? 'heartRateOnly' : 'all devices', f || 'acceptAllDevices')
    // WebBluetoothPort: filters present → chooser filtered; absent/empty → acceptAllDevices
    // optionalServices for HR GATT remain on the manager constructor.
    const ad = await manager.requestDevice(f)
    const entry = remember(ad, 'chooser')
    log('picked', entry)
    return entry
  }

  /**
   * Unified discovery entry:
   * - continuousScan hosts → startScan (optional HR service UUID filter)
   * - requestDevice-only hosts → pickDevice (HR filters or acceptAllDevices)
   * @param {(device: object) => void} [onDevice]
   * @param {{ heartRateOnly?: boolean }} [opts]
   */
  async function discover(onDevice, opts = {}) {
    if (opts.heartRateOnly !== undefined) {
      heartRateOnly = !!opts.heartRateOnly
    }
    const caps = capabilities()
    if (caps.continuousScan) {
      await startScan(onDevice, { heartRateOnly })
      return { mode: 'scan', heartRateOnly }
    }
    if (caps.requestDevice) {
      const entry = await pickDevice(null, { heartRateOnly })
      if (entry && onDevice) onDevice(entry)
      return { mode: 'chooser', device: entry, heartRateOnly }
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
   * Metadata-only characteristic inventory (uuid + properties). Never auto-reads values;
   * valueBase64 is always null here — use readCommonProfiles for known SIG reads.
   */
  async function listCharacteristicsMeta(deviceId, serviceUUID) {
    // Prefer BlePort.discoverCharacteristics when the manager exposes a port (PortBleManager).
    const port = manager.port
    if (port && typeof port.discoverCharacteristics === 'function') {
      const metas = await port.discoverCharacteristics(deviceId, serviceUUID)
      return metas.map(c => ({
        uuid: c.uuid,
        isReadable: c.isReadable,
        isWritableWithResponse: c.isWritableWithResponse,
        isWritableWithoutResponse: c.isWritableWithoutResponse,
        isNotifiable: c.isNotifiable,
        valueBase64: null
      }))
    }
    // Fallback (e.g. RN BleManager): may trigger host-side reads; strip values for inventory honesty.
    const chars = await manager.characteristicsForDevice(deviceId, serviceUUID)
    return chars.map(c => ({
      uuid: c.uuid,
      isReadable: c.isReadable,
      isWritableWithResponse: c.isWritableWithResponse,
      isWritableWithoutResponse: c.isWritableWithoutResponse,
      isNotifiable: c.isNotifiable != null ? c.isNotifiable : c.isIndicatable,
      valueBase64: null
    }))
  }

  /**
   * Rich device + GATT summary for UI / logs.
   * Characteristic list is metadata-only (no eager Base64 reads).
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
        characteristics = await listCharacteristicsMeta(id, s.uuid)
      } catch (e) {
        characteristics = [{ error: e.message || String(e) }]
      }
      serviceDetails.push({
        uuid: s.uuid,
        isHeartRate: typeof hr.isHeartRateService === 'function' && hr.isHeartRateService(s.uuid),
        isBattery: typeof profiles.isBatteryService === 'function' && profiles.isBatteryService(s.uuid),
        isDeviceInformation:
          typeof profiles.isDeviceInformationService === 'function' &&
          profiles.isDeviceInformationService(s.uuid),
        isHealthThermometer:
          typeof profiles.isHealthThermometerService === 'function' &&
          profiles.isHealthThermometerService(s.uuid),
        isBloodPressure:
          typeof profiles.isBloodPressureService === 'function' && profiles.isBloodPressureService(s.uuid),
        characteristics: characteristics.map(c => {
          if (c.error) return c
          return {
            uuid: c.uuid,
            valueBase64: null,
            isReadable: c.isReadable,
            isNotifiable: c.isNotifiable,
            isHeartRateMeasurement:
              typeof hr.isHeartRateMeasurement === 'function' && hr.isHeartRateMeasurement(c.uuid),
            isBatteryLevel:
              typeof profiles.isBatteryLevel === 'function' && profiles.isBatteryLevel(c.uuid),
            isTemperatureMeasurement:
              typeof profiles.isTemperatureMeasurement === 'function' &&
              profiles.isTemperatureMeasurement(c.uuid),
            isBloodPressureMeasurement:
              typeof profiles.isBloodPressureMeasurement === 'function' &&
              profiles.isBloodPressureMeasurement(c.uuid)
          }
        })
      })
    }

    // Best-effort profile summary (reads common SIG chars when helpers exist)
    let common = null
    try {
      common = await readCommonProfiles(id)
    } catch (e) {
      log('readCommonProfiles note', e.message || String(e))
    }

    return {
      id,
      name: listed?.name ?? null,
      rssi: listed?.rssi ?? null,
      source: listed?.source ?? null,
      lastSeen: listed?.lastSeen ?? null,
      connected,
      serviceCount: services.length,
      services: serviceDetails,
      common
    }
  }

  /**
   * Read Battery / DIS / HT / BP when the connected device exposes them.
   * Delegates to shared example-shared/readCommonProfiles (R2-F062).
   */
  async function readCommonProfiles(deviceId) {
    const id = deviceId || connectedId
    if (!id) throw new Error('deviceId required')
    return readCommonProfilesHelper(manager, id, profiles, {
      listCharacteristicsMeta: (devId, serviceUUID) => listCharacteristicsMeta(devId, serviceUUID)
    })
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
        const chars = await listCharacteristicsMeta(id, serviceUUID)
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
        const rrIntervalsSec = parsed.rrIntervalsSec || []
        const ibiMs =
          typeof hr.rrIntervalsToIbiMs === 'function'
            ? hr.rrIntervalsToIbiMs(rrIntervalsSec)
            : rrIntervalsSec.map(s => Math.round(s * 1000))
        const sample = {
          heartRate: parsed.heartRate,
          rrIntervalsSec,
          ibiMs,
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
    listPairedDevices,
    pairDevice,
    unpairDevice,
    getBondState,
    getDevice,
    clearDevices,
    startScan,
    stopScan,
    pickDevice,
    discover,
    connect,
    disconnect,
    inspectDevice,
    readCommonProfiles,
    startHeartRate,
    stopHeartRate,
    formatDeviceLine,
    setHeartRateOnly,
    getHeartRateOnly,
    isScanning: () => scanning,
    connectedId: () => connectedId
  }
}

/**
 * Multi-device FakeBlePort: Polar (HR+Battery+DIS) + HR band + thermometer + BP cuff + beacon.
 * Shared by electron smoke / CentralDemo tests.
 *
 * Clinical HT/BP chars default to **indicate-only** (read:false, no seed value) so
 * readCommonProfiles returns `{ skipped: true }` — honest for real HT/BP devices.
 * Pass `{ clinicalReadable: true }` to seed readable measurement bytes for UI demos.
 *
 * @param {typeof import('../src/port/BlePort').FakeBlePort} FakeBlePort
 * @param {object} profiles package profile helpers (or HR-only module with encode*)
 * @param {{ clinicalReadable?: boolean }} [options]
 */
function createDemoFakeRadio(FakeBlePort, profiles, options = {}) {
  const p = profiles
  const clinicalReadable = options.clinicalReadable === true
  const polarId = 'polar-h10-sim'
  const otherHrId = 'hr-band-sim'
  const beaconId = 'beacon-no-hr'
  const thermoId = 'thermo-sim'
  const bpId = 'bp-cuff-sim'

  const polarServices = {
    [p.HR_SERVICE_UUID]: {
      [p.HR_MEASUREMENT_UUID]: {
        value: p.encodeHeartRateMeasurement(72, { rrIntervalsSec: [60 / 72] }),
        properties: { read: true, write: false, notify: true }
      }
    }
  }
  // Battery + DIS when full profiles bag is available
  if (p.BATTERY_SERVICE_UUID && p.encodeBatteryLevel) {
    polarServices[p.BATTERY_SERVICE_UUID] = {
      [p.BATTERY_LEVEL_UUID]: {
        value: p.encodeBatteryLevel(81),
        properties: { read: true, write: false, notify: false }
      }
    }
  }
  if (p.DEVICE_INFORMATION_SERVICE_UUID && p.encodeDeviceInformationString) {
    polarServices[p.DEVICE_INFORMATION_SERVICE_UUID] = {
      [p.MANUFACTURER_NAME_UUID]: {
        value: p.encodeDeviceInformationString('Polar Electro Oy'),
        properties: { read: true }
      },
      [p.MODEL_NUMBER_UUID]: {
        value: p.encodeDeviceInformationString('H10'),
        properties: { read: true }
      },
      [p.FIRMWARE_REVISION_UUID]: {
        value: p.encodeDeviceInformationString('3.0.35'),
        properties: { read: true }
      }
    }
  }

  const advertisements = [
    { id: polarId, name: 'Polar H10 12345678', rssi: -52 },
    { id: otherHrId, name: 'Generic HR Band', rssi: -61 },
    { id: beaconId, name: 'Office Beacon', rssi: -70 }
  ]
  const services = {
    [polarId]: polarServices,
    [otherHrId]: {
      [p.HR_SERVICE_UUID]: {
        [p.HR_MEASUREMENT_UUID]: {
          value: p.encodeHeartRateMeasurement(88, { rrIntervalsSec: [60 / 88] }),
          properties: { read: true, write: false, notify: true }
        }
      }
    },
    [beaconId]: {
      [p.DEVICE_INFORMATION_SERVICE_UUID || '0000180a-0000-1000-8000-00805f9b34fb']: {
        [p.MANUFACTURER_NAME_UUID || '00002a29-0000-1000-8000-00805f9b34fb']: {
          value: p.encodeDeviceInformationString
            ? p.encodeDeviceInformationString('Demo')
            : new Uint8Array([0x44, 0x65, 0x6d, 0x6f]),
          properties: { read: true, write: false, notify: false }
        }
      }
    }
  }

  if (p.HEALTH_THERMOMETER_SERVICE_UUID && p.encodeTemperatureMeasurement) {
    advertisements.push({ id: thermoId, name: 'Thermo Probe', rssi: -58 })
    const thermoSpec = {
      properties: { read: clinicalReadable, indicate: true, notify: false }
    }
    if (clinicalReadable) {
      thermoSpec.value = p.encodeTemperatureMeasurement(36.8, {
        temperatureType: (p.TemperatureType && p.TemperatureType.Body) || 2
      })
    }
    services[thermoId] = {
      [p.HEALTH_THERMOMETER_SERVICE_UUID]: {
        [p.TEMPERATURE_MEASUREMENT_UUID]: thermoSpec
      }
    }
  }
  if (p.BLOOD_PRESSURE_SERVICE_UUID && p.encodeBloodPressureMeasurement) {
    advertisements.push({ id: bpId, name: 'BP Cuff', rssi: -63 })
    const bpSpec = {
      properties: { read: clinicalReadable, indicate: true, notify: false }
    }
    if (clinicalReadable) {
      bpSpec.value = p.encodeBloodPressureMeasurement(120, 80, 93, { pulseRate: 70 })
    }
    services[bpId] = {
      [p.BLOOD_PRESSURE_SERVICE_UUID]: {
        [p.BLOOD_PRESSURE_MEASUREMENT_UUID]: bpSpec
      }
    }
  }

  const port = new FakeBlePort({
    id: 'example-multi-device-radio',
    advertisements,
    services
  })
  return {
    port,
    devices: {
      polarId,
      otherHrId,
      beaconId,
      thermoId,
      bpId,
      polarName: 'Polar H10 12345678',
      otherHrName: 'Generic HR Band',
      beaconName: 'Office Beacon',
      thermoName: 'Thermo Probe',
      bpName: 'BP Cuff'
    },
    clinicalReadable
  }
}

module.exports = {
  createCentralDemo,
  createDemoFakeRadio,
  // Re-export shared helper for mobile BLEService / unit tests (R2-F062)
  readCommonProfiles: readCommonProfilesHelper
}
