/**
 * Battery, Device Information, Health Thermometer, Blood Pressure + IEEE-11073.
 * Mocks via FakeBlePort; edge cases for flags, truncation, special floats.
 */
const {
  // Battery
  BATTERY_SERVICE_UUID,
  BATTERY_SERVICE_ALIAS,
  BATTERY_LEVEL_UUID,
  batteryScanServiceUUIDs,
  resolveBatteryScanUUIDs,
  batteryRequestFilters,
  batteryOptionalServices,
  isBatteryService,
  isBatteryLevel,
  parseBatteryLevel,
  encodeBatteryLevel,
  // DIS
  DEVICE_INFORMATION_SERVICE_UUID,
  DEVICE_INFORMATION_SERVICE_ALIAS,
  MANUFACTURER_NAME_UUID,
  MODEL_NUMBER_UUID,
  FIRMWARE_REVISION_UUID,
  isDeviceInformationService,
  isManufacturerName,
  parseDeviceInformationString,
  encodeDeviceInformationString,
  assembleDeviceInformation,
  deviceInformationOptionalServices,
  parseSystemId,
  encodeSystemId,
  isSystemId,
  parsePnpId,
  encodePnpId,
  isPnpId,
  SYSTEM_ID_UUID,
  PNP_ID_UUID,
  // HT
  HEALTH_THERMOMETER_SERVICE_UUID,
  HEALTH_THERMOMETER_SERVICE_ALIAS,
  TEMPERATURE_MEASUREMENT_UUID,
  TemperatureType,
  isHealthThermometerService,
  isTemperatureMeasurement,
  parseTemperatureMeasurement,
  encodeTemperatureMeasurement,
  resolveHealthThermometerScanUUIDs,
  healthThermometerOptionalServices,
  // BP
  BLOOD_PRESSURE_SERVICE_UUID,
  BLOOD_PRESSURE_SERVICE_ALIAS,
  BLOOD_PRESSURE_MEASUREMENT_UUID,
  isBloodPressureService,
  isBloodPressureMeasurement,
  parseBloodPressureMeasurement,
  encodeBloodPressureMeasurement,
  bloodPressureScanServiceUUIDs,
  bloodPressureOptionalServices,
  // 11073
  parseIeee11073Float,
  encodeIeee11073Float,
  decodeIeee11073Float,
  parseIeee11073Sfloat,
  encodeIeee11073Sfloat,
  decodeIeee11073Sfloat,
  FLOAT_RFU_A,
  SFLOAT_RFU_A,
  SFLOAT_NRES,
  decodeBleString,
  // HR (existing) for multi-service fake
  HR_SERVICE_UUID,
  HR_MEASUREMENT_UUID,
  encodeHeartRateMeasurement,
  FakeBlePort,
  PortBleManager
} = require('unified-ble-manager')

const { useFakeTimers, useRealTimers, flushScan } = require('./helpers/async')

// R3-F065: shared FakeBlePort scan/notify flush (not ad-hoc 10ms advance)
const flush = async () => {
  await flushScan()
}

describe('IEEE-11073 FLOAT / SFLOAT', () => {
  test('FLOAT integer round-trip', () => {
    for (const v of [0, 1, -1, 36, 37, 100, -40, 2047]) {
      const raw = encodeIeee11073Float(v)
      expect(raw).toHaveLength(4)
      expect(parseIeee11073Float(raw)).toBeCloseTo(v, 5)
    }
  })

  test('FLOAT fractional (e.g. 36.6 °C)', () => {
    const raw = encodeIeee11073Float(36.6)
    const parsed = parseIeee11073Float(raw)
    expect(parsed).toBeCloseTo(36.6, 1)
  })

  test('FLOAT encodes tiny values (1e-10) without collapsing to 0', () => {
    const raw = encodeIeee11073Float(1e-10)
    const parsed = parseIeee11073Float(raw)
    expect(parsed).not.toBe(0)
    expect(parsed).toBeCloseTo(1e-10, 12)
  })

  test('FLOAT encodes large values (1e20)', () => {
    const raw = encodeIeee11073Float(1e20)
    const parsed = parseIeee11073Float(raw)
    expect(parsed).toBeCloseTo(1e20, -5)
  })

  test('FLOAT specials NaN / ±Infinity', () => {
    expect(Number.isNaN(parseIeee11073Float(encodeIeee11073Float(Number.NaN)))).toBe(true)
    expect(parseIeee11073Float(encodeIeee11073Float(Number.POSITIVE_INFINITY))).toBe(
      Number.POSITIVE_INFINITY
    )
    expect(parseIeee11073Float(encodeIeee11073Float(Number.NEGATIVE_INFINITY))).toBe(
      Number.NEGATIVE_INFINITY
    )
  })

  test('FLOAT NRes is classified distinctly from NaN', () => {
    // mantissa NRes, exp 0
    const raw = new Uint8Array([0x00, 0x00, 0x80, 0x00]) // 0x00800000 LE
    const d = decodeIeee11073Float(raw)
    expect(d.special).toBe('nres')
    expect(Number.isNaN(d.value)).toBe(true)
    // NaN mantissa
    const nanRaw = new Uint8Array([0xff, 0xff, 0x7f, 0x00])
    expect(decodeIeee11073Float(nanRaw).special).toBe('nan')
    // RFU
    const rfu = new Uint8Array([FLOAT_RFU_A & 0xff, (FLOAT_RFU_A >> 8) & 0xff, (FLOAT_RFU_A >> 16) & 0xff, 0])
    expect(decodeIeee11073Float(rfu).special).toBe('rfu')
  })

  test('FLOAT out-of-range encodes as NRes not NaN', () => {
    const raw = encodeIeee11073Float(1e300)
    expect(decodeIeee11073Float(raw).special).toBe('nres')
  })

  test('FLOAT rejects short buffer', () => {
    expect(() => parseIeee11073Float(new Uint8Array([1, 2, 3]))).toThrow(/4 bytes/)
  })

  test('SFLOAT integer and fractional round-trip', () => {
    for (const v of [0, 120, 80, 72, 100]) {
      expect(parseIeee11073Sfloat(encodeIeee11073Sfloat(v))).toBeCloseTo(v, 5)
    }
    expect(parseIeee11073Sfloat(encodeIeee11073Sfloat(72.5))).toBeCloseTo(72.5, 1)
  })

  test('SFLOAT specials and out-of-range → NRes', () => {
    expect(Number.isNaN(parseIeee11073Sfloat(encodeIeee11073Sfloat(Number.NaN)))).toBe(true)
    expect(parseIeee11073Sfloat(encodeIeee11073Sfloat(Number.POSITIVE_INFINITY))).toBe(
      Number.POSITIVE_INFINITY
    )
    const huge = encodeIeee11073Sfloat(1e20)
    expect(decodeIeee11073Sfloat(huge).special).toBe('nres')
    // RFU mantissa with exp 0 (little-endian UINT16)
    const rfuWire = new Uint8Array([SFLOAT_RFU_A & 0xff, (SFLOAT_RFU_A >> 8) & 0xff])
    expect(decodeIeee11073Sfloat(rfuWire).special).toBe('rfu')
  })

  test('SFLOAT rejects short buffer', () => {
    expect(() => parseIeee11073Sfloat(new Uint8Array([1]))).toThrow(/2 bytes/)
  })

  test('hand-built FLOAT little-endian mantissa/exponent', () => {
    // mantissa=366, exp=-1 → 36.6
    const m = 366
    const exp = (-1 + 256) & 0xff
    const raw = new Uint8Array([m & 0xff, (m >> 8) & 0xff, (m >> 16) & 0xff, exp])
    expect(parseIeee11073Float(raw)).toBeCloseTo(36.6, 5)
  })
})

describe('Battery Service', () => {
  test('UUID helpers + aliases', () => {
    expect(isBatteryService(BATTERY_SERVICE_UUID)).toBe(true)
    expect(isBatteryService('180f')).toBe(true)
    expect(isBatteryService('battery_service')).toBe(true)
    expect(isBatteryService('heart_rate')).toBe(false)
    expect(isBatteryLevel(BATTERY_LEVEL_UUID)).toBe(true)
    expect(isBatteryLevel('battery_level')).toBe(true)
    expect(isBatteryLevel('2a19')).toBe(true)
  })

  test('encode/parse 0–100; clamp; unknown >100; reject non-finite', () => {
    expect(parseBatteryLevel(encodeBatteryLevel(87))).toEqual({ level: 87, unknown: false })
    expect(parseBatteryLevel(encodeBatteryLevel(0)).level).toBe(0)
    expect(parseBatteryLevel(encodeBatteryLevel(100)).level).toBe(100)
    expect(parseBatteryLevel(encodeBatteryLevel(150)).level).toBe(100) // encode clamps
    expect(parseBatteryLevel(new Uint8Array([0xff]))).toEqual({ level: 255, unknown: true })
    expect(() => parseBatteryLevel(new Uint8Array([]))).toThrow(/too short/)
    expect(() => encodeBatteryLevel(NaN)).toThrow(/finite/)
    expect(() => encodeBatteryLevel(Infinity)).toThrow(/finite/)
    expect(() => encodeBatteryLevel(-Infinity)).toThrow(/finite/)
  })

  test('scan helpers', () => {
    // resolve expands + dedupes short+full from batteryScanServiceUUIDs()
    expect(resolveBatteryScanUUIDs(true)).toEqual([BATTERY_SERVICE_UUID])
    expect(batteryScanServiceUUIDs()).toEqual(expect.arrayContaining([BATTERY_SERVICE_UUID, '180f']))
    expect(resolveBatteryScanUUIDs(false)).toBe(null)
    expect(batteryRequestFilters({ namePrefix: 'Polar' }).every(f => f.namePrefix === 'Polar')).toBe(
      true
    )
  })

  test('FakeBlePort read Battery Level', async () => {
    const id = 'bat-1'
    const port = new FakeBlePort({
      advertisements: [{ id, name: 'BattDev', rssi: -40 }],
      services: {
        [id]: {
          [BATTERY_SERVICE_UUID]: {
            [BATTERY_LEVEL_UUID]: {
              value: encodeBatteryLevel(64),
              properties: { read: true }
            }
          }
        }
      }
    })
    const mgr = new PortBleManager({ port, host: 'fake' })
    await mgr.connectToDevice(id)
    await mgr.discoverAllServicesAndCharacteristicsForDevice(id)
    const snap = await mgr.readCharacteristicForDeviceAsBytes(
      id,
      BATTERY_SERVICE_UUID,
      BATTERY_LEVEL_UUID
    )
    expect(parseBatteryLevel(snap.value).level).toBe(64)
  })
})

describe('Device Information Service', () => {
  test('UUID helpers + string codec', () => {
    expect(isDeviceInformationService(DEVICE_INFORMATION_SERVICE_UUID)).toBe(true)
    expect(isDeviceInformationService('device_information')).toBe(true)
    expect(isManufacturerName(MANUFACTURER_NAME_UUID)).toBe(true)
    const enc = encodeDeviceInformationString('Polar Electro Oy')
    expect(parseDeviceInformationString(enc)).toBe('Polar Electro Oy')
    expect(decodeBleString(new Uint8Array([0x48, 0x31, 0x30, 0x00]))).toBe('H10')
  })

  test('assembleDeviceInformation from characteristic list', () => {
    const info = assembleDeviceInformation([
      { uuid: MANUFACTURER_NAME_UUID, value: encodeDeviceInformationString('Acme') },
      { uuid: MODEL_NUMBER_UUID, value: encodeDeviceInformationString('H10') },
      { uuid: FIRMWARE_REVISION_UUID, value: encodeDeviceInformationString('3.0.35') },
      { uuid: '00002a00-0000-1000-8000-00805f9b34fb', value: encodeDeviceInformationString('skip') }
    ])
    expect(info).toEqual({
      manufacturerName: 'Acme',
      modelNumber: 'H10',
      firmwareRevision: '3.0.35'
    })
  })

  test('optionalServices is service UUIDs/aliases only (not characteristic UUIDs)', () => {
    const o = deviceInformationOptionalServices()
    expect(o).toEqual(expect.arrayContaining([DEVICE_INFORMATION_SERVICE_ALIAS, DEVICE_INFORMATION_SERVICE_UUID]))
    expect(o).not.toContain(MANUFACTURER_NAME_UUID)
    expect(o).not.toContain(MODEL_NUMBER_UUID)
  })

  test('parse System ID LE→BE hex (SIG order) + encode round-trip', () => {
    // Wire LSO→MSO: manufacturer uint40 LE then OUI uint24 LE
    // Bytes 01 02 03 04 05 aa bb cc → manufacturer 0x0504030201, OUI 0xCCBBAA
    const sys = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0xaa, 0xbb, 0xcc])
    const sid = parseSystemId(sys)
    expect(sid.manufacturerId).toBe('0504030201')
    expect(sid.organizationallyUniqueId).toBe('ccbbaa')
    expect(Array.from(sid.raw)).toEqual([0x01, 0x02, 0x03, 0x04, 0x05, 0xaa, 0xbb, 0xcc])
    expect(() => parseSystemId(new Uint8Array([1, 2, 3]))).toThrow(/8 bytes/)

    // SIG system_id example: System ID 0x123456FFFE9ABCDE
    // wire LSO→MSO: DE BC 9A FE FF 56 34 12 → OUI 0x123456, manufacturer 0xFFFE9ABCDE
    const sigWire = new Uint8Array([0xde, 0xbc, 0x9a, 0xfe, 0xff, 0x56, 0x34, 0x12])
    const sig = parseSystemId(sigWire)
    expect(sig.organizationallyUniqueId).toBe('123456')
    expect(sig.manufacturerId).toBe('fffe9abcde')
    const encoded = encodeSystemId({
      manufacturerId: 'fffe9abcde',
      organizationallyUniqueId: '123456'
    })
    expect(Array.from(encoded)).toEqual(Array.from(sigWire))
    expect(Array.from(encodeSystemId({ manufacturerId: 0xfffe9abcde, organizationallyUniqueId: 0x123456 }))).toEqual(
      Array.from(sigWire)
    )
    // R3-F054: overflow fails closed (no silent truncate)
    expect(() =>
      encodeSystemId({ manufacturerId: 0x10000000000n, organizationallyUniqueId: 0x123456 })
    ).toThrow(/uint40|manufacturerId/)
    expect(() => encodeSystemId({ manufacturerId: 1, organizationallyUniqueId: 0x1000000 })).toThrow(
      /uint24|organizationallyUniqueId/
    )
    expect(() => encodeSystemId({ manufacturerId: -1, organizationallyUniqueId: 1 })).toThrow(/uint40|manufacturerId/)
  })

  test('isSystemId / isPnpId + PnP encode/parse', () => {
    expect(isSystemId(SYSTEM_ID_UUID)).toBe(true)
    expect(isSystemId('2a23')).toBe(true)
    expect(isSystemId('system_id')).toBe(true)
    expect(isSystemId(PNP_ID_UUID)).toBe(false)
    expect(isPnpId(PNP_ID_UUID)).toBe(true)
    expect(isPnpId('2a50')).toBe(true)
    expect(isPnpId('pnp_id')).toBe(true)
    expect(isPnpId(SYSTEM_ID_UUID)).toBe(false)

    const pnp = parsePnpId(
      encodePnpId({ vendorIdSource: 1, vendorId: 0x0078, productId: 0x1234, productVersion: 0x0100 })
    )
    expect(pnp.vendorIdSource).toBe(1)
    expect(pnp.vendorId).toBe(0x0078)
    expect(pnp.productId).toBe(0x1234)
    expect(pnp.productVersion).toBe(0x0100)
    expect(() => parsePnpId(new Uint8Array([1, 2]))).toThrow(/7 bytes/)
  })

  test('empty / null string edge cases', () => {
    expect(parseDeviceInformationString(null)).toBe('')
    expect(parseDeviceInformationString(new Uint8Array([]))).toBe('')
    expect(assembleDeviceInformation([])).toEqual({})
  })
})

describe('optionalServices service-only across profiles', () => {
  test('Battery / HT / BP optionalServices exclude characteristic UUIDs', () => {
    const bat = batteryOptionalServices()
    expect(bat).toEqual(expect.arrayContaining([BATTERY_SERVICE_ALIAS, BATTERY_SERVICE_UUID]))
    expect(bat).not.toContain(BATTERY_LEVEL_UUID)

    const ht = healthThermometerOptionalServices()
    expect(ht).toEqual(
      expect.arrayContaining([HEALTH_THERMOMETER_SERVICE_ALIAS, HEALTH_THERMOMETER_SERVICE_UUID])
    )
    expect(ht).not.toContain(TEMPERATURE_MEASUREMENT_UUID)

    const bp = bloodPressureOptionalServices()
    expect(bp).toEqual(
      expect.arrayContaining([BLOOD_PRESSURE_SERVICE_ALIAS, BLOOD_PRESSURE_SERVICE_UUID])
    )
    expect(bp).not.toContain(BLOOD_PRESSURE_MEASUREMENT_UUID)
  })
})

describe('Health Thermometer', () => {
  test('UUID helpers', () => {
    expect(isHealthThermometerService(HEALTH_THERMOMETER_SERVICE_UUID)).toBe(true)
    expect(isHealthThermometerService('health_thermometer')).toBe(true)
    expect(isTemperatureMeasurement(TEMPERATURE_MEASUREMENT_UUID)).toBe(true)
    expect(isTemperatureMeasurement('temperature_measurement')).toBe(true)
  })

  test('encode/parse Celsius with type', () => {
    const raw = encodeTemperatureMeasurement(36.6, {
      temperatureType: TemperatureType.Body
    })
    const p = parseTemperatureMeasurement(raw)
    expect(p.fahrenheit).toBe(false)
    expect(p.temperature).toBeCloseTo(36.6, 1)
    expect(p.temperatureSpecial).toBe(null)
    expect(p.temperatureType).toBe(TemperatureType.Body)
  })

  test('Fahrenheit + timestamp flags', () => {
    const ts = { year: 2026, month: 7, day: 25, hours: 12, minutes: 30, seconds: 0 }
    const raw = encodeTemperatureMeasurement(98.6, { fahrenheit: true, timestamp: ts })
    const p = parseTemperatureMeasurement(raw)
    expect(p.fahrenheit).toBe(true)
    expect(p.temperature).toBeCloseTo(98.6, 1)
    expect(p.temperatureSpecial).toBe(null)
    expect(p.timestamp).toEqual({
      ...ts,
      yearUnknown: false,
      monthUnknown: false,
      dayUnknown: false
    })
  })

  test('NRes FLOAT on wire is classified (not just NaN)', () => {
    // flags=0 + FLOAT NRes mantissa little-endian
    const nresFloat = encodeIeee11073Float(1e300) // out-of-range → NRes
    const raw = new Uint8Array([0x00, ...nresFloat])
    const p = parseTemperatureMeasurement(raw)
    expect(Number.isNaN(p.temperature)).toBe(true)
    expect(p.temperatureSpecial).toBe('nres')

    // Explicit NaN mantissa
    const nanMant = new Uint8Array([0xff, 0xff, 0x7f, 0x00]) // FLOAT_NAN
    const nanRaw = new Uint8Array([0x00, ...nanMant])
    const pn = parseTemperatureMeasurement(nanRaw)
    expect(Number.isNaN(pn.temperature)).toBe(true)
    expect(pn.temperatureSpecial).toBe('nan')
  })

  test('rejects truncated and missing optional fields', () => {
    expect(() => parseTemperatureMeasurement(new Uint8Array([0x00, 1, 2]))).toThrow(/too short/)
    // flag timestamp set but no bytes
    const short = new Uint8Array([0x02, 0, 0, 0, 0])
    expect(() => parseTemperatureMeasurement(short)).toThrow(/timestamp/)
    // flag type set but no byte
    const noType = new Uint8Array([0x04, 0, 0, 0, 0])
    expect(() => parseTemperatureMeasurement(noType)).toThrow(/temperature type/)
  })

  test('resolve scan toggle', () => {
    expect(resolveHealthThermometerScanUUIDs(false)).toBe(null)
    expect(resolveHealthThermometerScanUUIDs(true)).toContain(HEALTH_THERMOMETER_SERVICE_UUID)
  })
})

describe('Blood Pressure', () => {
  test('UUID helpers', () => {
    expect(isBloodPressureService(BLOOD_PRESSURE_SERVICE_UUID)).toBe(true)
    expect(isBloodPressureService('blood_pressure')).toBe(true)
    expect(isBloodPressureService('1810')).toBe(true)
    expect(isBloodPressureMeasurement(BLOOD_PRESSURE_MEASUREMENT_UUID)).toBe(true)
    expect(bloodPressureScanServiceUUIDs()).toContain('1810')
  })

  test('encode/parse mmHg + pulse + user', () => {
    const raw = encodeBloodPressureMeasurement(120, 80, 93, {
      pulseRate: 72,
      userId: 1,
      measurementStatus: 0
    })
    const p = parseBloodPressureMeasurement(raw)
    expect(p.kilopascal).toBe(false)
    expect(p.systolic).toBeCloseTo(120, 0)
    expect(p.diastolic).toBeCloseTo(80, 0)
    expect(p.meanArterialPressure).toBeCloseTo(93, 0)
    expect(p.systolicSpecial).toBe(null)
    expect(p.diastolicSpecial).toBe(null)
    expect(p.meanArterialPressureSpecial).toBe(null)
    expect(p.pulseRate).toBeCloseTo(72, 0)
    expect(p.pulseRateSpecial).toBe(null)
    expect(p.userId).toBe(1)
    expect(p.userIdUnknown).toBe(false)
    expect(p.measurementStatus).toBe(0)
  })

  test('userId 0xFF is Unknown User (userIdUnknown)', () => {
    const raw = encodeBloodPressureMeasurement(118, 76, 90, { userId: 0xff })
    const p = parseBloodPressureMeasurement(raw)
    expect(p.userId).toBe(255)
    expect(p.userIdUnknown).toBe(true)
    // No user flag → fields omitted
    const noUser = parseBloodPressureMeasurement(encodeBloodPressureMeasurement(120, 80, 93))
    expect(noUser.userId).toBeUndefined()
    expect(noUser.userIdUnknown).toBeUndefined()
  })

  test('kPa unit flag + timestamp', () => {
    const ts = { year: 2026, month: 1, day: 2, hours: 3, minutes: 4, seconds: 5 }
    const raw = encodeBloodPressureMeasurement(16, 10.7, 12.3, {
      kilopascal: true,
      timestamp: ts
    })
    const p = parseBloodPressureMeasurement(raw)
    expect(p.kilopascal).toBe(true)
    expect(p.systolic).toBeCloseTo(16, 1)
    expect(p.timestamp).toEqual({
      ...ts,
      yearUnknown: false,
      monthUnknown: false,
      dayUnknown: false
    })
  })

  test('SFLOAT NRes on systolic is classified', () => {
    // flags=0 + 3× SFLOAT: systolic NRes, diastolic/MAP normal 80/93
    const nres = encodeIeee11073Sfloat(1e20) // out-of-range → NRes
    expect(decodeIeee11073Sfloat(nres).special).toBe('nres')
    const dia = encodeIeee11073Sfloat(80)
    const map = encodeIeee11073Sfloat(93)
    const raw = new Uint8Array([0x00, ...nres, ...dia, ...map])
    const p = parseBloodPressureMeasurement(raw)
    expect(p.systolicSpecial).toBe('nres')
    expect(Number.isNaN(p.systolic)).toBe(true)
    expect(p.diastolicSpecial).toBe(null)
    expect(p.diastolic).toBeCloseTo(80, 0)
    // Explicit SFLOAT NRES mantissa wire
    const nresWire = new Uint8Array([SFLOAT_NRES & 0xff, (SFLOAT_NRES >> 8) & 0xff])
    const raw2 = new Uint8Array([0x00, ...nresWire, ...dia, ...map])
    expect(parseBloodPressureMeasurement(raw2).systolicSpecial).toBe('nres')
  })

  test('edge: truncated payloads', () => {
    expect(() => parseBloodPressureMeasurement(new Uint8Array([0]))).toThrow(/too short/)
    // flags claim pulse but no SFLOAT
    const noPulse = new Uint8Array([0x04, 0, 0, 0, 0, 0, 0])
    expect(() => parseBloodPressureMeasurement(noPulse)).toThrow(/pulse rate/)
  })
})

describe('Multi-profile FakeBlePort (Polar-like + clinical devices)', () => {
  beforeEach(() => {
    useFakeTimers()
  })
  afterEach(() => {
    useRealTimers()
  })

  test('scan filter by battery service sees only battery advertiser services tree', async () => {
    const polar = 'polar-full'
    const thermo = 'thermo-1'
    const bp = 'bp-1'
    const port = new FakeBlePort({
      advertisements: [
        { id: polar, name: 'Polar H10', rssi: -50 },
        { id: thermo, name: 'Thermo', rssi: -55 },
        { id: bp, name: 'BP Cuff', rssi: -60 }
      ],
      services: {
        [polar]: {
          [HR_SERVICE_UUID]: {
            [HR_MEASUREMENT_UUID]: {
              value: encodeHeartRateMeasurement(70),
              properties: { notify: true, read: true }
            }
          },
          [BATTERY_SERVICE_UUID]: {
            [BATTERY_LEVEL_UUID]: {
              value: encodeBatteryLevel(81),
              properties: { read: true }
            }
          },
          [DEVICE_INFORMATION_SERVICE_UUID]: {
            [MANUFACTURER_NAME_UUID]: {
              value: encodeDeviceInformationString('Polar Electro Oy'),
              properties: { read: true }
            },
            [MODEL_NUMBER_UUID]: {
              value: encodeDeviceInformationString('H10'),
              properties: { read: true }
            }
          }
        },
        [thermo]: {
          [HEALTH_THERMOMETER_SERVICE_UUID]: {
            [TEMPERATURE_MEASUREMENT_UUID]: {
              value: encodeTemperatureMeasurement(37.0, { temperatureType: TemperatureType.Body }),
              // notify+indicate: clinical profiles use indicate; notify keeps isNotifiable true on Fake seed
              properties: { indicate: true, notify: true, read: true }
            }
          }
        },
        [bp]: {
          [BLOOD_PRESSURE_SERVICE_UUID]: {
            [BLOOD_PRESSURE_MEASUREMENT_UUID]: {
              value: encodeBloodPressureMeasurement(118, 76, 90, { pulseRate: 68 }),
              properties: { indicate: true, notify: true, read: true }
            }
          }
        }
      }
    })
    const mgr = new PortBleManager({ port, host: 'fake' })

    // HT-only scan
    const seenHt = []
    await mgr.startDeviceScan(resolveHealthThermometerScanUUIDs(true), null, (e, d) => {
      if (d) seenHt.push(d.id)
    })
    await flush()
    await mgr.stopDeviceScan()
    expect(seenHt).toContain(thermo)
    expect(seenHt).not.toContain(polar)
    expect(seenHt).not.toContain(bp)

    // Connect polar and parse battery + DIS
    await mgr.connectToDevice(polar)
    await mgr.discoverAllServicesAndCharacteristicsForDevice(polar)
    const bat = await mgr.readCharacteristicForDeviceAsBytes(
      polar,
      BATTERY_SERVICE_UUID,
      BATTERY_LEVEL_UUID
    )
    expect(parseBatteryLevel(bat.value).level).toBe(81)
    const mfg = await mgr.readCharacteristicForDeviceAsBytes(
      polar,
      DEVICE_INFORMATION_SERVICE_UUID,
      MANUFACTURER_NAME_UUID
    )
    expect(parseDeviceInformationString(mfg.value)).toMatch(/Polar/)

    // Thermo + BP reads
    await mgr.connectToDevice(thermo)
    await mgr.discoverAllServicesAndCharacteristicsForDevice(thermo)
    const tChars = await port.discoverCharacteristics(thermo, HEALTH_THERMOMETER_SERVICE_UUID)
    const tMeta = tChars.find(c => c.uuid === TEMPERATURE_MEASUREMENT_UUID || c.uuid.toLowerCase() === TEMPERATURE_MEASUREMENT_UUID.toLowerCase())
    expect(tMeta).toBeTruthy()
    expect(tMeta.isNotifiable).toBe(true)

    const tSnap = await mgr.readCharacteristicForDeviceAsBytes(
      thermo,
      HEALTH_THERMOMETER_SERVICE_UUID,
      TEMPERATURE_MEASUREMENT_UUID
    )
    expect(parseTemperatureMeasurement(tSnap.value).temperature).toBeCloseTo(37, 1)

    // HT indicate/notify path: monitor + emitNotification parses Temperature payload
    const htNotes = []
    const htSub = mgr.monitorCharacteristicForDeviceAsBytes(
      thermo,
      HEALTH_THERMOMETER_SERVICE_UUID,
      TEMPERATURE_MEASUREMENT_UUID,
      (err, c) => {
        if (c?.value) htNotes.push(parseTemperatureMeasurement(c.value))
      }
    )
    await flush()
    const htNotifyBytes = encodeTemperatureMeasurement(36.5, { temperatureType: TemperatureType.Body })
    await port.emitNotification(
      thermo,
      HEALTH_THERMOMETER_SERVICE_UUID,
      TEMPERATURE_MEASUREMENT_UUID,
      htNotifyBytes
    )
    await flush()
    expect(htNotes.length).toBe(1)
    expect(htNotes[0].temperature).toBeCloseTo(36.5, 1)
    htSub.remove()

    await mgr.connectToDevice(bp)
    await mgr.discoverAllServicesAndCharacteristicsForDevice(bp)
    const bpChars = await port.discoverCharacteristics(bp, BLOOD_PRESSURE_SERVICE_UUID)
    const bpMeta = bpChars.find(
      c => c.uuid === BLOOD_PRESSURE_MEASUREMENT_UUID || c.uuid.toLowerCase() === BLOOD_PRESSURE_MEASUREMENT_UUID.toLowerCase()
    )
    expect(bpMeta).toBeTruthy()
    expect(bpMeta.isNotifiable).toBe(true)

    const bpSnap = await mgr.readCharacteristicForDeviceAsBytes(
      bp,
      BLOOD_PRESSURE_SERVICE_UUID,
      BLOOD_PRESSURE_MEASUREMENT_UUID
    )
    const bpm = parseBloodPressureMeasurement(bpSnap.value)
    expect(bpm.systolic).toBeCloseTo(118, 0)
    expect(bpm.diastolic).toBeCloseTo(76, 0)

    // BP indicate/notify path
    const bpNotes = []
    const bpSub = mgr.monitorCharacteristicForDeviceAsBytes(
      bp,
      BLOOD_PRESSURE_SERVICE_UUID,
      BLOOD_PRESSURE_MEASUREMENT_UUID,
      (err, c) => {
        if (c?.value) bpNotes.push(parseBloodPressureMeasurement(c.value))
      }
    )
    await flush()
    await port.emitNotification(
      bp,
      BLOOD_PRESSURE_SERVICE_UUID,
      BLOOD_PRESSURE_MEASUREMENT_UUID,
      encodeBloodPressureMeasurement(120, 80, 93, { pulseRate: 70 })
    )
    await flush()
    expect(bpNotes.length).toBe(1)
    expect(bpNotes[0].systolic).toBeCloseTo(120, 0)
    expect(bpNotes[0].diastolic).toBeCloseTo(80, 0)
    bpSub.remove()
  })

  test('BleTimestamp marks year/month/day 0 as unknown (R3-F021)', () => {
    const { parseBleTimestamp, appendBleTimestamp } = require('../src/profiles/types')
    const bytes = new Uint8Array(7)
    // year=0, month=0, day=0, h/m/s = 12:30:45
    bytes[0] = 0
    bytes[1] = 0
    bytes[2] = 0
    bytes[3] = 0
    bytes[4] = 12
    bytes[5] = 30
    bytes[6] = 45
    const { ts } = parseBleTimestamp(bytes, 0)
    expect(ts.year).toBe(0)
    expect(ts.month).toBe(0)
    expect(ts.day).toBe(0)
    expect(ts.yearUnknown).toBe(true)
    expect(ts.monthUnknown).toBe(true)
    expect(ts.dayUnknown).toBe(true)
    expect(ts.hours).toBe(12)

    const known = parseBleTimestamp(
      (() => {
        const out = []
        appendBleTimestamp(out, {
          year: 2026,
          month: 7,
          day: 25,
          hours: 1,
          minutes: 2,
          seconds: 3
        })
        return new Uint8Array(out)
      })(),
      0
    ).ts
    expect(known.yearUnknown).toBe(false)
    expect(known.monthUnknown).toBe(false)
    expect(known.dayUnknown).toBe(false)
    expect(known.year).toBe(2026)
  })

  test('SFLOAT encode avoids reserved mantissas near specials (R3-F055)', () => {
    // Values whose exp=0 mantissa is reserved must not mis-encode as coarser wrong values
    for (const v of [2044, 2045, 2046, 2047, -2045, -2046, -2047, -2048]) {
      const encoded = encodeIeee11073Sfloat(v)
      const decoded = parseIeee11073Sfloat(encoded)
      if (Number.isNaN(decoded)) {
        // NRes is acceptable fail-closed for unrepresentable reserved neighborhood
        continue
      }
      // Prefer accurate alternate representation over large error (e.g. 2047→2050)
      expect(Math.abs(decoded - v)).toBeLessThanOrEqual(4)
    }
    // Classic health range still exact
    for (const v of [0, 72, 80, 120, 100]) {
      expect(parseIeee11073Sfloat(encodeIeee11073Sfloat(v))).toBe(v)
    }
  })

})
