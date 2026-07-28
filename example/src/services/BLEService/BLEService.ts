// example/src/services/BLEService/BLEService.ts

import { Platform } from 'react-native'
import {
  canonicalUuid,
  capacity,
  type Connection,
  type DiscoveredGattDatabase,
  type PeerId,
  type ScanSession,
  type Subscription
} from 'unified-ble-manager'
import { createReactNativeBleManager, getNativeUnifiedBleProtocolControl } from 'unified-ble-manager/react-native'

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
}

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
    this.scan = null
    assertReleased(await scan.stop(), 'scan stop')
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
      try {
        assertReleased(await connection.disconnect(), 'connection cleanup after discovery failure')
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
    this.notification = null
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
    const service = canonicalUuid(serviceUuid)
    const characteristic = canonicalUuid(characteristicUuid)
    const snapshot = await this.requireDatabase().snapshot()
    const found = snapshot.characteristics.find(
      candidate => candidate.path.serviceUuid === service && candidate.path.characteristicUuid === characteristic
    )
    if (found === undefined) {
      throw new Error(`Characteristic ${characteristicUuid} was not found in service ${serviceUuid}.`)
    }
    return found.path
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
      } catch (cleanupError) {
        console.error('[CanonicalBleExampleService.consumeScan] Scan observer cleanup failed:', cleanupError)
      }
      if (this.scan === scan) {
        this.scan = null
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
      } catch (cleanupError) {
        console.error('[CanonicalBleExampleService.consumeNotification] Notification cleanup failed:', cleanupError)
      }
      if (this.notification === subscription) {
        this.notification = null
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

function peerFromObservation(observation: import('unified-ble-manager').AdvertisementObservation<string>): ExamplePeer {
  return Object.freeze({
    peerId: observation.peerId,
    label: observation.localName.state === 'present' ? observation.localName.value : null,
    rssi: observation.rssi.state === 'present' ? observation.rssi.value : null,
    isConnectable: observation.connectable.state === 'present' ? observation.connectable.value : null,
    seenAt: observation.observedAt
  })
}

function assertReleased(cleanup: { readonly state: 'released' | 'release-failed' }, operationName: string): void {
  if (cleanup.state !== 'released') {
    throw new Error(`${operationName} reported cleanup failures; retry the operation before continuing.`)
  }
}

export const BLEService = new CanonicalBleExampleService()
