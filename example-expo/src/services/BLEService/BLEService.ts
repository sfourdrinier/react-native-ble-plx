import {
  BleError,
  BleErrorCode,
  BleManager,
  Device,
  State as BluetoothState,
  LogLevel,
  resolveHeartRateScanUUIDs,
  resolveBatteryScanUUIDs,
  resolveHealthThermometerScanUUIDs,
  resolveBloodPressureScanUUIDs,
  parseBatteryLevel,
  assembleDeviceInformation,
  parseTemperatureMeasurement,
  parseBloodPressureMeasurement,
  isBatteryService,
  isBatteryLevel,
  isDeviceInformationService,
  isHealthThermometerService,
  isTemperatureMeasurement,
  isBloodPressureService,
  isBloodPressureMeasurement,
  type DeviceId,
  type TransactionId,
  type UUID,
  type Characteristic,
  type Base64,
  type Subscription,
  type DeviceInformationStrings,
  type TemperatureMeasurement,
  type BloodPressureMeasurement
} from 'unified-ble-manager'
import { Platform } from 'react-native'
import Toast from 'react-native-toast-message'

const deviceNotConnectedErrorText = 'Device is not connected'

/** iOS restore identifier — keep in sync with bare example + Expo plugin config when enabled. */
const IOS_RESTORE_ID = 'com.intent.BlePlxExample.restore'

class BLEServiceInstance {
  manager: BleManager

  device: Device | null

  characteristicMonitor: Subscription | null

  isCharacteristicMonitorDisconnectExpected = false

  constructor() {
    this.device = null
    this.characteristicMonitor = null
    // First construct wins (singleton). On iOS, enable restore handoff for getRestoredState demo.
    this.manager = new BleManager(
      Platform.OS === 'ios'
        ? {
            restoreStateIdentifier: IOS_RESTORE_ID,
            restoreStateFunction: restoredState => {
              console.log(
                '[BLE restore callback]',
                restoredState?.connectedPeripherals?.map(d => d.id) ?? null
              )
            }
          }
        : {}
    )
    this.manager.setLogLevel(LogLevel.Verbose)
    if (Platform.OS === 'ios') {
      void this.manager.getRestoredState().then(restoredState => {
        console.log(
          '[BLE getRestoredState]',
          restoredState?.connectedPeripherals?.map(d => d.id) ?? null
        )
      })
    }
  }

  createNewManager = () => {
    void this.manager.destroy().finally(() => {
      this.manager = new BleManager(
        Platform.OS === 'ios' ? { restoreStateIdentifier: IOS_RESTORE_ID } : {}
      )
      this.manager.setLogLevel(LogLevel.Verbose)
    })
  }

  getDevice = () => this.device

  initializeBLE = () =>
    new Promise<void>(resolve => {
      const subscription = this.manager.onStateChange(state => {
        switch (state) {
          case BluetoothState.Unsupported:
            this.showErrorToast('')
            break
          case BluetoothState.PoweredOff:
            this.onBluetoothPowerOff()
            break
          case BluetoothState.Unauthorized:
            this.requestBluetoothPermission()
            break
          case BluetoothState.PoweredOn:
            resolve()
            subscription.remove()
            break
          default:
            console.error('Unsupported state: ', state)
          // resolve()
          // subscription.remove()
        }
      }, true)
    })

  disconnectDevice = () => {
    if (!this.device) {
      this.showErrorToast(deviceNotConnectedErrorText)
      throw new Error(deviceNotConnectedErrorText)
    }
    return this.manager
      .cancelDeviceConnection(this.device.id)
      .then(() => this.showSuccessToast('Device disconnected'))
      .catch(error => {
        // R3-F033: BleError exposes errorCode (not code)
        if (error?.errorCode !== BleErrorCode.DeviceDisconnected) {
          this.onError(error)
        }
      })
  }

  disconnectDeviceById = (id: DeviceId) =>
    this.manager
      .cancelDeviceConnection(id)
      .then(() => this.showSuccessToast('Device disconnected'))
      .catch(error => {
        // R3-F033: BleError exposes errorCode (not code)
        if (error?.errorCode !== BleErrorCode.DeviceDisconnected) {
          this.onError(error)
        }
      })

  onBluetoothPowerOff = () => {
    this.showErrorToast('Bluetooth is turned off')
  }

  scanDevices = async (onDeviceFound: (device: Device) => void, UUIDs: UUID[] | null = null, legacyScan?: boolean) => {
    this.manager
      .startDeviceScan(UUIDs, { legacyScan }, (error, device) => {
        if (error) {
          this.onError(error)
          console.error(error.message)
          this.manager.stopDeviceScan()
          return
        }
        if (device) {
          onDeviceFound(device)
        }
      })
      .then(() => {})
      .catch(console.error)
  }

  stopDeviceScan = () => {
    this.manager.stopDeviceScan()
  }

  /**
   * Thin wrappers over package `resolve*ScanUUIDs` helpers (same filters as shared centralDemo).
   */
  scanForHeartRateDevices = async (
    onDeviceFound: (device: Device) => void,
    heartRateOnly: boolean = true,
    legacyScan?: boolean
  ) => this.scanDevices(onDeviceFound, resolveHeartRateScanUUIDs(heartRateOnly), legacyScan)

  scanForBatteryDevices = async (
    onDeviceFound: (device: Device) => void,
    batteryOnly: boolean = true,
    legacyScan?: boolean
  ) => this.scanDevices(onDeviceFound, resolveBatteryScanUUIDs(batteryOnly), legacyScan)

  scanForHealthThermometerDevices = async (
    onDeviceFound: (device: Device) => void,
    only: boolean = true,
    legacyScan?: boolean
  ) => this.scanDevices(onDeviceFound, resolveHealthThermometerScanUUIDs(only), legacyScan)

  scanForBloodPressureDevices = async (
    onDeviceFound: (device: Device) => void,
    only: boolean = true,
    legacyScan?: boolean
  ) => this.scanDevices(onDeviceFound, resolveBloodPressureScanUUIDs(only), legacyScan)

  /**
   * Read common SIG profile payloads (Battery, DIS, HT, BP) using package parse helpers.
   * HT/BP are often indicate-only — skip when `isReadable === false` before attempting a read
   * (parity with example-shared/readCommonProfiles + bare example, R2-F062/R2-F067).
   */
  readCommonProfiles = async (): Promise<{
    battery: { level: number; unknown: boolean } | { skipped: true; reason: string } | null
    deviceInformation: DeviceInformationStrings | null
    temperature: TemperatureMeasurement | { skipped: true; reason: string } | null
    bloodPressure: BloodPressureMeasurement | { skipped: true; reason: string } | null
  }> => {
    if (!this.device) {
      throw new Error(deviceNotConnectedErrorText)
    }
    const deviceId = this.device.id
    const services = await this.manager.servicesForDevice(deviceId)
    const out: {
      battery: { level: number; unknown: boolean } | { skipped: true; reason: string } | null
      deviceInformation: DeviceInformationStrings | null
      temperature: TemperatureMeasurement | { skipped: true; reason: string } | null
      bloodPressure: BloodPressureMeasurement | { skipped: true; reason: string } | null
    } = {
      battery: null,
      deviceInformation: null,
      temperature: null,
      bloodPressure: null
    }

    const tryRead = async (
      serviceUUID: UUID,
      charUUID: UUID,
      label: string,
      meta?: { isReadable?: boolean }
    ) => {
      // Shared gate with example-shared/readCommonProfiles (indicate-only)
      if (meta && meta.isReadable === false) {
        return {
          ok: false as const,
          reason: `${label}: not readable (indicate/notify-only; subscribe for live data)`
        }
      }
      try {
        const snap = await this.manager.readCharacteristicForDeviceAsBytes(deviceId, serviceUUID, charUUID)
        if (snap?.value && (snap.value.byteLength > 0 || (snap.value as Uint8Array).length > 0)) {
          return { ok: true as const, value: snap.value }
        }
        return { ok: false as const, reason: `${label}: empty (often indicate-only)` }
      } catch (e) {
        return {
          ok: false as const,
          reason: `${label}: ${e instanceof Error ? e.message : String(e)} (often indicate-only)`
        }
      }
    }

    const batSvc = services.find(s => isBatteryService(s.uuid))
    if (batSvc) {
      try {
        const chars = await this.manager.characteristicsForDevice(deviceId, batSvc.uuid)
        const level = chars.find(c => isBatteryLevel(c.uuid))
        if (level) {
          const r = await tryRead(batSvc.uuid, level.uuid, 'Battery Level', level)
          out.battery = r.ok ? parseBatteryLevel(r.value) : { skipped: true, reason: r.reason }
        }
      } catch (e) {
        console.warn('battery read', e)
      }
    }

    const disSvc = services.find(s => isDeviceInformationService(s.uuid))
    if (disSvc) {
      try {
        const chars = await this.manager.characteristicsForDevice(deviceId, disSvc.uuid)
        const snaps: { uuid: string; value: Uint8Array }[] = []
        for (const c of chars) {
          const r = await tryRead(disSvc.uuid, c.uuid, 'DIS', c)
          if (r.ok) snaps.push({ uuid: c.uuid, value: r.value })
        }
        out.deviceInformation = assembleDeviceInformation(snaps)
      } catch (e) {
        console.warn('DIS read', e)
      }
    }

    const htSvc = services.find(s => isHealthThermometerService(s.uuid))
    if (htSvc) {
      try {
        const chars = await this.manager.characteristicsForDevice(deviceId, htSvc.uuid)
        const meas = chars.find(c => isTemperatureMeasurement(c.uuid))
        if (meas) {
          const r = await tryRead(htSvc.uuid, meas.uuid, 'Temperature Measurement', meas)
          out.temperature = r.ok
            ? parseTemperatureMeasurement(r.value)
            : { skipped: true, reason: r.reason }
        }
      } catch (e) {
        console.warn('HT read', e)
      }
    }

    const bpSvc = services.find(s => isBloodPressureService(s.uuid))
    if (bpSvc) {
      try {
        const chars = await this.manager.characteristicsForDevice(deviceId, bpSvc.uuid)
        const meas = chars.find(c => isBloodPressureMeasurement(c.uuid))
        if (meas) {
          const r = await tryRead(bpSvc.uuid, meas.uuid, 'Blood Pressure Measurement', meas)
          out.bloodPressure = r.ok
            ? parseBloodPressureMeasurement(r.value)
            : { skipped: true, reason: r.reason }
        }
      } catch (e) {
        console.warn('BP read', e)
      }
    }

    return out
  }

  /** Parity with bare example: optional timeout + ignoreError (R2-F067). */
  connectToDevice = (deviceId: DeviceId, timeout?: number, ignoreError = false) =>
    new Promise<Device>((resolve, reject) => {
      this.manager.stopDeviceScan()
      this.manager
        .connectToDevice(deviceId, { timeout })
        .then(device => {
          this.device = device
          resolve(device)
        })
        .catch(error => {
          if (error.errorCode === BleErrorCode.DeviceAlreadyConnected && this.device) {
            resolve(this.device)
          } else {
            if (!ignoreError) {
              this.onError(error)
            }
            reject(error)
          }
        })
    })

  discoverAllServicesAndCharacteristicsForDevice = async () =>
    new Promise<Device>((resolve, reject) => {
      if (!this.device) {
        this.showErrorToast(deviceNotConnectedErrorText)
        reject(new Error(deviceNotConnectedErrorText))
        return
      }
      this.manager
        .discoverAllServicesAndCharacteristicsForDevice(this.device.id)
        .then(device => {
          resolve(device)
          this.device = device
        })
        .catch(error => {
          this.onError(error)
          reject(error)
        })
    })

  readCharacteristicForDevice = async (serviceUUID: UUID, characteristicUUID: UUID) =>
    new Promise<Characteristic>((resolve, reject) => {
      if (!this.device) {
        this.showErrorToast(deviceNotConnectedErrorText)
        reject(new Error(deviceNotConnectedErrorText))
        return
      }
      this.manager
        .readCharacteristicForDevice(this.device.id, serviceUUID, characteristicUUID)
        .then(characteristic => {
          resolve(characteristic)
        })
        .catch(error => {
          // R2-F064: must reject so awaiters do not hang forever
          this.onError(error)
          reject(error)
        })
    })

  writeCharacteristicWithResponseForDevice = async (serviceUUID: UUID, characteristicUUID: UUID, time: Base64) => {
    if (!this.device) {
      this.showErrorToast(deviceNotConnectedErrorText)
      throw new Error(deviceNotConnectedErrorText)
    }
    return this.manager
      .writeCharacteristicWithResponseForDevice(this.device.id, serviceUUID, characteristicUUID, time)
      .catch(error => {
        this.onError(error)
        throw error
      })
  }

  writeCharacteristicWithoutResponseForDevice = async (serviceUUID: UUID, characteristicUUID: UUID, time: Base64) => {
    if (!this.device) {
      this.showErrorToast(deviceNotConnectedErrorText)
      throw new Error(deviceNotConnectedErrorText)
    }
    return this.manager
      .writeCharacteristicWithoutResponseForDevice(this.device.id, serviceUUID, characteristicUUID, time)
      .catch(error => {
        this.onError(error)
        throw error
      })
  }

  setupMonitor = (
    serviceUUID: UUID,
    characteristicUUID: UUID,
    onCharacteristicReceived: (characteristic: Characteristic) => void,
    onError: (error: Error) => void,
    transactionId?: TransactionId,
    hideErrorDisplay?: boolean
  ) => {
    if (!this.device) {
      this.showErrorToast(deviceNotConnectedErrorText)
      throw new Error(deviceNotConnectedErrorText)
    }
    this.characteristicMonitor = this.manager.monitorCharacteristicForDevice(
      this.device?.id,
      serviceUUID,
      characteristicUUID,
      (error, characteristic) => {
        if (error) {
          if (
            error.errorCode === BleErrorCode.OperationCancelled &&
            this.isCharacteristicMonitorDisconnectExpected
          ) {
            this.isCharacteristicMonitorDisconnectExpected = false
            return
          }
          onError(error)
          if (!hideErrorDisplay) {
            this.onError(error)
            this.characteristicMonitor?.remove()
          }
          return
        }
        if (characteristic) {
          onCharacteristicReceived(characteristic)
        }
      },
      transactionId
    )
  }

  setupCustomMonitor: BleManager['monitorCharacteristicForDevice'] = (...args) =>
    this.manager.monitorCharacteristicForDevice(...args)

  finishMonitor = () => {
    this.isCharacteristicMonitorDisconnectExpected = true
    this.characteristicMonitor?.remove()
  }

  writeDescriptorForDevice = async (
    serviceUUID: UUID,
    characteristicUUID: UUID,
    descriptorUUID: UUID,
    data: Base64
  ) => {
    if (!this.device) {
      this.showErrorToast(deviceNotConnectedErrorText)
      throw new Error(deviceNotConnectedErrorText)
    }
    return this.manager
      .writeDescriptorForDevice(this.device.id, serviceUUID, characteristicUUID, descriptorUUID, data)
      .catch(error => {
        this.onError(error)
        throw error
      })
  }

  readDescriptorForDevice = async (serviceUUID: UUID, characteristicUUID: UUID, descriptorUUID: UUID) => {
    if (!this.device) {
      this.showErrorToast(deviceNotConnectedErrorText)
      throw new Error(deviceNotConnectedErrorText)
    }
    return this.manager
      .readDescriptorForDevice(this.device.id, serviceUUID, characteristicUUID, descriptorUUID)
      .catch(error => {
        this.onError(error)
        throw error
      })
  }

  getServicesForDevice = () => {
    if (!this.device) {
      this.showErrorToast(deviceNotConnectedErrorText)
      throw new Error(deviceNotConnectedErrorText)
    }
    // R3-F034: rethrow after onError so callers are not left with silent undefined
    return this.manager.servicesForDevice(this.device.id).catch(error => {
      this.onError(error)
      throw error
    })
  }

  getCharacteristicsForDevice = (serviceUUID: UUID) => {
    if (!this.device) {
      this.showErrorToast(deviceNotConnectedErrorText)
      throw new Error(deviceNotConnectedErrorText)
    }
    return this.manager.characteristicsForDevice(this.device.id, serviceUUID).catch(error => {
      this.onError(error)
      throw error
    })
  }

  getDescriptorsForDevice = (serviceUUID: UUID, characteristicUUID: UUID) => {
    if (!this.device) {
      this.showErrorToast(deviceNotConnectedErrorText)
      throw new Error(deviceNotConnectedErrorText)
    }
    return this.manager.descriptorsForDevice(this.device.id, serviceUUID, characteristicUUID).catch(error => {
      this.onError(error)
      throw error
    })
  }

  isDeviceConnected = () => {
    if (!this.device) {
      this.showErrorToast(deviceNotConnectedErrorText)
      throw new Error(deviceNotConnectedErrorText)
    }
    return this.manager.isDeviceConnected(this.device.id)
  }

  isDeviceWithIdConnected = (id: DeviceId) => this.manager.isDeviceConnected(id).catch(console.error)

  getConnectedDevices = (expectedServices: UUID[]) => {
    if (!this.device) {
      this.showErrorToast(deviceNotConnectedErrorText)
      throw new Error(deviceNotConnectedErrorText)
    }
    return this.manager.connectedDevices(expectedServices).catch(error => {
      this.onError(error)
      throw error
    })
  }

  requestMTUForDevice = (mtu: number) => {
    if (!this.device) {
      this.showErrorToast(deviceNotConnectedErrorText)
      throw new Error(deviceNotConnectedErrorText)
    }
    return this.manager.requestMTUForDevice(this.device.id, mtu).catch(error => {
      this.onError(error)
      throw error
    })
  }

  onDeviceDisconnected = (listener: (error: BleError | null, device: Device | null) => void) => {
    if (!this.device) {
      this.showErrorToast(deviceNotConnectedErrorText)
      throw new Error(deviceNotConnectedErrorText)
    }
    return this.manager.onDeviceDisconnected(this.device.id, listener)
  }

  onDeviceDisconnectedCustom: BleManager['onDeviceDisconnected'] = (...args) =>
    this.manager.onDeviceDisconnected(...args)

  readRSSIForDevice = () => {
    if (!this.device) {
      this.showErrorToast(deviceNotConnectedErrorText)
      throw new Error(deviceNotConnectedErrorText)
    }
    return this.manager.readRSSIForDevice(this.device.id).catch(error => {
      this.onError(error)
      throw error
    })
  }

  getDevices = () => {
    if (!this.device) {
      this.showErrorToast(deviceNotConnectedErrorText)
      throw new Error(deviceNotConnectedErrorText)
    }
    return this.manager.devices([this.device.id]).catch(error => {
      this.onError(error)
      throw error
    })
  }

  cancelTransaction = (transactionId: TransactionId) => this.manager.cancelTransaction(transactionId)

  getState = () =>
    this.manager.state().catch(error => {
      this.onError(error)
      throw error
    })

  onError = (error: BleError) => {
    switch (error.errorCode) {
      case BleErrorCode.BluetoothUnauthorized:
        this.requestBluetoothPermission()
        break
      case BleErrorCode.LocationServicesDisabled:
        this.showErrorToast('Location services are disabled')
        break
      default:
        this.showErrorToast(JSON.stringify(error, null, 4))
    }
  }

  requestConnectionPriorityForDevice = (priority: 0 | 1 | 2) => {
    if (!this.device) {
      this.showErrorToast(deviceNotConnectedErrorText)
      throw new Error(deviceNotConnectedErrorText)
    }
    return this.manager.requestConnectionPriorityForDevice(this.device?.id, priority)
  }

  cancelDeviceConnection = () => {
    if (!this.device) {
      this.showErrorToast(deviceNotConnectedErrorText)
      throw new Error(deviceNotConnectedErrorText)
    }
    return this.manager.cancelDeviceConnection(this.device?.id)
  }

  /** Thin UX wrapper over package `requestBluetoothPermissions` (Android 12+ / legacy). */
  requestBluetoothPermission = async () => {
    const result = await this.manager.requestBluetoothPermissions()
    if (!result.granted) {
      this.showErrorToast(result.detail || 'Bluetooth permissions have not been granted')
    }
    return result.granted
  }

  showErrorToast = (error: string) => {
    Toast.show({
      type: 'error',
      text1: 'Error',
      text2: error
    })
    console.error(error)
  }

  showSuccessToast = (info: string) => {
    Toast.show({
      type: 'success',
      text1: 'Success',
      text2: info
    })
  }
}

export const BLEService = new BLEServiceInstance()
