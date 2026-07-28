// example/src/services/BLEService/BLEService.ts

import { Platform } from 'react-native'
import {
  canonicalUuid,
  capacity,
  type AdvertisementObservation,
  type Connection,
  type DiscoveredGattDatabase,
  type PeerId,
  type ScanSession,
  type Subscription,
  type Uuid
} from 'unified-ble-manager'
import { createReactNativeBleManager, getNativeUnifiedBleProtocolControl } from 'unified-ble-manager/react-native'
import {
  BATTERY_LEVEL_CHARACTERISTIC,
  BATTERY_SERVICE,
  parseBatteryLevel
} from 'unified-ble-manager/profiles/battery-service'
import {
  BLOOD_PRESSURE_MEASUREMENT_CHARACTERISTIC,
  BLOOD_PRESSURE_SERVICE,
  parseBloodPressureMeasurement,
  type BloodPressureMeasurement
} from 'unified-ble-manager/profiles/blood-pressure'
import {
  decodeDeviceInformationString,
  DEVICE_INFORMATION_SERVICE,
  FIRMWARE_REVISION_CHARACTERISTIC,
  HARDWARE_REVISION_CHARACTERISTIC,
  MANUFACTURER_NAME_CHARACTERISTIC,
  MODEL_NUMBER_CHARACTERISTIC,
  SERIAL_NUMBER_CHARACTERISTIC,
  SOFTWARE_REVISION_CHARACTERISTIC,
  type DeviceInformationStringField
} from 'unified-ble-manager/profiles/device-information'
import {
  HEALTH_THERMOMETER_SERVICE,
  parseTemperatureMeasurement,
  TEMPERATURE_MEASUREMENT_CHARACTERISTIC,
  type TemperatureMeasurement
} from 'unified-ble-manager/profiles/health-thermometer'

type CanonicalManager = Awaited<ReturnType<typeof createReactNativeBleManager>>
type CanonicalConnection = Connection<string, CanonicalManager['identity']>
type CanonicalDatabase = DiscoveredGattDatabase<string, CanonicalManager['identity']>
type CanonicalSubscription = Subscription<string, CanonicalManager['identity']>

export interface ExamplePeer {
  readonly peerId: PeerId<string>
  readonly label: string | null
  readonly rssi: number | null
  readonly isConnectable: boolean | null
  readonly seenAt: number
  /** Full canonical diagnostic record retained for scan troubleshooting. */
  readonly advertisement: AdvertisementObservation<string>
}

export type ProfileRead<Value> = Value | { readonly skipped: true; readonly reason: string } | null

export interface ExampleCommonProfiles {
  readonly battery: ProfileRead<number>
  readonly deviceInformation: Readonly<Partial<Record<DeviceInformationStringField, ProfileRead<string>>>>
  readonly temperature: ProfileRead<TemperatureMeasurement>
  readonly bloodPressure: ProfileRead<BloodPressureMeasurement>
}

interface DeviceInformationCharacteristic {
  readonly field: DeviceInformationStringField
  readonly characteristicUuid: Uuid
}

const DEVICE_INFORMATION_CHARACTERISTICS: readonly DeviceInformationCharacteristic[] = [
  { field: 'manufacturer-name', characteristicUuid: MANUFACTURER_NAME_CHARACTERISTIC },
  { field: 'model-number', characteristicUuid: MODEL_NUMBER_CHARACTERISTIC },
  { field: 'serial-number', characteristicUuid: SERIAL_NUMBER_CHARACTERISTIC },
  { field: 'hardware-revision', characteristicUuid: HARDWARE_REVISION_CHARACTERISTIC },
  { field: 'firmware-revision', characteristicUuid: FIRMWARE_REVISION_CHARACTERISTIC },
  { field: 'software-revision', characteristicUuid: SOFTWARE_REVISION_CHARACTERISTIC }
]

let nextExampleManagerId = 1

/** The bare app owns exactly one canonical 4.0 manager and no legacy compatibility facade. */
class CanonicalBleExampleService {
  private manager: CanonicalManager | null = null
  private managerCreation: Promise<CanonicalManager> | null = null
  private scan: ScanSession<string> | null = null
  private connection: CanonicalConnection | null = null
  private database: CanonicalDatabase | null = null
  private notification: CanonicalSubscription | null = null

  async adapterState() {
    return (await this.ensureManager()).adapterState()
  }

  async scanForPeers(serviceUuids: readonly string[], onPeer: (peer: ExamplePeer) => void): Promise<void> {
    await this.stopScan()
    const manager = await this.ensureManager()
    const scan = await manager.scan({
      filter: { serviceUuids: serviceUuids.map(canonicalUuid), localNamePrefix: null },
      duplicatePolicy: 'merged',
      timestampPolicy: 'receipt-monotonic',
      delivery: {
        itemCapacity: capacity(32),
        byteCapacity: capacity(64 * 1024),
        reservedControlCapacity: capacity(2),
        overflowPolicy: 'drop-oldest'
      },
      deadline: null,
      signal: null,
      sharing: { mode: 'owner', allowSharing: false }
    })
    this.scan = scan
    void this.consumeScan(scan, onPeer)
  }

  async stopScan(): Promise<void> {
    const scan = this.scan
    if (scan === null) {
      return
    }
    assertReleased(await scan.stop(), 'scan stop')
    if (this.scan === scan) {
      this.scan = null
    }
  }

  async connect(peer: ExamplePeer): Promise<void> {
    await this.stopScan()
    if (this.connection !== null) {
      await this.disconnect()
    }
    const connection = await (await this.ensureManager()).connect(peer.peerId, operation())
    try {
      const database = await connection.discover(operation())
      this.connection = connection
      this.database = database
    } catch (error) {
      this.connection = connection
      this.database = null
      try {
        await this.disconnect()
      } catch (cleanupError) {
        console.error('[CanonicalBleExampleService.connect] Discovery cleanup failed:', cleanupError)
      }
      throw error
    }
  }

  async disconnect(): Promise<void> {
    await this.stopNotification()
    const connection = this.connection
    if (connection === null) {
      return
    }
    assertReleased(await connection.disconnect(), 'connection disconnect')
    this.connection = null
    this.database = null
  }

  async snapshot() {
    return this.requireDatabase().snapshot()
  }

  /**
   * Reads profile values through occurrence-safe canonical paths. Missing or
   * unreadable optional profile values are surfaced as explicit results.
   */
  async readCommonProfiles(): Promise<ExampleCommonProfiles> {
    return {
      battery: await this.readProfileValue(BATTERY_SERVICE, BATTERY_LEVEL_CHARACTERISTIC, 'Battery Level', parseBatteryLevel),
      deviceInformation: await this.readDeviceInformation(),
      temperature: await this.readProfileValue(
        HEALTH_THERMOMETER_SERVICE,
        TEMPERATURE_MEASUREMENT_CHARACTERISTIC,
        'Temperature Measurement',
        parseTemperatureMeasurement
      ),
      bloodPressure: await this.readProfileValue(
        BLOOD_PRESSURE_SERVICE,
        BLOOD_PRESSURE_MEASUREMENT_CHARACTERISTIC,
        'Blood Pressure Measurement',
        parseBloodPressureMeasurement
      )
    }
  }

  async readCharacteristic(serviceUuid: string, characteristicUuid: string): Promise<Uint8Array> {
    const database = this.requireDatabase()
    return database.read(await this.characteristicPath(serviceUuid, characteristicUuid), operation())
  }

  async writeCharacteristic(
    serviceUuid: string,
    characteristicUuid: string,
    bytes: Uint8Array,
    mode: 'with-response' | 'without-response'
  ): Promise<void> {
    const database = this.requireDatabase()
    await database.write(await this.characteristicPath(serviceUuid, characteristicUuid), bytes, {
      ...operation(),
      mode
    })
  }

  async readRssi(): Promise<number> {
    return this.requireConnection()
      .readRssi(operation())
      .then(measurement => measurement.rssi)
  }

  async requestMtu(requestedMtu: number): Promise<number> {
    return this.requireConnection()
      .requestMtu(requestedMtu, operation())
      .then(result => result.negotiatedMtu)
  }

  async subscribeCharacteristic(
    serviceUuid: string,
    characteristicUuid: string,
    onValue: (value: Uint8Array) => void
  ): Promise<void> {
    await this.stopNotification()
    const database = this.requireDatabase()
    const subscription = await database.subscribe(await this.characteristicPath(serviceUuid, characteristicUuid), {
      ...operation(),
      delivery: {
        itemCapacity: capacity(16),
        byteCapacity: capacity(32 * 1024),
        reservedControlCapacity: capacity(2),
        overflowPolicy: 'drop-oldest'
      }
    })
    this.notification = subscription
    void this.consumeNotification(subscription, onValue)
  }

  async stopNotification(): Promise<void> {
    const subscription = this.notification
    if (subscription === null) {
      return
    }
    assertReleased(await subscription.remove(), 'notification removal')
    if (this.notification === subscription) {
      this.notification = null
    }
  }

  async destroy(): Promise<void> {
    await this.stopScan()
    await this.disconnect()
    const manager = this.manager
    if (manager === null) {
      return
    }
    assertReleased(await manager.destroy(), 'manager destruction')
    this.manager = null
  }

  private async ensureManager(): Promise<CanonicalManager> {
    if (this.manager !== null) {
      return this.manager
    }
    if (this.managerCreation !== null) {
      return this.managerCreation
    }
    const managerId = nextExampleManagerId
    nextExampleManagerId += 1
    const creation = createReactNativeBleManager({
      platform: nativePlatform(),
      control: getNativeUnifiedBleProtocolControl(),
      now: monotonicNow,
      clientId: `bare-example-client-${managerId.toString()}`,
      managerId: `bare-example-manager-${managerId.toString()}`
    })
    this.managerCreation = creation
    try {
      const manager = await creation
      this.manager = manager
      return manager
    } finally {
      if (this.managerCreation === creation) {
        this.managerCreation = null
      }
    }
  }

  private requireConnection(): CanonicalConnection {
    if (this.connection === null) {
      throw new Error('Connect to a peer before requesting connection controls.')
    }
    return this.connection
  }

  private requireDatabase(): CanonicalDatabase {
    if (this.database === null) {
      throw new Error('Discover the connected peer before accessing GATT.')
    }
    return this.database
  }

  private async characteristicPath(serviceUuid: string, characteristicUuid: string) {
    const found = await this.findCharacteristicPath(serviceUuid, characteristicUuid)
    if (found !== null) {
      return found
    }
    throw new Error(`Characteristic ${characteristicUuid} was not found in service ${serviceUuid}.`)
  }

  private async findCharacteristicPath(serviceUuid: string, characteristicUuid: string) {
    const service = canonicalUuid(serviceUuid)
    const characteristic = canonicalUuid(characteristicUuid)
    const snapshot = await this.requireDatabase().snapshot()
    return (
      snapshot.characteristics.find(
      candidate => candidate.path.serviceUuid === service && candidate.path.characteristicUuid === characteristic
      )?.path ?? null
    )
  }

  private async readProfileValue<Value>(
    serviceUuid: Uuid,
    characteristicUuid: Uuid,
    label: string,
    decode: (bytes: Readonly<Uint8Array>) => Value
  ): Promise<ProfileRead<Value>> {
    const path = await this.findCharacteristicPath(serviceUuid, characteristicUuid)
    if (path === null) {
      return null
    }
    try {
      return decode(await this.requireDatabase().read(path, operation()))
    } catch (error) {
      const reason = errorMessage(error)
      console.error(`[CanonicalBleExampleService.readProfileValue] ${label} read failed:`, error)
      return { skipped: true, reason }
    }
  }

  private async readDeviceInformation(): Promise<Readonly<Partial<Record<DeviceInformationStringField, ProfileRead<string>>>>> {
    const database = this.requireDatabase()
    const snapshot = await database.snapshot()
    const values: Partial<Record<DeviceInformationStringField, ProfileRead<string>>> = {}
    for (const characteristic of DEVICE_INFORMATION_CHARACTERISTICS) {
      const path = snapshot.characteristics.find(
        candidate =>
          candidate.path.serviceUuid === DEVICE_INFORMATION_SERVICE &&
          candidate.path.characteristicUuid === characteristic.characteristicUuid
      )?.path
      if (path === undefined) {
        continue
      }
      try {
        values[characteristic.field] = decodeDeviceInformationString(await database.read(path, operation()))
      } catch (error) {
        const reason = errorMessage(error)
        console.error(
          `[CanonicalBleExampleService.readDeviceInformation] ${characteristic.field} read failed:`,
          error
        )
        values[characteristic.field] = { skipped: true, reason }
      }
    }
    return values
  }

  private async consumeScan(scan: ScanSession<string>, onPeer: (peer: ExamplePeer) => void): Promise<void> {
    try {
      for await (const item of scan.observations) {
        if (item.kind === 'terminal') {
          console.error('[CanonicalBleExampleService.consumeScan] Scan terminal:', item.reason)
          return
        }
        if (item.kind === 'value') {
          onPeer(peerFromObservation(item.value))
        }
      }
    } catch (error) {
      console.error('[CanonicalBleExampleService.consumeScan] Scan observation failed:', error)
    } finally {
      try {
        assertReleased(await scan.stop(), 'scan observer cleanup')
        if (this.scan === scan) {
          this.scan = null
        }
      } catch (cleanupError) {
        console.error('[CanonicalBleExampleService.consumeScan] Scan observer cleanup failed:', cleanupError)
      }
    }
  }

  private async consumeNotification(
    subscription: CanonicalSubscription,
    onValue: (value: Uint8Array) => void
  ): Promise<void> {
    try {
      for await (const item of subscription.values) {
        if (item.kind === 'terminal') {
          console.error('[CanonicalBleExampleService.consumeNotification] Notification terminal:', item.reason)
          return
        }
        if (item.kind === 'value') {
          onValue(item.value.value)
        }
      }
    } catch (error) {
      console.error('[CanonicalBleExampleService.consumeNotification] Notification stream failed:', error)
    } finally {
      try {
        assertReleased(await subscription.remove(), 'notification observer cleanup')
        if (this.notification === subscription) {
          this.notification = null
        }
      } catch (cleanupError) {
        console.error('[CanonicalBleExampleService.consumeNotification] Notification cleanup failed:', cleanupError)
      }
    }
  }
}

function operation() {
  return { signal: null, deadline: null }
}

function nativePlatform(): 'android' | 'apple' {
  if (Platform.OS === 'android') {
    return 'android'
  }
  if (Platform.OS === 'ios') {
    return 'apple'
  }
  throw new Error(`The bare example does not support the ${Platform.OS} React Native platform.`)
}

function monotonicNow(): number {
  if (globalThis.performance === undefined) {
    throw new Error('React Native did not provide a monotonic performance clock.')
  }
  return globalThis.performance.now()
}

function peerFromObservation(observation: AdvertisementObservation<string>): ExamplePeer {
  return Object.freeze({
    peerId: observation.peerId,
    label: observation.localName.state === 'present' ? observation.localName.value : null,
    rssi: observation.rssi.state === 'present' ? observation.rssi.value : null,
    isConnectable: observation.connectable.state === 'present' ? observation.connectable.value : null,
    seenAt: observation.observedAt,
    advertisement: observation
  })
}

function assertReleased(cleanup: { readonly state: 'released' | 'release-failed' }, operationName: string): void {
  if (cleanup.state !== 'released') {
    throw new Error(`${operationName} reported cleanup failures; retry the operation before continuing.`)
  }
}

function errorMessage<Value>(error: Value): string {
  return error instanceof Error ? error.message : 'The BLE operation failed with a non-Error value.'
}

export const BLEService = new CanonicalBleExampleService()
