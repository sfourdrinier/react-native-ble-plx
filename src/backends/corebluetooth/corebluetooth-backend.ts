// src/backends/corebluetooth/corebluetooth-backend.ts
// src/backends/corebluetooth/corebluetooth-backend.ts

import type {
  AdapterBackend,
  BackendAttachment,
  BackendAttachmentRequest,
  BackendConnection,
  BackendEvent,
  BleCentralBackend,
  ConnectionBackend,
  ConnectionLease,
  GattBackend,
  ResourceCounters,
  ScanLease,
  ScannerBackend
} from '../../backend-contract/backend'
import type { AdvertisementObservation, OwnerScanOptions } from '../../backend-contract/advertisement'
import { createFeatureRegistry } from '../../backend-contract/capabilities'
import { contractError, type CleanupFailure, type CleanupRecord } from '../../backend-contract/errors'
import type { CharacteristicPath } from '../../backend-contract/gatt'
import {
  attachmentRecordsEqual,
  type AdapterStateSnapshot,
  type AdapterStateWatch,
  type AttachmentRecord,
  type HostNeutralBackendIdentity
} from '../../backend-contract/identity'
import type { PublicOperationOptions } from '../../backend-contract/operations'
import {
  canonicalUuid,
  createAttachmentBoundIdFactory,
  monotonicTimestamp,
  negotiateCoreVersions,
  opaqueId,
  resourceCount,
  type BackendInstanceId,
  type ClientId,
  type ConnectionId,
  type GenerationId,
  type LeaseId,
  type PeerId,
  type ScanSessionId,
  type ScanShareToken
} from '../../backend-contract/primitives'
import type { BoundedAsyncStream } from '../../backend-contract/streams'
import { CoreBoundedStream } from '../../core/bounded-stream'
import { CoreBluetoothOperationDispatcher } from './corebluetooth-operation-dispatcher'
import { CoreBluetoothOperationLifecycle } from './corebluetooth-operation-lifecycle'
import type {
  CoreBluetoothAdapterSnapshot,
  CoreBluetoothAdvertisement,
  CoreBluetoothBoundary,
  CoreBluetoothCharacteristicAddress,
  CoreBluetoothGattSnapshot
} from './corebluetooth-boundary'
import {
  advertisementByteLength,
  cleanupFailure,
  cleanupFailureDetail,
  connectionPathFor,
  CoreBluetoothBackendSubscription,
  CoreBluetoothConnection,
  CoreBluetoothConnectionLease,
  CoreBluetoothGattDatabase,
  CoreBluetoothScanLease,
  matchesScan,
  releasedCleanup
} from './corebluetooth-handles'
import { CoreBluetoothGattOperations } from './corebluetooth-gatt-operations'
import { CoreBluetoothConnectionControls } from './corebluetooth-connection-controls'
import { coreBluetoothCompatibility } from './corebluetooth-provider'
import { coreBluetoothIdentityOptions, type DirectGattBackendIdentityOptions } from './corebluetooth-identity'
import { adapterStateLimits, backendEventLimits } from './corebluetooth-stream-limits'

export type { DirectGattBackendIdentityOptions } from './corebluetooth-identity'

export interface ScanConsumer {
  readonly scanSessionId: ScanSessionId<string, string>
  readonly leaseId: LeaseId<string, string>
  readonly shareToken: ScanShareToken<string, string> | null
  readonly options: OwnerScanOptions<string, string>
  readonly stream: CoreBoundedStream<AdvertisementObservation<string>>
  abort: (() => void) | null
  deadlineTimer: ReturnType<typeof setTimeout> | null
}

interface ScanGroup {
  readonly ownerLeaseId: LeaseId<string, string>
  readonly shareToken: ScanShareToken<string, string> | null
  readonly consumers: Map<string, ScanConsumer>
  state: 'starting' | 'active' | 'stopping' | 'failed'
}

export interface ConnectionRecord {
  readonly nativePeerId: string
  readonly peerId: PeerId<string>
  readonly connectionId: ConnectionId<string, string>
  readonly connectionGeneration: GenerationId<'connection-generation', string>
  readonly ownerLeaseId: LeaseId<string, string>
  readonly ownerClientId: ClientId<string, string>
  state: 'connecting' | 'connected' | 'disconnecting' | 'disconnected' | 'lost'
  database: CoreBluetoothGattDatabase | null
  lease: CoreBluetoothConnectionLease | null
}

export interface PhysicalSubscription {
  readonly key: string
  readonly address: CoreBluetoothCharacteristicAddress
  readonly consumers: Set<CoreBluetoothBackendSubscription>
  state: 'enabling' | 'ready' | 'removing'
  removal: Promise<CleanupRecord> | null
}

let nextBackendInstance = 1

function allocateBackendInstance(): number {
  const current = nextBackendInstance
  nextBackendInstance += 1
  return current
}

/**
 * First-party CoreBluetooth backend for explicitly selected macOS Node or
 * Electron-main hosts. It uses only the typed direct addon boundary; the
 * transitional BlePort and Base64 facade are not in this execution path.
 */
export class CoreBluetoothBackend implements BleCentralBackend<string, HostNeutralBackendIdentity<string>> {
  readonly features = createFeatureRegistry([])
  readonly adapter: AdapterBackend<string>
  readonly scanner: ScannerBackend<string>
  readonly connections: ConnectionBackend<string>
  readonly gatt: GattBackend<string>
  private readonly backendInstanceId: BackendInstanceId<string>
  readonly dispatcher: CoreBluetoothOperationDispatcher
  readonly operationLifecycle: CoreBluetoothOperationLifecycle
  private readonly eventStreams = new Set<CoreBoundedStream<BackendEvent<string>>>()
  private readonly stateStreams = new Set<CoreBoundedStream<AdapterStateSnapshot<string>>>()
  private readonly peerIdsByNativeId = new Map<string, PeerId<string>>()
  private readonly nativeIdsByPeerId = new Map<string, string>()
  private readonly connectionsByNativeId = new Map<string, ConnectionRecord>()
  readonly subscriptions = new Map<string, PhysicalSubscription>()
  readonly gattOperations: CoreBluetoothGattOperations
  readonly connectionControls: CoreBluetoothConnectionControls
  private readonly disconnectListener: () => void
  private readonly scanFailureListener: (() => void) | null
  private readonly adapterStateListener: () => void
  private adapterStateSnapshot: CoreBluetoothAdapterSnapshot
  private attached = false
  private admissionClosed = false
  private destroyed = false
  private destroyResult: Promise<CleanupRecord> | null = null
  private scanGroup: ScanGroup | null = null
  private backendGeneration = 1
  private adapterGeneration = 1
  private nextPeer = 1
  private nextScan = 1
  private nextConnection = 1
  private nextLease = 1
  nextDatabase = 1
  nextSubscription = 1
  private nextIngressOrdinal = 1

  constructor(
    readonly boundary: CoreBluetoothBoundary,
    private readonly now: () => number,
    private readonly hostKind: 'node' | 'electron-main' | 'native-mobile',
    private readonly identityOptions: DirectGattBackendIdentityOptions = coreBluetoothIdentityOptions
  ) {
    this.backendInstanceId = opaqueId(
      `${this.identityOptions.backendInstancePrefix}-${allocateBackendInstance()}`,
      'backend-instance',
      this.identityOptions.attachmentScope
    )
    this.dispatcher = new CoreBluetoothOperationDispatcher(now)
    this.operationLifecycle = new CoreBluetoothOperationLifecycle(now)
    this.adapterStateSnapshot = boundary.adapterSnapshot()
    this.gattOperations = new CoreBluetoothGattOperations(this)
    this.connectionControls = new CoreBluetoothConnectionControls(this)
    this.adapter = {
      currentState: async () => this.adapterState(),
      watchState: async () => this.watchAdapterState()
    }
    this.scanner = {
      start: (options, clientId) => this.startScan(options, clientId),
      join: (leaseId, token, clientId) => this.joinScan(leaseId, token, clientId)
    }
    this.connections = {
      connect: (peerId, clientId, options) => this.connect(peerId, clientId, options),
      readRssi: (connection, request) => this.connectionControls.readRssi(connection, request),
      requestMtu: (connection, request) => this.connectionControls.requestMtu(connection, request)
    }
    this.gatt = {
      discover: (connection, options) => this.gattOperations.discover(connection, options),
      read: (path, request) => this.gattOperations.read(path, request),
      write: (path, request) => this.gattOperations.write(path, request),
      readDescriptor: (path, request) => this.gattOperations.readDescriptor(path, request),
      writeDescriptor: (path, request) => this.gattOperations.writeDescriptor(path, request),
      subscribe: (path, request) => this.gattOperations.subscribe(path, request),
      unsubscribe: (subscription, operation) => this.gattOperations.unsubscribe(subscription, operation)
    }
    this.disconnectListener = boundary.onDisconnect((nativePeerId, safeMessage) => {
      this.handleDisconnect(nativePeerId, safeMessage)
    })
    this.scanFailureListener =
      boundary.onScanFailure?.(safeMessage => {
        this.handleScanFailure(safeMessage)
      }) ?? null
    this.adapterStateListener = boundary.onAdapterState(state => {
      this.handleAdapterState(state)
    })
  }

  get identity(): HostNeutralBackendIdentity<string> {
    const attachment = this.attachment()
    return Object.freeze({
      registeredBackendId: this.identityOptions.registeredBackendId,
      registeredPlatformId: this.identityOptions.registeredPlatformId,
      attachment,
      versions: negotiateCoreVersions(coreBluetoothCompatibility, coreBluetoothCompatibility),
      runtime: Object.freeze({
        hostKind: this.hostKind,
        implementationVersion: this.identityOptions.implementationVersion,
        diagnostics: Object.freeze({ boundary: 'corebluetooth-direct-v1' })
      })
    })
  }

  async attach(
    request: BackendAttachmentRequest
  ): Promise<BackendAttachment<string, HostNeutralBackendIdentity<string>>> {
    this.assertUsable('corebluetooth.attach')
    if (this.attached) {
      throw contractError('lifecycle.invalid-state', 'core', 'corebluetooth.attach')
    }
    negotiateCoreVersions(coreBluetoothCompatibility, request.coreCompatibility)
    this.attached = true
    const identity = this.identity
    return Object.freeze({ attachment: identity.attachment, identity })
  }

  events(): BoundedAsyncStream<BackendEvent<string>> {
    this.assertUsable('corebluetooth.events')
    const stream = new CoreBoundedStream<BackendEvent<string>>(backendEventLimits, 'error')
    this.eventStreams.add(stream)
    return stream
  }

  resourceCounters(): ResourceCounters {
    let subscriptionConsumers = 0
    let retainedByteBuffers = 0
    for (const physical of this.subscriptions.values()) {
      subscriptionConsumers += physical.consumers.size
      for (const consumer of physical.consumers) {
        retainedByteBuffers += consumer.stream.retainedPayloadBytes()
      }
    }
    return {
      activeScanControllers: resourceCount(this.scanGroup === null ? 0 : 1),
      scanConsumers: resourceCount(this.scanGroup?.consumers.size ?? 0),
      chooserSessions: resourceCount(0),
      connectionLeases: resourceCount(
        [...this.connectionsByNativeId.values()].filter(record => record.lease !== null).length
      ),
      physicalLinks: resourceCount(
        [...this.connectionsByNativeId.values()].filter(record => record.state === 'connected').length
      ),
      databaseSnapshots: resourceCount(
        [...this.connectionsByNativeId.values()].filter(record => record.database !== null).length
      ),
      physicalCccdEnablements: resourceCount(this.subscriptions.size),
      subscriptionConsumers: resourceCount(subscriptionConsumers),
      queuedOperations: resourceCount(0),
      dispatchedOperations: resourceCount(this.dispatcher.activeCount()),
      retainedByteBuffers: resourceCount(retainedByteBuffers),
      restorationRecords: resourceCount(0),
      orphanedIpcOwners: resourceCount(0)
    }
  }

  destroy(): Promise<CleanupRecord> {
    if (this.destroyResult === null) {
      const destruction = this.destroyInternal()
      this.destroyResult = destruction.then(result => {
        if (result.state === 'release-failed') {
          this.destroyResult = null
        }
        return result
      })
    }
    return this.destroyResult
  }

  attachment(): AttachmentRecord<string> {
    const backendGeneration = opaqueId(
      String(this.backendGeneration),
      'backend-generation',
      this.identityOptions.attachmentScope
    )
    const adapterId = opaqueId(this.identityOptions.adapterNativeId, 'adapter', this.identityOptions.attachmentScope)
    const adapterState = this.adapterState()
    return Object.freeze({
      attachmentId: opaqueId(
        `${String(this.backendInstanceId)}:${this.backendGeneration}:${this.adapterGeneration}`,
        'attachment',
        this.identityOptions.attachmentScope
      ),
      backendInstanceId: this.backendInstanceId,
      backendGeneration,
      adapter: Object.freeze({
        adapterId,
        displayName: this.identityOptions.adapterDisplayName,
        state: adapterState,
        adapterGeneration: opaqueId(
          String(this.adapterGeneration),
          'adapter-generation',
          this.identityOptions.attachmentScope
        ),
        limitations: Object.freeze([...this.identityOptions.limitations])
      })
    })
  }

  assertUsable(operation: string): void {
    if (this.admissionClosed || this.destroyed) {
      throw contractError('lifecycle.destroyed', 'core', operation)
    }
  }

  private adapterState(): AdapterStateSnapshot<string> {
    const state = this.adapterStateSnapshot
    return Object.freeze({
      availability: state.availability,
      authorization: state.authorization,
      power: state.power,
      backendGeneration: opaqueId(
        String(this.backendGeneration),
        'backend-generation',
        this.identityOptions.attachmentScope
      ),
      updatedAt: monotonicTimestamp(this.now()),
      safeReason: state.safeReason
    })
  }

  private watchAdapterState(): AdapterStateWatch<string> {
    const stream = new CoreBoundedStream<AdapterStateSnapshot<string>>(adapterStateLimits, 'latest')
    this.stateStreams.add(stream)
    return Object.freeze({ initial: this.adapterState(), transitions: stream })
  }

  identifiers() {
    const attachment = this.attachment()
    return createAttachmentBoundIdFactory({
      attachmentId: attachment.attachmentId,
      backendInstanceId: attachment.backendInstanceId,
      backendGeneration: attachment.backendGeneration,
      adapterId: attachment.adapter.adapterId,
      adapterGeneration: attachment.adapter.adapterGeneration
    })
  }

  private async startScan(
    options: OwnerScanOptions<string, string>,
    _clientId: ClientId<string, string>
  ): Promise<ScanLease<string, string>> {
    this.assertUsable('corebluetooth.scan.start')
    if (this.scanGroup !== null) {
      throw contractError('scan.already-active', 'scan', 'corebluetooth.scan.start')
    }
    this.operationLifecycle.assertAdmission(options, 'corebluetooth.scan.start')
    const identifiers = this.identifiers()
    const ordinal = this.nextScan
    this.nextScan += 1
    const consumer: ScanConsumer = {
      scanSessionId: identifiers.scanSessionId(`corebluetooth-scan-session-${ordinal}`),
      leaseId: identifiers.leaseId(`corebluetooth-scan-lease-${ordinal}`),
      shareToken: options.sharing.allowSharing
        ? identifiers.scanShareToken(`corebluetooth-scan-share-${ordinal}`)
        : null,
      options,
      stream: new CoreBoundedStream(options.delivery, options.delivery.overflowPolicy),
      abort: null,
      deadlineTimer: null
    }
    const group: ScanGroup = {
      ownerLeaseId: consumer.leaseId,
      shareToken: consumer.shareToken,
      consumers: new Map([[String(consumer.leaseId), consumer]]),
      state: 'starting'
    }
    this.scanGroup = group
    const abort = (): Promise<void> =>
      this.stopScanConsumer(consumer)
        .then(result => {
          if (result.state === 'release-failed') {
            console.error('[CoreBluetoothBackend.scan.abort] Native scan cleanup requires retry:', result.failures)
          }
        })
        .catch(error => {
          console.error('[CoreBluetoothBackend.scan.abort] Native scan cleanup rejected:', error)
        })
    consumer.abort = abort
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.deadline !== null) {
      consumer.deadlineTimer = setTimeout(abort, Math.max(0, options.deadline - this.now()))
    }
    try {
      await this.boundary.startScan(
        advertisement => this.handleAdvertisement(advertisement),
        options.filter.serviceUuids
      )
    } catch (error) {
      this.releaseScanConsumerAdmission(consumer)
      this.scanGroup = null
      throw this.operationLifecycle.platformError('scan.start-failed', 'scan', 'corebluetooth.scan.start', error)
    }
    if (this.scanGroup !== group || group.state === 'failed') {
      throw contractError('platform.failure', 'scan', 'corebluetooth.scan.start-failed')
    }
    if (group.state !== 'starting' || options.signal?.aborted === true) {
      await this.stopScanConsumer(consumer)
      throw contractError('operation.aborted', 'scan', 'corebluetooth.scan.start')
    }
    group.state = 'active'
    return new CoreBluetoothScanLease(this, consumer)
  }

  private async joinScan(
    leaseId: LeaseId<string, string>,
    token: ScanShareToken<string, string>,
    _clientId: ClientId<string, string>
  ): Promise<ScanLease<string, string>> {
    this.assertUsable('corebluetooth.scan.join')
    const group = this.scanGroup
    if (group === null || group.state !== 'active' || group.ownerLeaseId !== leaseId || group.shareToken !== token) {
      throw contractError('ownership.denied', 'scan', 'corebluetooth.scan.join')
    }
    const owner = group.consumers.get(String(group.ownerLeaseId))
    if (owner === undefined) {
      throw contractError('lifecycle.invariant-violation', 'scan', 'corebluetooth.scan.join.owner')
    }
    const identifiers = this.identifiers()
    const ordinal = this.nextScan
    this.nextScan += 1
    const consumer: ScanConsumer = {
      scanSessionId: owner.scanSessionId,
      leaseId: identifiers.leaseId(`corebluetooth-scan-lease-${ordinal}`),
      shareToken: null,
      options: owner.options,
      stream: new CoreBoundedStream(owner.options.delivery, owner.options.delivery.overflowPolicy),
      abort: null,
      deadlineTimer: null
    }
    group.consumers.set(String(consumer.leaseId), consumer)
    return new CoreBluetoothScanLease(this, consumer)
  }

  async stopScanConsumer(consumer: ScanConsumer): Promise<CleanupRecord> {
    const group = this.scanGroup
    if (group === null || !group.consumers.has(String(consumer.leaseId))) {
      this.releaseScanConsumerAdmission(consumer)
      consumer.stream.closeWithReason('owner-released')
      return releasedCleanup
    }
    if (consumer.leaseId !== group.ownerLeaseId) {
      group.consumers.delete(String(consumer.leaseId))
      consumer.stream.closeWithReason('owner-released')
      return releasedCleanup
    }
    group.state = 'stopping'
    for (const current of group.consumers.values()) {
      this.releaseScanConsumerAdmission(current)
      current.stream.closeWithReason('owner-released')
    }
    try {
      await this.boundary.stopScan()
    } catch (error) {
      return cleanupFailure('scan', 'corebluetooth.scan.stop', error)
    }
    group.consumers.clear()
    this.scanGroup = null
    return releasedCleanup
  }

  private releaseScanConsumerAdmission(consumer: ScanConsumer): void {
    if (consumer.abort !== null) {
      consumer.options.signal?.removeEventListener('abort', consumer.abort)
      consumer.abort = null
    }
    if (consumer.deadlineTimer !== null) {
      clearTimeout(consumer.deadlineTimer)
      consumer.deadlineTimer = null
    }
  }

  private handleAdvertisement(advertisement: CoreBluetoothAdvertisement): void {
    const group = this.scanGroup
    if (group === null || group.state !== 'active') {
      return
    }
    const peerId = this.peerIdForNativeId(advertisement.nativePeerId)
    const observation = this.createObservation(advertisement, peerId)
    for (const consumer of group.consumers.values()) {
      if (matchesScan(consumer.options, observation)) {
        consumer.stream.emit(observation, advertisementByteLength(observation), String(peerId))
      }
    }
  }

  private handleScanFailure(safeMessage: string): void {
    const group = this.scanGroup
    if (group === null || group.state === 'failed') {
      return
    }
    group.state = 'failed'
    for (const consumer of group.consumers.values()) {
      this.releaseScanConsumerAdmission(consumer)
      consumer.stream.closeWithReason('source-failed')
    }
    group.consumers.clear()
    this.scanGroup = null
    console.error('[CoreBluetoothBackend.handleScanFailure] Native scan failed:', safeMessage)
  }

  private async connect(
    peerId: PeerId<string>,
    clientId: ClientId<string, string>,
    options: PublicOperationOptions
  ): Promise<ConnectionLease<string, string, string>> {
    this.assertUsable('corebluetooth.connect')
    this.operationLifecycle.assertAdmission(options, 'corebluetooth.connect')
    const nativePeerId = this.nativeIdsByPeerId.get(String(peerId))
    if (nativePeerId === undefined) {
      throw contractError('connection.not-found', 'connection', 'corebluetooth.connect.peer')
    }
    const existing = this.connectionsByNativeId.get(nativePeerId)
    if (existing !== undefined && existing.state !== 'disconnected' && existing.state !== 'lost') {
      throw contractError('connection.already-owned', 'connection', 'corebluetooth.connect.owner')
    }
    const identifiers = this.identifiers()
    const record: ConnectionRecord = {
      nativePeerId,
      peerId,
      connectionId: identifiers.connectionId(`corebluetooth-connection-${this.nextConnection}`),
      connectionGeneration: opaqueId(
        `corebluetooth-connection-generation-${this.nextConnection}`,
        'connection-generation',
        'corebluetooth'
      ),
      ownerLeaseId: identifiers.leaseId(`corebluetooth-connection-lease-${this.nextLease}`),
      ownerClientId: clientId,
      state: 'connecting',
      database: null,
      lease: null
    }
    this.nextConnection += 1
    this.nextLease += 1
    this.connectionsByNativeId.set(nativePeerId, record)
    try {
      await this.operationLifecycle.awaitBoundaryOperation(
        options,
        'corebluetooth.connect',
        () => this.boundary.connect(nativePeerId),
        async () => {
          if (this.boundary.connectionState(nativePeerId) === 'connected') {
            await this.boundary.disconnect(nativePeerId)
          }
        }
      )
    } catch (error) {
      this.connectionsByNativeId.delete(nativePeerId)
      throw error
    }
    if (this.admissionClosed) {
      await this.boundary.disconnect(nativePeerId)
      this.connectionsByNativeId.delete(nativePeerId)
      throw contractError('operation.cancelled-by-destroy', 'connection', 'corebluetooth.connect.destroyed')
    }
    record.state = 'connected'
    const connection = new CoreBluetoothConnection(this, record)
    const lease = new CoreBluetoothConnectionLease(this, record, connection)
    record.lease = lease
    return lease
  }

  async releaseConnectionLease(lease: CoreBluetoothConnectionLease): Promise<CleanupRecord> {
    const record = lease.record
    if (record.lease !== lease) {
      return releasedCleanup
    }
    return this.disconnect(record, 'corebluetooth.connection.release')
  }

  async disconnect(record: ConnectionRecord, operation: string): Promise<CleanupRecord> {
    if (record.state === 'disconnected' || record.state === 'lost') {
      return releasedCleanup
    }
    record.state = 'disconnecting'
    const subscriptionCleanup = await this.removeConnectionSubscriptions(record, 'connection-lost')
    const failures: CleanupFailure[] = [...subscriptionCleanup.failures]
    try {
      await this.boundary.disconnect(record.nativePeerId)
    } catch (error) {
      record.state = 'connected'
      failures.push(cleanupFailureDetail('connection', operation, error))
      return Object.freeze({ state: 'release-failed', failures: Object.freeze(failures) })
    }
    this.invalidateRecord(record)
    return failures.length === 0
      ? releasedCleanup
      : Object.freeze({ state: 'release-failed', failures: Object.freeze(failures) })
  }

  private handleDisconnect(nativePeerId: string, safeMessage: string | null): void {
    const record = this.connectionsByNativeId.get(nativePeerId)
    if (record === undefined || record.state === 'disconnected' || record.state === 'lost') {
      return
    }
    const connectionPath = connectionPathFor(this.attachment(), record)
    this.invalidateRecord(record)
    const attachment = this.attachment()
    this.broadcastEvent({
      attachment,
      attachmentId: attachment.attachmentId,
      kind: 'connection-lost',
      connection: connectionPath,
      ingressOrdinal: this.nextIngressOrdinal
    })
    this.nextIngressOrdinal += 1
    if (safeMessage !== null) {
      console.error('[CoreBluetoothBackend.handleDisconnect] Native link loss:', safeMessage)
    }
  }

  private handleAdapterState(state: CoreBluetoothAdapterSnapshot): void {
    this.adapterStateSnapshot = state
    if (this.destroyed) {
      return
    }
    if (state.power === 'resetting' || state.availability === 'unavailable') {
      this.advanceGeneration()
      return
    }
    const snapshot = this.adapterState()
    for (const stream of this.stateStreams) {
      stream.emit(snapshot, 96, String(snapshot.backendGeneration))
    }
    const attachment = this.attachment()
    this.broadcastEvent({
      attachment,
      attachmentId: attachment.attachmentId,
      kind: 'adapter-state',
      ingressOrdinal: this.nextIngressOrdinal
    })
    this.nextIngressOrdinal += 1
  }

  private advanceGeneration(): void {
    this.backendGeneration += 1
    this.adapterGeneration += 1
    if (this.scanGroup !== null) {
      for (const consumer of this.scanGroup.consumers.values()) {
        this.releaseScanConsumerAdmission(consumer)
        consumer.stream.closeWithReason('source-failed')
      }
      this.scanGroup = null
    }
    for (const physical of this.subscriptions.values()) {
      for (const subscription of physical.consumers) {
        subscription.stream.closeWithReason('source-failed')
        subscription.removed = true
      }
    }
    this.subscriptions.clear()
    for (const record of this.connectionsByNativeId.values()) {
      this.invalidateRecord(record)
    }
    this.peerIdsByNativeId.clear()
    this.nativeIdsByPeerId.clear()
    const attachment = this.attachment()
    this.broadcastEvent({
      attachment,
      attachmentId: attachment.attachmentId,
      kind: 'backend-restarted',
      ingressOrdinal: this.nextIngressOrdinal
    })
    this.nextIngressOrdinal += 1
  }

  private invalidateRecord(record: ConnectionRecord): void {
    record.state = 'lost'
    record.database?.invalidate()
    record.database = null
    record.lease?.markReleased()
    record.lease = null
    this.connectionsByNativeId.delete(record.nativePeerId)
    for (const physical of [...this.subscriptions.values()]) {
      if (physical.address.nativePeerId !== record.nativePeerId) {
        continue
      }
      for (const consumer of physical.consumers) {
        consumer.stream.closeWithReason('connection-lost')
        consumer.removed = true
      }
      physical.consumers.clear()
      this.subscriptions.delete(physical.key)
    }
  }

  private async removeConnectionSubscriptions(
    record: ConnectionRecord,
    reason: 'connection-lost' | 'owner-released'
  ): Promise<CleanupRecord> {
    const failures: CleanupFailure[] = []
    for (const physical of [...this.subscriptions.values()]) {
      if (physical.address.nativePeerId !== record.nativePeerId) {
        continue
      }
      for (const consumer of physical.consumers) {
        consumer.stream.closeWithReason(reason)
        consumer.removed = true
      }
      physical.consumers.clear()
      const cleanup = await this.gattOperations.stopPhysicalSubscription(physical)
      failures.push(...cleanup.failures)
    }
    return failures.length === 0
      ? releasedCleanup
      : Object.freeze({ state: 'release-failed', failures: Object.freeze(failures) })
  }

  requireConnection(connection: BackendConnection<string, string>, operation: string): ConnectionRecord {
    if (!(connection instanceof CoreBluetoothConnection)) {
      throw contractError('ownership.denied', 'connection', operation)
    }
    const record = connection.record
    if (
      record.state !== 'connected' ||
      this.connectionsByNativeId.get(record.nativePeerId) !== record ||
      !attachmentRecordsEqual(connection.attachment, this.attachment())
    ) {
      throw contractError('connection.stale', 'connection', operation)
    }
    return record
  }

  databaseForPath(
    path: CharacteristicPath<string, string, string, string, string, 'current'>,
    operation: string
  ): CoreBluetoothGattDatabase {
    for (const record of this.connectionsByNativeId.values()) {
      const database = record.database
      if (database !== null && database.matchesPath(path)) {
        database.assertCurrent(operation)
        return database
      }
    }
    throw contractError('gatt.stale-handle', 'gatt', operation)
  }

  private peerIdForNativeId(nativePeerId: string): PeerId<string> {
    const existing = this.peerIdsByNativeId.get(nativePeerId)
    if (existing !== undefined) {
      return existing
    }
    const peerId = opaqueId(`corebluetooth-peer-${this.backendGeneration}-${this.nextPeer}`, 'peer', 'corebluetooth')
    this.nextPeer += 1
    this.peerIdsByNativeId.set(nativePeerId, peerId)
    this.nativeIdsByPeerId.set(String(peerId), nativePeerId)
    return peerId
  }

  private createObservation(
    advertisement: CoreBluetoothAdvertisement,
    peerId: PeerId<string>
  ): AdvertisementObservation<string> {
    const unavailable = Object.freeze({
      state: 'unavailable' as const,
      reason: 'CoreBluetooth boundary does not expose this advertisement field',
      provenance: 'not-provided' as const
    })
    const serviceUuids =
      advertisement.serviceUuids === null
        ? unavailable
        : Object.freeze({
            state: 'present' as const,
            value: Object.freeze(advertisement.serviceUuids.map(canonicalUuid)),
            provenance: 'observed' as const
          })
    return Object.freeze({
      peerId,
      observedAt: monotonicTimestamp(this.now()),
      source: 'platform-derived',
      ingressOrdinal: this.nextIngressOrdinal++,
      localName:
        advertisement.localName === null
          ? unavailable
          : Object.freeze({ state: 'present', value: advertisement.localName, provenance: 'observed' }),
      rssi:
        advertisement.rssi === null
          ? unavailable
          : Object.freeze({ state: 'present', value: advertisement.rssi, provenance: 'observed' }),
      txPower: unavailable,
      connectable: unavailable,
      appearance: unavailable,
      serviceUuids,
      solicitedServiceUuids: unavailable,
      overflowServiceUuids: unavailable,
      serviceData: unavailable,
      manufacturerData: unavailable,
      rawRecord: unavailable,
      scanResponseRecord: unavailable
    })
  }

  assertGattSnapshot(snapshot: CoreBluetoothGattSnapshot): void {
    const serviceOccurrences = new Set<number>()
    for (const service of snapshot.services) {
      if (
        !Number.isInteger(service.occurrence) ||
        service.occurrence < 0 ||
        serviceOccurrences.has(service.occurrence)
      ) {
        throw contractError('protocol.malformed', 'gatt', 'corebluetooth.gatt.snapshot.service-occurrence')
      }
      serviceOccurrences.add(service.occurrence)
      const characteristicOccurrences = new Set<number>()
      for (const characteristic of service.characteristics) {
        if (
          !Number.isInteger(characteristic.occurrence) ||
          characteristic.occurrence < 0 ||
          characteristicOccurrences.has(characteristic.occurrence)
        ) {
          throw contractError('protocol.malformed', 'gatt', 'corebluetooth.gatt.snapshot.characteristic-occurrence')
        }
        characteristicOccurrences.add(characteristic.occurrence)
      }
    }
  }

  private broadcastEvent(event: BackendEvent<string>): void {
    for (const stream of this.eventStreams) {
      stream.emit(event, 128)
    }
  }

  private async destroyInternal(): Promise<CleanupRecord> {
    this.admissionClosed = true
    this.dispatcher.cancelAll()
    const failures: CleanupFailure[] = []
    if (this.scanGroup !== null) {
      const owner = this.scanGroup.consumers.get(String(this.scanGroup.ownerLeaseId))
      if (owner !== undefined) {
        const cleanup = await this.stopScanConsumer(owner)
        failures.push(...cleanup.failures)
      }
    }
    for (const physical of [...this.subscriptions.values()]) {
      for (const subscription of physical.consumers) {
        subscription.stream.closeWithReason('owner-released')
        subscription.removed = true
      }
      physical.consumers.clear()
      const cleanup = await this.gattOperations.stopPhysicalSubscription(physical)
      failures.push(...cleanup.failures)
    }
    for (const record of [...this.connectionsByNativeId.values()]) {
      const cleanup = await this.disconnect(record, 'corebluetooth.destroy.connection')
      failures.push(...cleanup.failures)
    }
    if (failures.length > 0) {
      return Object.freeze({ state: 'release-failed', failures: Object.freeze(failures) })
    }
    try {
      this.disconnectListener()
      this.scanFailureListener?.()
      this.adapterStateListener()
      await this.boundary.destroy()
    } catch (error) {
      return cleanupFailure('boundary', 'corebluetooth.destroy.boundary', error)
    }
    this.destroyed = true
    for (const stream of this.eventStreams) {
      stream.closeWithReason('owner-released')
    }
    this.eventStreams.clear()
    for (const stream of this.stateStreams) {
      stream.closeWithReason('owner-released')
    }
    this.stateStreams.clear()
    return releasedCleanup
  }
}
