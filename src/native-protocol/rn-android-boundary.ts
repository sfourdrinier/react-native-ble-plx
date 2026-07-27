// src/native-protocol/rn-android-boundary.ts

import { contractError } from '../backend-contract/errors'
import type {
  NativeAttachmentIdentity,
  NativeProtocolHandshakeResult,
  Spec as NativeProtocolControl
} from '../NativeUnifiedBleProtocolControl'
import type {
  CoreBluetoothAdapterSnapshot,
  CoreBluetoothAdvertisement,
  CoreBluetoothBoundary,
  CoreBluetoothCharacteristicAddress,
  CoreBluetoothGattSnapshot
} from '../backends/corebluetooth/corebluetooth-boundary'
import {
  copyNativeProtocolBytes,
  releaseNativeProtocolBytes,
  retainNativeProtocolBytes,
  setNativeProtocolEventSink,
  submitNativeProtocolCommand,
  type NativeBinaryReference
} from './rn-jsi-binary-runtime'
import {
  decodeNativeProtocolRecord,
  encodeNativeProtocolRecord,
  type NativeProtocolField,
  type NativeProtocolRecord
} from './v1-codec'
import {
  adapterStateFromRecord,
  addressKey,
  advertisementFromRecord,
  attachmentIdentityFromRecord,
  binaryReferenceFromRecord,
  binaryReferenceRecord,
  commandEpoch,
  commandRecord,
  field,
  nativePeerIdForCommand,
  operationKey,
  protocolRecord,
  requiredRecord,
  requiredSigned,
  requiredString,
  snapshotFromRecord,
  optionalRecord,
  optionalString,
  requiredUnsigned
} from './rn-android-protocol-records'

const protocolVersion = 1
const maximumNativePayloadBytes = 512 * 1024

type PendingResult = {
  readonly kind: string
  readonly nativePeerId: string | null
  readonly resolve: (record: NativeProtocolRecord) => void
  readonly reject: (error: Error) => void
}

type NativeConnection = {
  readonly record: NativeProtocolRecord
  state: 'connecting' | 'connected' | 'disconnected'
}

type NativeSubscription = {
  readonly subscriptionId: string
  readonly address: CoreBluetoothCharacteristicAddress
  readonly onValue: (value: Uint8Array) => void
}

/**
 * The React Native Android boundary owns the versioned JSI command/event transport.
 * It preserves native-only identifiers inside this file and exposes only the typed
 * direct-boundary interface consumed by the shared backend.
 */
export class ReactNativeAndroidProtocolBoundary implements CoreBluetoothBoundary {
  private readonly pending = new Map<string, PendingResult>()
  private readonly connections = new Map<string, NativeConnection>()
  private readonly databases = new Map<string, NativeProtocolRecord>()
  private readonly subscriptionsByAddress = new Map<string, NativeSubscription>()
  private readonly scanListeners = new Set<(advertisement: CoreBluetoothAdvertisement) => void>()
  private readonly scanFailureListeners = new Set<(safeMessage: string) => void>()
  private readonly disconnectListeners = new Set<(nativePeerId: string, safeMessage: string | null) => void>()
  private readonly adapterListeners = new Set<(state: CoreBluetoothAdapterSnapshot) => void>()
  private latestAdapterState: CoreBluetoothAdapterSnapshot | null = null
  private attachmentRecord: NativeProtocolRecord | null = null
  private maximumInputPayloadBytes = 0
  private nextEpoch = 1
  private nextConnection = 1
  private nextDatabase = 1
  private nextSubscription = 1
  private opened = false
  private closing = false

  constructor(
    private readonly control: NativeProtocolControl,
    private readonly ownerId: string
  ) {}

  /** Binds this one native radio boundary to the backend attachment before its control handshake. */
  bindAttachment(attachment: NativeAttachmentIdentity): void {
    if (this.opened || this.attachmentRecord !== null) {
      throw contractError('lifecycle.invalid-state', 'boundary', 'rn-android-boundary.bind-attachment')
    }
    this.attachmentRecord = protocolRecord('attachment', [
      field(1, attachment.attachmentId),
      field(2, attachment.backendInstanceId),
      field(3, attachment.backendGeneration),
      field(4, attachment.adapterId),
      field(5, attachment.adapterGeneration)
    ])
  }

  adapterSnapshot(): CoreBluetoothAdapterSnapshot {
    return (
      this.latestAdapterState ??
      Object.freeze({
        availability: 'unknown',
        authorization: 'unavailable',
        power: 'unknown',
        safeReason: 'The Android radio has not emitted its authoritative adapter state yet.'
      })
    )
  }

  async open(): Promise<void> {
    if (this.opened) {
      throw contractError('lifecycle.invalid-state', 'boundary', 'rn-android-boundary.open')
    }
    const attachment = this.requireAttachmentRecord('open')
    let handshakeOpened = false
    try {
      const handshake = await this.control.handshake({
        nativeProtocol: { minimum: protocolVersion, maximum: protocolVersion },
        abi: { minimum: protocolVersion, maximum: protocolVersion },
        backendContract: { minimum: protocolVersion, maximum: protocolVersion },
        capabilitySchema: { minimum: protocolVersion, maximum: protocolVersion },
        eventSchema: { minimum: protocolVersion, maximum: protocolVersion },
        traceFormat: { minimum: protocolVersion, maximum: protocolVersion },
        ...attachmentIdentityFromRecord(attachment),
        ownerId: this.ownerId
      })
      handshakeOpened = true
      assertHandshakeSelection(handshake)
      this.maximumInputPayloadBytes = Math.min(maximumNativePayloadBytes, handshake.maximumBinaryPayloadBytes)
      await this.control.installExecutionRuntime()
      setNativeProtocolEventSink(bytes => this.receiveRecord(bytes))
      this.opened = true
    } catch (error) {
      this.maximumInputPayloadBytes = 0
      if (handshakeOpened) {
        try {
          await this.control.closeAttachment(attachmentIdentityFromRecord(attachment))
        } catch (closeError) {
          console.error('[ReactNativeAndroidProtocolBoundary.open] Handshake-open cleanup failed:', closeError)
        }
      }
      throw error
    }
  }

  async startScan(
    onAdvertisement: (advertisement: CoreBluetoothAdvertisement) => void,
    serviceUuids: readonly string[]
  ): Promise<void> {
    this.requireOpen('start-scan')
    this.scanListeners.add(onAdvertisement)
    try {
      await this.dispatch('scanStart', [
        field(
          12,
          protocolRecord('scanOptions', [
            field(1, [...serviceUuids]),
            field(2, true),
            field(3, 2),
            field(4, 1),
            field(5, true)
          ])
        )
      ])
    } catch (error) {
      this.scanListeners.delete(onAdvertisement)
      throw error
    }
  }

  async stopScan(): Promise<void> {
    this.requireOpen('stop-scan')
    await this.dispatch('scanStop', [])
    this.scanListeners.clear()
  }

  async connect(nativePeerId: string): Promise<void> {
    this.requireOpen('connect')
    const existing = this.connections.get(nativePeerId)
    if (existing !== undefined && existing.state !== 'disconnected') {
      throw contractError('connection.already-owned', 'connection', 'rn-android-boundary.connect')
    }
    const connection = this.createConnection(nativePeerId)
    this.connections.set(nativePeerId, connection)
    try {
      await this.dispatch('connect', [field(10, connection.record)])
      connection.state = 'connected'
    } catch (error) {
      this.connections.delete(nativePeerId)
      throw error
    }
  }

  async disconnect(nativePeerId: string): Promise<void> {
    this.requireOpen('disconnect')
    const connection = this.requireConnection(nativePeerId, 'disconnect')
    await this.dispatch('disconnect', [field(10, connection.record)])
    connection.state = 'disconnected'
    this.databases.delete(nativePeerId)
  }

  connectionState(nativePeerId: string): 'connecting' | 'connected' | 'disconnected' {
    return this.connections.get(nativePeerId)?.state ?? 'disconnected'
  }

  async readRssi(nativePeerId: string): Promise<number> {
    this.requireOpen('read-rssi')
    const connection = this.requireConnection(nativePeerId, 'read-rssi')
    if (connection.state !== 'connected') {
      throw contractError('operation.disconnected', 'connection', 'rn-android-boundary.read-rssi')
    }
    const result = await this.dispatch('readRssi', [field(10, connection.record)])
    return requiredSigned(result, 13, 'rn-android-boundary.read-rssi.rssi')
  }

  async requestMtu(nativePeerId: string, requestedMtu: number): Promise<number> {
    this.requireOpen('request-mtu')
    const connection = this.requireConnection(nativePeerId, 'request-mtu')
    if (connection.state !== 'connected') {
      throw contractError('operation.disconnected', 'connection', 'rn-android-boundary.request-mtu')
    }
    const result = await this.dispatch('requestMtu', [field(10, connection.record), field(14, requestedMtu)])
    return requiredUnsigned(result, 14, 'rn-android-boundary.request-mtu.negotiated')
  }

  async discover(nativePeerId: string): Promise<CoreBluetoothGattSnapshot> {
    this.requireOpen('discover')
    const connection = this.requireConnection(nativePeerId, 'discover')
    if (connection.state !== 'connected') {
      throw contractError('operation.disconnected', 'connection', 'rn-android-boundary.discover')
    }
    const database = this.createDatabase(connection.record)
    const result = await this.dispatch('discover', [field(10, connection.record), field(11, database)])
    const snapshot = requiredRecord(result, 12, 'rn-android-boundary.discover.snapshot')
    this.databases.set(nativePeerId, database)
    return snapshotFromRecord(snapshot)
  }

  async read(address: CoreBluetoothCharacteristicAddress): Promise<Uint8Array> {
    this.requireOpen('read')
    const result = await this.dispatch('read', [field(4, this.characteristicPath(address))])
    const reference = binaryReferenceFromRecord(requiredRecord(result, 6, 'rn-android-boundary.read.binary'))
    return this.takeOutputBytes(reference, 'read')
  }

  async write(address: CoreBluetoothCharacteristicAddress, bytes: Uint8Array, withResponse: boolean): Promise<void> {
    this.requireOpen('write')
    if (bytes.byteLength > this.maximumInputPayloadBytes) {
      throw contractError('bytes.too-large', 'boundary', 'rn-android-boundary.write')
    }
    const correlation = this.nextCorrelation()
    const reference = retainNativeProtocolBytes(correlation.nonce, bytes)
    const command = commandRecord(protocolVersion, 'write', correlation.record, [
      field(4, this.characteristicPath(address)),
      field(6, binaryReferenceRecord(reference)),
      field(13, withResponse ? 'withResponse' : 'withoutResponse')
    ])
    try {
      await this.submit(command, correlation.nonce, 'write')
    } catch (error) {
      try {
        const released = releaseNativeProtocolBytes(reference)
        if (!released) {
          console.error(
            '[ReactNativeAndroidProtocolBoundary.write] Native input was already released after dispatch failure:',
            {
              ownerToken: reference.ownerToken,
              operationCorrelation: reference.operationCorrelation
            }
          )
        }
      } catch (releaseError) {
        console.error(
          '[ReactNativeAndroidProtocolBoundary.write] Native input release after dispatch failure failed:',
          releaseError
        )
      }
      throw error
    }
  }

  async startNotify(address: CoreBluetoothCharacteristicAddress, onValue: (bytes: Uint8Array) => void): Promise<void> {
    this.requireOpen('start-notify')
    const key = addressKey(address)
    if (this.subscriptionsByAddress.has(key)) {
      throw contractError('lifecycle.invalid-state', 'gatt', 'rn-android-boundary.start-notify')
    }
    const subscriptionId = `rn-android-subscription-${this.nextSubscription}`
    this.nextSubscription += 1
    const subscription: NativeSubscription = { subscriptionId, address, onValue }
    // Native Android can emit a value immediately after CCCD enablement, before its terminal result arrives.
    this.subscriptionsByAddress.set(key, subscription)
    try {
      await this.dispatch('subscribe', [field(4, this.characteristicPath(address)), field(7, subscriptionId)])
    } catch (error) {
      this.subscriptionsByAddress.delete(key)
      throw error
    }
  }

  async stopNotify(address: CoreBluetoothCharacteristicAddress): Promise<void> {
    this.requireOpen('stop-notify')
    const key = addressKey(address)
    const subscription = this.subscriptionsByAddress.get(key)
    if (subscription === undefined) {
      return
    }
    await this.dispatch('unsubscribe', [
      field(4, this.characteristicPath(address)),
      field(7, subscription.subscriptionId)
    ])
    this.subscriptionsByAddress.delete(key)
  }

  onDisconnect(listener: (nativePeerId: string, safeMessage: string | null) => void): () => void {
    this.disconnectListeners.add(listener)
    return () => this.disconnectListeners.delete(listener)
  }

  onScanFailure(listener: (safeMessage: string) => void): () => void {
    this.scanFailureListeners.add(listener)
    return () => this.scanFailureListeners.delete(listener)
  }

  onAdapterState(listener: (state: CoreBluetoothAdapterSnapshot) => void): () => void {
    this.adapterListeners.add(listener)
    return () => this.adapterListeners.delete(listener)
  }

  async destroy(): Promise<void> {
    if (!this.opened || this.closing) {
      return
    }
    this.closing = true
    const attachment = this.requireAttachmentRecord('destroy')
    let destroyFailure: Error | null = null
    try {
      await this.dispatch('destroy', [])
    } catch (error) {
      destroyFailure = error instanceof Error ? error : new Error('Native protocol destroy failed')
    }
    try {
      await this.control.closeAttachment(attachmentIdentityFromRecord(attachment))
    } catch (closeError) {
      console.error('[ReactNativeAndroidProtocolBoundary.destroy] Native attachment close failed:', closeError)
      if (destroyFailure === null) {
        destroyFailure = closeError instanceof Error ? closeError : new Error('Native attachment close failed')
      }
    } finally {
      this.opened = false
      this.closing = false
      this.scanListeners.clear()
      this.scanFailureListeners.clear()
      this.connections.clear()
      this.databases.clear()
      this.subscriptionsByAddress.clear()
      this.rejectPending('Native protocol attachment was destroyed')
    }
    if (destroyFailure !== null) {
      throw destroyFailure
    }
  }

  private async dispatch(kind: string, fields: readonly NativeProtocolField[]): Promise<NativeProtocolRecord> {
    const correlation = this.nextCorrelation()
    return this.submit(commandRecord(protocolVersion, kind, correlation.record, fields), correlation.nonce, kind)
  }

  private submit(command: NativeProtocolRecord, nonce: string, kind: string): Promise<NativeProtocolRecord> {
    const key = operationKey(commandEpoch(command), nonce)
    const nativePeerId = nativePeerIdForCommand(command)
    return new Promise<NativeProtocolRecord>((resolve, reject) => {
      this.pending.set(key, { kind, nativePeerId, resolve, reject })
      try {
        submitNativeProtocolCommand(encodeNativeProtocolRecord(command))
      } catch (error) {
        this.pending.delete(key)
        reject(error instanceof Error ? error : new Error('Native protocol command submission failed'))
      }
    })
  }

  private receiveRecord(bytes: Uint8Array): void {
    try {
      const record = decodeNativeProtocolRecord(bytes)
      if (record.kind === 'result') {
        this.receiveResult(record)
        return
      }
      if (record.kind === 'event') {
        this.receiveEvent(record)
        return
      }
      throw contractError('protocol.malformed', 'boundary', 'rn-android-boundary.receive-record')
    } catch (error) {
      console.error('[ReactNativeAndroidProtocolBoundary.receiveRecord] Native record was rejected:', error)
      this.rejectPending('A malformed native protocol record invalidated pending operations')
    }
  }

  private receiveResult(result: NativeProtocolRecord): void {
    const terminal = requiredRecord(result, 3, 'rn-android-boundary.result.terminal')
    const correlation = requiredRecord(terminal, 1, 'rn-android-boundary.result.correlation')
    const key = operationKey(
      requiredUnsigned(correlation, 2, 'rn-android-boundary.result.epoch'),
      requiredString(correlation, 3, 'rn-android-boundary.result.nonce')
    )
    const pending = this.pending.get(key)
    if (pending === undefined) {
      console.error('[ReactNativeAndroidProtocolBoundary.receiveResult] Late terminal result was quarantined:', { key })
      return
    }
    this.pending.delete(key)
    if (requiredString(terminal, 2, 'rn-android-boundary.result.outcome') === 'succeeded') {
      pending.resolve(result)
      return
    }
    const error = optionalRecord(result, 10)
    const safeMessage = error === null ? null : optionalString(error, 7)
    pending.reject(new Error(safeMessage ?? `Native ${pending.kind} operation failed`))
  }

  private receiveEvent(event: NativeProtocolRecord): void {
    const kind = requiredString(event, 3, 'rn-android-boundary.event.kind')
    if (kind === 'advertisement') {
      const advertisement = requiredRecord(event, 12, 'rn-android-boundary.event.advertisement')
      const rawRecord = optionalRecord(advertisement, 15)
      if (rawRecord !== null) {
        this.takeOutputBytes(binaryReferenceFromRecord(rawRecord), 'advertisement')
      }
      const value = advertisementFromRecord(advertisement)
      for (const listener of this.scanListeners) {
        listener(value)
      }
      return
    }
    if (kind === 'notification') {
      const subscriptionId = requiredString(event, 11, 'rn-android-boundary.event.subscription')
      const reference = binaryReferenceFromRecord(requiredRecord(event, 13, 'rn-android-boundary.event.binary'))
      const bytes = this.takeOutputBytes(reference, 'notification')
      const subscription = [...this.subscriptionsByAddress.values()].find(
        candidate => candidate.subscriptionId === subscriptionId
      )
      if (subscription === undefined) {
        console.error(
          '[ReactNativeAndroidProtocolBoundary.receiveEvent] Notification for an inactive subscription was quarantined:',
          { subscriptionId }
        )
        return
      }
      subscription.onValue(bytes)
      return
    }
    if (kind === 'connectionLost') {
      const connection = requiredRecord(event, 7, 'rn-android-boundary.event.connection')
      const peerId = requiredString(connection, 2, 'rn-android-boundary.event.peer')
      const error = optionalRecord(event, 14)
      const safeMessage = error === null ? null : optionalString(error, 7)
      this.invalidateConnection(peerId)
      this.rejectPendingForPeer(peerId, 'Android GATT connection was lost')
      for (const listener of this.disconnectListeners) {
        listener(peerId, safeMessage)
      }
      return
    }
    if (kind === 'adapterState') {
      const state = adapterStateFromRecord(requiredRecord(event, 15, 'rn-android-boundary.event.adapter-state'))
      this.latestAdapterState = state
      for (const listener of this.adapterListeners) {
        listener(state)
      }
      return
    }
    if (kind === 'diagnostic') {
      const error = optionalRecord(event, 14)
      const code = error === null ? null : optionalString(error, 1)
      const safeMessage = error === null ? null : optionalString(error, 7)
      if (code === 'scanFailed') {
        const message = safeMessage ?? 'Android scan failed'
        this.scanListeners.clear()
        for (const listener of this.scanFailureListeners) {
          listener(message)
        }
        return
      }
      console.error('[ReactNativeAndroidProtocolBoundary.receiveEvent] Native diagnostic event received:', {
        code,
        safeMessage
      })
      return
    }
    console.error('[ReactNativeAndroidProtocolBoundary.receiveEvent] Unsupported native event was quarantined:', {
      kind
    })
  }

  private takeOutputBytes(reference: NativeBinaryReference, operation: string): Uint8Array {
    let output: Uint8Array | null = null
    let copyFailure: Error | null = null
    let releaseFailure: Error | null = null
    try {
      if (reference.byteLength > maximumNativePayloadBytes) {
        throw contractError('bytes.too-large', 'boundary', `rn-android-boundary.${operation}`)
      }
      output = new Uint8Array(copyNativeProtocolBytes(reference))
    } catch (error) {
      console.error('[ReactNativeAndroidProtocolBoundary.takeOutputBytes] Native output copy failed:', {
        operation,
        error
      })
      copyFailure = error instanceof Error ? error : new Error('Native output copy failed')
    } finally {
      try {
        const released = releaseNativeProtocolBytes(reference)
        if (!released) {
          releaseFailure = contractError('protocol.violation', 'boundary', `rn-android-boundary.${operation}.release`)
        }
      } catch (error) {
        releaseFailure = error instanceof Error ? error : new Error('Native output release failed')
      }
    }
    if (releaseFailure !== null) {
      console.error('[ReactNativeAndroidProtocolBoundary.takeOutputBytes] Native output release failed:', {
        operation,
        ownerToken: reference.ownerToken,
        operationCorrelation: reference.operationCorrelation,
        error: releaseFailure
      })
      throw releaseFailure
    }
    if (copyFailure !== null) {
      throw copyFailure
    }
    if (output === null) {
      throw contractError('lifecycle.invariant-violation', 'boundary', `rn-android-boundary.${operation}.copy`)
    }
    return output
  }

  private nextCorrelation(): { readonly nonce: string; readonly record: NativeProtocolRecord } {
    const dispatchEpoch = this.nextEpoch
    this.nextEpoch += 1
    const nonce = `rn-android-operation-${dispatchEpoch}`
    return {
      nonce,
      record: protocolRecord('operationCorrelation', [
        field(1, this.requireAttachmentRecord('next-correlation')),
        field(2, dispatchEpoch),
        field(3, nonce)
      ])
    }
  }

  private createConnection(nativePeerId: string): NativeConnection {
    const ordinal = this.nextConnection
    this.nextConnection += 1
    return {
      record: protocolRecord('connectionPath', [
        field(1, this.requireAttachmentRecord('create-connection')),
        field(2, nativePeerId),
        field(3, `rn-android-connection-${ordinal}`),
        field(4, `rn-android-lease-${ordinal}`),
        field(5, `rn-android-connection-generation-${ordinal}`)
      ]),
      state: 'connecting'
    }
  }

  private createDatabase(connection: NativeProtocolRecord): NativeProtocolRecord {
    const ordinal = this.nextDatabase
    this.nextDatabase += 1
    return protocolRecord('databasePath', [
      field(1, connection),
      field(2, `rn-android-database-${ordinal}`),
      field(3, `rn-android-database-generation-${ordinal}`)
    ])
  }

  private characteristicPath(address: CoreBluetoothCharacteristicAddress): NativeProtocolRecord {
    const database = this.databases.get(address.nativePeerId)
    if (database === undefined) {
      throw contractError('gatt.stale-handle', 'gatt', 'rn-android-boundary.characteristic-path')
    }
    const service = protocolRecord('servicePath', [
      field(1, database),
      field(2, address.serviceUuid),
      field(3, String(address.serviceOccurrence))
    ])
    return protocolRecord('characteristicPath', [
      field(1, service),
      field(2, address.characteristicUuid),
      field(3, String(address.characteristicOccurrence))
    ])
  }

  private requireConnection(nativePeerId: string, operation: string): NativeConnection {
    const connection = this.connections.get(nativePeerId)
    if (connection === undefined) {
      throw contractError('connection.not-found', 'connection', `rn-android-boundary.${operation}`)
    }
    return connection
  }

  private requireOpen(operation: string): void {
    if (!this.opened || this.closing) {
      throw contractError('lifecycle.destroyed', 'boundary', `rn-android-boundary.${operation}`)
    }
  }

  private requireAttachmentRecord(operation: string): NativeProtocolRecord {
    if (this.attachmentRecord === null) {
      throw contractError('lifecycle.invalid-state', 'boundary', `rn-android-boundary.${operation}.attachment`)
    }
    return this.attachmentRecord
  }

  private rejectPending(message: string): void {
    for (const pending of this.pending.values()) {
      pending.reject(new Error(message))
    }
    this.pending.clear()
  }

  private invalidateConnection(nativePeerId: string): void {
    this.connections.delete(nativePeerId)
    this.databases.delete(nativePeerId)
    for (const [key, subscription] of this.subscriptionsByAddress) {
      if (subscription.address.nativePeerId === nativePeerId) {
        this.subscriptionsByAddress.delete(key)
      }
    }
  }

  private rejectPendingForPeer(nativePeerId: string, message: string): void {
    for (const [key, pending] of this.pending) {
      if (pending.nativePeerId === nativePeerId) {
        this.pending.delete(key)
        pending.reject(new Error(message))
      }
    }
  }
}

function assertHandshakeSelection(handshake: NativeProtocolHandshakeResult): void {
  if (
    handshake.nativeProtocol !== protocolVersion ||
    handshake.abi !== protocolVersion ||
    handshake.backendContract !== protocolVersion ||
    handshake.capabilitySchema !== protocolVersion ||
    handshake.eventSchema !== protocolVersion ||
    handshake.traceFormat !== protocolVersion ||
    !Number.isSafeInteger(handshake.maximumControlRecordBytes) ||
    handshake.maximumControlRecordBytes <= 0 ||
    !Number.isSafeInteger(handshake.maximumBinaryPayloadBytes) ||
    handshake.maximumBinaryPayloadBytes <= 0
  ) {
    throw contractError('protocol.incompatible', 'boundary', 'rn-android-boundary.open.handshake')
  }
}
