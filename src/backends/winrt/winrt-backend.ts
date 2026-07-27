// src/backends/winrt/winrt-backend.ts

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
import type { CharacteristicPath, DescriptorPath } from '../../backend-contract/gatt'
import { attachmentRecordsEqual } from '../../backend-contract/identity'
import type {
  AdapterStateSnapshot,
  AdapterStateWatch,
  AttachmentRecord,
  HostNeutralBackendIdentity
} from '../../backend-contract/identity'
import type { PublicOperationOptions } from '../../backend-contract/operations'
import {
  capacity,
  canonicalUuid,
  createAttachmentBoundIdFactory,
  monotonicTimestamp,
  negotiateCoreVersions,
  opaqueId,
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
import {
  WinRtConnection,
  WinRtConnectionLease,
  WinRtGattDatabase,
  WinRtBackendSubscription,
  WinRtScanLease,
  advertisementByteLength,
  cleanupFailure,
  matchesScan,
  releasedCleanup,
} from './winrt-handles'
import { WinRtGattOperations } from './winrt-gatt-operations'
import {
  assertWinRtOperationAdmission,
  broadcastWinRtEvent,
  combineWinRtCleanup,
  winRtPlatformError,
  winRtResourceCounters
} from './winrt-backend-helpers'
import { assertWinRtAdapterReady, winRtAdapterIsReady, winRtAdapterState } from './winrt-adapter-state'
import { WinRtOperationDispatcher } from './winrt-operation-dispatcher'
import {
  WINRT_BACKEND_ID,
  WINRT_IMPLEMENTATION_VERSION,
  WINRT_PLATFORM_ID,
  adapterDescriptor,
  winRtCompatibility
} from './winrt-provider'
import type {
  WinRtAdapterRecord,
  WinRtAdapterSnapshot,
  WinRtBoundary,
  WinRtCharacteristicAddress
} from './winrt-boundary'
import { stopWinRtPhysicalSubscription } from './winrt-subscription-runtime'

const eventLimits = Object.freeze({
  itemCapacity: capacity(64),
  byteCapacity: capacity(64 * 1024),
  reservedControlCapacity: capacity(1)
})
const adapterStateLimits = Object.freeze({
  itemCapacity: capacity(16),
  byteCapacity: capacity(16 * 1024),
  reservedControlCapacity: capacity(1)
})

export interface WinRtScanConsumer {
  readonly scanSessionId: ScanSessionId<string, string>
  readonly leaseId: LeaseId<string, string>
  readonly shareToken: ScanShareToken<string, string> | null
  readonly options: OwnerScanOptions<string, string>
  readonly stream: CoreBoundedStream<AdvertisementObservation<string>>
  abort: (() => void) | null
  deadlineTimer: ReturnType<typeof setTimeout> | null
  released: boolean
}

interface WinRtScanGroup {
  readonly ownerLeaseId: LeaseId<string, string>
  readonly shareToken: ScanShareToken<string, string> | null
  readonly consumers: Map<string, WinRtScanConsumer>
  state: 'starting' | 'active' | 'stopping'
  stopResult: Promise<CleanupRecord> | null
}

export interface WinRtConnectionRecord {
  readonly nativePeerId: string
  readonly peerId: PeerId<string>
  readonly connectionId: ConnectionId<string, string>
  readonly connectionGeneration: GenerationId<'connection-generation', string>
  readonly ownerLeaseId: LeaseId<string, string>
  readonly ownerClientId: ClientId<string, string>
  state: 'connecting' | 'connected' | 'disconnecting' | 'disconnected' | 'lost'
  database: WinRtGattDatabase | null
  lease: WinRtConnectionLease | null
}

export interface WinRtPhysicalSubscription {
  readonly key: string
  readonly address: WinRtCharacteristicAddress
  readonly mode: 'notify' | 'indicate'
  readonly consumers: Set<WinRtBackendSubscription>
  state: 'enabling' | 'ready' | 'removing'
  removal: Promise<CleanupRecord> | null
}

let nextBackendInstance = 1

function allocateBackendInstance(): number {
  const allocated = nextBackendInstance
  nextBackendInstance += 1
  return allocated
}

/**
 * First-party Windows central backend. It owns one selected WinRT adapter and
 * retains native operation ownership until cancellation is acknowledged or a
 * late native completion has been quarantined.
 */
export class WinRtBackend implements BleCentralBackend<string, HostNeutralBackendIdentity<string>> {
  readonly features = createFeatureRegistry([])
  readonly adapter: AdapterBackend<string>
  readonly scanner: ScannerBackend<string>
  readonly connections: ConnectionBackend<string>
  readonly gatt: GattBackend<string>
  readonly dispatcher: WinRtOperationDispatcher
  readonly subscriptions = new Map<string, WinRtPhysicalSubscription>()
  private readonly backendInstanceId: BackendInstanceId<string>
  private readonly eventStreams = new Set<CoreBoundedStream<BackendEvent<string>>>()
  private readonly stateStreams = new Set<CoreBoundedStream<AdapterStateSnapshot<string>>>()
  private readonly peerIdsByNativeId = new Map<string, PeerId<string>>()
  private readonly nativeIdsByPeerId = new Map<string, string>()
  private readonly connectionsByNativeId = new Map<string, WinRtConnectionRecord>()
  private readonly removeConnectionListener: () => void
  private readonly removeDatabaseListener: () => void
  private readonly removeAdapterStateListener: () => void
  private adapterStateSnapshot: WinRtAdapterSnapshot
  private attached = false
  private admissionClosed = false
  private destroyed = false
  private destroyResult: Promise<CleanupRecord> | null = null
  private scanGroup: WinRtScanGroup | null = null
  private backendGeneration = 1
  private adapterGeneration = 1
  private nextPeer = 1
  private nextScan = 1
  private nextConnection = 1
  private nextLease = 1
  nextDatabase = 1
  nextSubscription = 1
  private nextIngressOrdinal = 1
  readonly gattOperations: WinRtGattOperations

  constructor(
    readonly boundary: WinRtBoundary,
    readonly selectedAdapter: WinRtAdapterRecord,
    readonly now: () => number,
    private readonly hostKind: 'node' | 'electron-main'
  ) {
    this.backendInstanceId = opaqueId(`winrt-backend-${allocateBackendInstance()}`, 'backend-instance', 'winrt')
    this.adapterStateSnapshot = boundary.adapterSnapshot()
    this.dispatcher = new WinRtOperationDispatcher({
      now,
      onLateSuccess: operation => console.info(`[WinRtBackend] Late WinRT completion quarantined: ${operation}`),
      onLateFailure: (operation, error) => console.error(`[WinRtBackend] Late WinRT completion failed: ${operation}`, error),
      onCancellationFailure: (operation, error) =>
        console.error(`[WinRtBackend] WinRT cancellation acknowledgement failed: ${operation}`, error)
    })
    this.gattOperations = new WinRtGattOperations(this)
    this.adapter = Object.freeze({
      currentState: async () => winRtAdapterState(this.adapterStateSnapshot, this.backendGeneration, this.now),
      watchState: async () => this.watchAdapterState()
    })
    this.scanner = Object.freeze({
      start: this.startScan.bind(this),
      join: this.joinScan.bind(this)
    })
    this.connections = Object.freeze({
      connect: this.connect.bind(this)
    })
    this.gatt = Object.freeze({
      discover: this.gattOperations.discover.bind(this.gattOperations),
      read: this.gattOperations.read.bind(this.gattOperations),
      write: this.gattOperations.write.bind(this.gattOperations),
      readDescriptor: this.gattOperations.readDescriptor.bind(this.gattOperations),
      writeDescriptor: this.gattOperations.writeDescriptor.bind(this.gattOperations),
      subscribe: this.gattOperations.subscribe.bind(this.gattOperations),
      unsubscribe: this.gattOperations.unsubscribe.bind(this.gattOperations)
    })
    this.removeConnectionListener = boundary.onConnectionLost((nativePeerId, safeReason) => {
      this.handleConnectionLoss(nativePeerId, safeReason)
    })
    this.removeDatabaseListener = boundary.onDatabaseChanged(nativePeerId => {
      this.handleDatabaseChanged(nativePeerId)
    })
    this.removeAdapterStateListener = boundary.onAdapterState(state => {
      this.handleAdapterState(state)
    })
  }

  get identity(): HostNeutralBackendIdentity<string> {
    const attachment = this.attachment()
    return Object.freeze({
      registeredBackendId: WINRT_BACKEND_ID,
      registeredPlatformId: WINRT_PLATFORM_ID,
      attachment,
      versions: negotiateCoreVersions(winRtCompatibility, winRtCompatibility),
      runtime: Object.freeze({
        hostKind: this.hostKind,
        implementationVersion: WINRT_IMPLEMENTATION_VERSION,
        diagnostics: Object.freeze({
          boundary: 'winrt-direct-v1',
          deployment: this.selectedAdapter.deployment,
          packagedCapability: this.selectedAdapter.packagedCapability
        })
      })
    })
  }

  async attach(request: BackendAttachmentRequest): Promise<BackendAttachment<string, HostNeutralBackendIdentity<string>>> {
    this.assertUsable('winrt.attach')
    if (this.attached) {
      throw contractError('lifecycle.invalid-state', 'core', 'winrt.attach')
    }
    negotiateCoreVersions(winRtCompatibility, request.coreCompatibility)
    assertWinRtAdapterReady(this.selectedAdapter, this.adapterStateSnapshot, 'winrt.attach')
    this.attached = true
    const identity = this.identity
    return Object.freeze({ attachment: identity.attachment, identity })
  }

  events(): BoundedAsyncStream<BackendEvent<string>> {
    this.assertUsable('winrt.events')
    const stream = new CoreBoundedStream<BackendEvent<string>>(eventLimits, 'error')
    this.eventStreams.add(stream)
    return stream
  }

  resourceCounters(): ResourceCounters {
    return winRtResourceCounters(
      this.scanGroup === null ? 0 : 1,
      this.scanGroup?.consumers.size ?? 0,
      this.connectionsByNativeId.values(),
      this.subscriptions.values(),
      this.dispatcher.activeCount()
    )
  }

  destroy(): Promise<CleanupRecord> {
    if (this.destroyResult === null) {
      this.destroyResult = this.destroyInternal().then(result => {
        if (result.state === 'release-failed') {
          this.destroyResult = null
        }
        return result
      })
    }
    return this.destroyResult
  }

  attachment(): AttachmentRecord<string> {
    const descriptor = adapterDescriptor(
      { ...this.selectedAdapter, state: this.adapterStateSnapshot },
      this.now
    )
    const backendGeneration = opaqueId(String(this.backendGeneration), 'backend-generation', 'winrt')
    return Object.freeze({
      attachmentId: opaqueId(
        `${String(this.backendInstanceId)}:${this.backendGeneration}:${this.adapterGeneration}`,
        'attachment',
        'winrt'
      ),
      backendInstanceId: this.backendInstanceId,
      backendGeneration,
      adapter: Object.freeze({
        ...descriptor,
        state: Object.freeze({ ...descriptor.state, backendGeneration }),
        adapterGeneration: opaqueId(String(this.adapterGeneration), 'adapter-generation', 'winrt')
      })
    })
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

  assertUsable(operation: string): void {
    if (this.admissionClosed || this.destroyed) {
      throw contractError('lifecycle.destroyed', 'core', operation)
    }
  }

  requireConnection(connection: BackendConnection<string, string>, operation: string): WinRtConnectionRecord {
    const record = this.connectionsByNativeId.get(this.nativeIdsByPeerId.get(String(connection.peerId)) ?? '')
    if (
      record === undefined ||
      record.connectionId !== connection.connectionId ||
      record.connectionGeneration !== connection.connectionGeneration ||
      !attachmentRecordsEqual(connection.attachment, this.attachment()) ||
      connection.attachmentId !== this.attachment().attachmentId
    ) {
      throw contractError('connection.stale', 'connection', operation)
    }
    if (record.state !== 'connected') {
      throw contractError(record.state === 'lost' ? 'connection.lost' : 'connection.stale', 'connection', operation)
    }
    return record
  }

  databaseForPath(path: CharacteristicPath<string, string, string, string, string, 'current'>, operation: string): WinRtGattDatabase {
    const nativePeerId = this.nativeIdsByPeerId.get(String(path.peerId))
    const record = nativePeerId === undefined ? undefined : this.connectionsByNativeId.get(nativePeerId)
    const database = record?.database
    if (database === null || database === undefined || !database.matchesPath(path)) {
      throw contractError('gatt.stale-handle', 'gatt', operation)
    }
    database.assertCurrent(operation)
    return database
  }

  descriptorDatabaseForPath(path: DescriptorPath<string, string, string, string, string, string, 'current'>, operation: string): WinRtGattDatabase {
    return this.databaseForPath(path, operation)
  }

  async disconnect(record: WinRtConnectionRecord, operation: string): Promise<CleanupRecord> {
    if (record.state === 'disconnected' || record.state === 'lost') {
      return releasedCleanup
    }
    record.state = 'disconnecting'
    const invalidation = await this.invalidateConnectionChildren(record, 'owner-released')
    const native = this.boundary.disconnect(record.nativePeerId)
    try {
      await native.completion
    } catch (error) {
      return combineWinRtCleanup(invalidation, cleanupFailure('connection', operation, error))
    }
    record.state = 'disconnected'
    record.lease?.markReleased()
    this.connectionsByNativeId.delete(record.nativePeerId)
    return invalidation
  }

  async releaseConnectionLease(lease: WinRtConnectionLease): Promise<CleanupRecord> {
    return this.disconnect(lease.record, 'winrt.connection.release')
  }

  async stopScanConsumer(consumer: WinRtScanConsumer): Promise<CleanupRecord> {
    const group = this.scanGroup
    if (group === null || !group.consumers.has(String(consumer.leaseId))) {
      this.releaseScanAdmission(consumer)
      consumer.stream.closeWithReason('owner-released')
      return releasedCleanup
    }
    if (!consumer.released) {
      consumer.released = true
      this.releaseScanAdmission(consumer)
      consumer.stream.closeWithReason('owner-released')
    }
    const remaining = [...group.consumers.values()].some(candidate => !candidate.released)
    if (remaining) {
      group.consumers.delete(String(consumer.leaseId))
      return releasedCleanup
    }
    if (group.stopResult !== null) {
      return group.stopResult
    }
    group.state = 'stopping'
    const stop = this.boundary.stopScan().completion.then(
      () => {
        group.consumers.clear()
        if (this.scanGroup === group) {
          this.scanGroup = null
        }
        return releasedCleanup
      },
      error => {
        group.stopResult = null
        return cleanupFailure('scan', 'winrt.scan.stop', error)
      }
    )
    group.stopResult = stop
    return stop
  }

  private watchAdapterState(): AdapterStateWatch<string> {
    const stream = new CoreBoundedStream<AdapterStateSnapshot<string>>(adapterStateLimits, 'latest')
    this.stateStreams.add(stream)
    return Object.freeze({
      initial: winRtAdapterState(this.adapterStateSnapshot, this.backendGeneration, this.now),
      transitions: stream
    })
  }

  private async startScan(
    options: OwnerScanOptions<string, string>,
    _clientId: ClientId<string, string>
  ): Promise<ScanLease<string, string>> {
    this.assertUsable('winrt.scan.start')
    assertWinRtAdapterReady(this.selectedAdapter, this.adapterStateSnapshot, 'winrt.scan.start')
    assertWinRtOperationAdmission(options, this.now, 'winrt.scan.start')
    if (this.scanGroup !== null) {
      throw contractError('scan.already-active', 'scan', 'winrt.scan.start')
    }
    const ids = this.identifiers()
    const ordinal = this.nextScan
    this.nextScan += 1
    const consumer: WinRtScanConsumer = {
      scanSessionId: ids.scanSessionId(`winrt-scan-session-${ordinal}`),
      leaseId: ids.leaseId(`winrt-scan-lease-${ordinal}`),
      shareToken: options.sharing.allowSharing ? ids.scanShareToken(`winrt-scan-share-${ordinal}`) : null,
      options,
      stream: new CoreBoundedStream(options.delivery, options.delivery.overflowPolicy),
      abort: null,
      deadlineTimer: null,
      released: false
    }
    const group: WinRtScanGroup = {
      ownerLeaseId: consumer.leaseId,
      shareToken: consumer.shareToken,
      consumers: new Map([[String(consumer.leaseId), consumer]]),
      state: 'starting',
      stopResult: null
    }
    this.scanGroup = group
    const closeForAbort = (): void => {
      void this.stopScanConsumer(consumer).then(
        result => {
          if (result.state === 'release-failed') {
            console.error('[WinRtBackend.scan] Abort cleanup requires retry:', result.failures)
          }
        },
        error => console.error('[WinRtBackend.scan] Abort cleanup rejected:', error)
      )
    }
    consumer.abort = closeForAbort
    options.signal?.addEventListener('abort', closeForAbort, { once: true })
    if (options.deadline !== null) {
      consumer.deadlineTimer = setTimeout(closeForAbort, Math.max(0, options.deadline - this.now()))
    }
    const dispatch = this.dispatcher.dispatch(options, 'winrt.scan.start', () =>
      this.boundary.startScan(options.filter.serviceUuids, advertisement => this.handleAdvertisement(advertisement)),
      async () => {
        await this.boundary.stopScan().completion
      }
    )
    try {
      await dispatch.completion
    } catch (error) {
      this.releaseScanAdmission(consumer)
      if (this.scanGroup === group) {
        this.scanGroup = null
      }
      throw winRtPlatformError('scan.start-failed', 'scan', 'winrt.scan.start', error)
    }
    if (group.state !== 'starting' || consumer.released) {
      await this.stopScanConsumer(consumer)
      throw contractError('operation.aborted', 'scan', 'winrt.scan.start')
    }
    group.state = 'active'
    return new WinRtScanLease(this, consumer)
  }

  private async joinScan(
    ownerLeaseId: LeaseId<string, string>,
    token: ScanShareToken<string, string>,
    _clientId: ClientId<string, string>
  ): Promise<ScanLease<string, string>> {
    this.assertUsable('winrt.scan.join')
    const group = this.scanGroup
    const owner = group?.consumers.get(String(ownerLeaseId))
    if (
      group === null ||
      group.state !== 'active' ||
      group.ownerLeaseId !== ownerLeaseId ||
      group.shareToken !== token ||
      owner === undefined ||
      owner.released
    ) {
      throw contractError('ownership.denied', 'scan', 'winrt.scan.join')
    }
    const ids = this.identifiers()
    const ordinal = this.nextScan
    this.nextScan += 1
    const consumer: WinRtScanConsumer = {
      scanSessionId: owner.scanSessionId,
      leaseId: ids.leaseId(`winrt-scan-lease-${ordinal}`),
      shareToken: null,
      options: owner.options,
      stream: new CoreBoundedStream(owner.options.delivery, owner.options.delivery.overflowPolicy),
      abort: null,
      deadlineTimer: null,
      released: false
    }
    group.consumers.set(String(consumer.leaseId), consumer)
    return new WinRtScanLease(this, consumer)
  }

  private async connect(
    peerId: PeerId<string>,
    clientId: ClientId<string, string>,
    options: PublicOperationOptions
  ): Promise<ConnectionLease<string, string, string>> {
    this.assertUsable('winrt.connect')
    assertWinRtAdapterReady(this.selectedAdapter, this.adapterStateSnapshot, 'winrt.connect')
    assertWinRtOperationAdmission(options, this.now, 'winrt.connect')
    const nativePeerId = this.nativeIdsByPeerId.get(String(peerId))
    if (nativePeerId === undefined) {
      throw contractError('connection.not-found', 'connection', 'winrt.connect.peer')
    }
    if (this.connectionsByNativeId.has(nativePeerId)) {
      throw contractError('connection.already-owned', 'connection', 'winrt.connect.owner')
    }
    const ids = this.identifiers()
    const record: WinRtConnectionRecord = {
      nativePeerId,
      peerId,
      connectionId: ids.connectionId(`winrt-connection-${this.nextConnection}`),
      connectionGeneration: opaqueId(String(this.nextConnection), 'connection-generation', 'winrt'),
      ownerLeaseId: ids.leaseId(`winrt-connection-lease-${this.nextLease}`),
      ownerClientId: clientId,
      state: 'connecting',
      database: null,
      lease: null
    }
    this.nextConnection += 1
    this.nextLease += 1
    this.connectionsByNativeId.set(nativePeerId, record)
    const dispatch = this.dispatcher.dispatch(
      options,
      'winrt.connect',
      () => this.boundary.connect(nativePeerId),
      async () => {
        record.state = 'disconnecting'
        await this.boundary.disconnect(nativePeerId).completion
        record.state = 'disconnected'
        this.connectionsByNativeId.delete(nativePeerId)
      }
    )
    try {
      await dispatch.completion
    } catch (error) {
      if (this.dispatcher.activeCount() === 0 && record.state === 'connecting') {
        this.connectionsByNativeId.delete(nativePeerId)
        record.state = 'disconnected'
      }
      throw winRtPlatformError('connection.failed', 'connection', 'winrt.connect', error)
    }
    if (record.state !== 'connecting') {
      throw contractError('operation.cancelled-by-destroy', 'connection', 'winrt.connect')
    }
    record.state = 'connected'
    const connection = new WinRtConnection(this, record)
    const lease = new WinRtConnectionLease(this, record, connection)
    record.lease = lease
    return lease
  }

  private handleAdvertisement(advertisement: import('./winrt-boundary').WinRtAdvertisement): void {
    const group = this.scanGroup
    if (group === null || group.state !== 'active') {
      return
    }
    const peerId = this.peerIdForNativeId(advertisement.nativePeerId)
    const absent = (reason: string) => Object.freeze({ state: 'absent' as const, reason, provenance: 'not-provided' as const })
    const observation: AdvertisementObservation<string> = Object.freeze({
      peerId,
      observedAt: monotonicTimestamp(this.now()),
      source: 'platform-raw',
      ingressOrdinal: this.nextIngressOrdinal,
      localName:
        advertisement.localName === null
          ? absent('winrt-not-provided')
          : Object.freeze({ state: 'present', value: advertisement.localName, provenance: 'observed' }),
      rssi:
        advertisement.rssi === null
          ? absent('winrt-not-provided')
          : Object.freeze({ state: 'present', value: advertisement.rssi, provenance: 'observed' }),
      txPower: absent('winrt-not-provided'),
      connectable:
        advertisement.connectable === null
          ? absent('winrt-not-provided')
          : Object.freeze({ state: 'present', value: advertisement.connectable, provenance: 'observed' }),
      appearance: absent('winrt-not-provided'),
      serviceUuids:
        advertisement.serviceUuids === null
          ? absent('winrt-not-provided')
          : Object.freeze({ state: 'present', value: Object.freeze(advertisement.serviceUuids.map(canonicalUuid)), provenance: 'observed' }),
      solicitedServiceUuids: absent('winrt-not-provided'),
      overflowServiceUuids: absent('winrt-not-provided'),
      serviceData: absent('winrt-not-provided'),
      manufacturerData: absent('winrt-not-provided'),
      rawRecord: absent('winrt-raw-advertisement-not-provided'),
      scanResponseRecord: absent('winrt-scan-response-not-provided')
    })
    this.nextIngressOrdinal += 1
    for (const consumer of group.consumers.values()) {
      if (!consumer.released && matchesScan(consumer.options, observation)) {
        consumer.stream.emit(observation, advertisementByteLength(observation), String(peerId))
      }
    }
  }

  private peerIdForNativeId(nativePeerId: string): PeerId<string> {
    const existing = this.peerIdsByNativeId.get(nativePeerId)
    if (existing !== undefined) {
      return existing
    }
    const peerId = opaqueId(`winrt-peer-${this.nextPeer}`, 'peer', String(this.backendInstanceId))
    this.nextPeer += 1
    this.peerIdsByNativeId.set(nativePeerId, peerId)
    this.nativeIdsByPeerId.set(String(peerId), nativePeerId)
    return peerId
  }

  private handleConnectionLoss(nativePeerId: string, safeReason: string | null): void {
    const record = this.connectionsByNativeId.get(nativePeerId)
    if (record === undefined || record.state === 'lost' || record.state === 'disconnected') {
      return
    }
    const connectionPath = Object.freeze({
      attachment: this.attachment(),
      attachmentId: this.attachment().attachmentId,
      peerId: record.peerId,
      connectionId: record.connectionId,
      ownerLeaseId: record.ownerLeaseId,
      connectionGeneration: record.connectionGeneration
    })
    record.state = 'lost'
    void this.invalidateConnectionChildren(record, 'connection-lost').then(
      result => {
        if (result.state === 'release-failed') {
          console.error('[WinRtBackend.connection-loss] Resource cleanup requires retry:', result.failures)
        }
      },
      error => console.error('[WinRtBackend.connection-loss] Resource cleanup rejected:', error)
    )
    const attachment = this.attachment()
    broadcastWinRtEvent(this.eventStreams, {
      attachment,
      attachmentId: attachment.attachmentId,
      kind: 'connection-lost',
      connection: connectionPath,
      ingressOrdinal: this.nextIngressOrdinal
    })
    this.nextIngressOrdinal += 1
    record.lease?.markReleased()
    record.lease = null
    this.connectionsByNativeId.delete(nativePeerId)
    if (safeReason !== null) {
      console.info('[WinRtBackend.connection-loss] WinRT reported connection loss:', safeReason)
    }
  }

  private handleDatabaseChanged(nativePeerId: string): void {
    const record = this.connectionsByNativeId.get(nativePeerId)
    const database = record?.database
    if (record === undefined || database === null || database === undefined || record.state !== 'connected') {
      return
    }
    database.invalidate()
    record.database = null
    void this.invalidateConnectionChildren(record, 'connection-lost').then(
      cleanup => {
        if (cleanup.state === 'release-failed') {
          console.error('[WinRtBackend.database-changed] Subscription cleanup requires retry:', cleanup.failures)
        }
      },
      error => console.error('[WinRtBackend.database-changed] Subscription cleanup rejected:', error)
    )
    const attachment = this.attachment()
    broadcastWinRtEvent(this.eventStreams, {
      attachment,
      attachmentId: attachment.attachmentId,
      kind: 'database-changed',
      database: database.path,
      ingressOrdinal: this.nextIngressOrdinal
    })
    this.nextIngressOrdinal += 1
  }

  private handleAdapterState(state: WinRtAdapterSnapshot): void {
    const wasReady = winRtAdapterIsReady(this.adapterStateSnapshot)
    this.adapterStateSnapshot = state
    if (wasReady && !winRtAdapterIsReady(state)) {
      this.backendGeneration += 1
      this.adapterGeneration += 1
      void this.invalidateForAdapterLoss().catch(error => {
        console.error('[WinRtBackend.adapter-state] Adapter loss cleanup rejected:', error)
      })
    }
    const snapshot = winRtAdapterState(this.adapterStateSnapshot, this.backendGeneration, this.now)
    for (const stream of this.stateStreams) {
      stream.emit(snapshot, 64, 'adapter-state')
    }
    const attachment = this.attachment()
    broadcastWinRtEvent(this.eventStreams, {
      attachment,
      attachmentId: attachment.attachmentId,
      kind: 'adapter-state',
      ingressOrdinal: this.nextIngressOrdinal
    })
    this.nextIngressOrdinal += 1
  }

  private async invalidateForAdapterLoss(): Promise<void> {
    const failures: CleanupFailure[] = []
    const group = this.scanGroup
    if (group !== null) {
      for (const consumer of group.consumers.values()) {
        consumer.stream.closeWithReason('connection-lost')
        consumer.released = true
      }
      const cleanup = await this.stopScanConsumer([...group.consumers.values()][0] ?? this.unreachableScanConsumer())
      failures.push(...cleanup.failures)
    }
    for (const record of [...this.connectionsByNativeId.values()]) {
      record.state = 'lost'
      const cleanup = await this.invalidateConnectionChildren(record, 'connection-lost')
      failures.push(...cleanup.failures)
      record.lease?.markReleased()
      record.lease = null
      this.connectionsByNativeId.delete(record.nativePeerId)
    }
    if (failures.length > 0) {
      throw contractError('platform.failure', 'cleanup', 'winrt.adapter-state.cleanup')
    }
  }

  private unreachableScanConsumer(): WinRtScanConsumer {
    throw contractError('lifecycle.invariant-violation', 'scan', 'winrt.adapter-loss.scan-group')
  }

  private async invalidateConnectionChildren(
    record: WinRtConnectionRecord,
    reason: 'connection-lost' | 'owner-released'
  ): Promise<CleanupRecord> {
    const failures: CleanupFailure[] = []
    record.database?.invalidate()
    record.database = null
    for (const physical of [...this.subscriptions.values()]) {
      const samePeer = physical.address.nativePeerId === record.nativePeerId
      if (!samePeer) {
        continue
      }
      for (const consumer of physical.consumers) {
        consumer.stream.closeWithReason(reason)
        consumer.removed = true
      }
      physical.consumers.clear()
      const cleanup = await stopWinRtPhysicalSubscription(this, physical)
      failures.push(...cleanup.failures)
    }
    return failures.length === 0
      ? releasedCleanup
      : Object.freeze({ state: 'release-failed', failures: Object.freeze(failures) })
  }

  private releaseScanAdmission(consumer: WinRtScanConsumer): void {
    if (consumer.abort !== null) {
      consumer.options.signal?.removeEventListener('abort', consumer.abort)
      consumer.abort = null
    }
    if (consumer.deadlineTimer !== null) {
      clearTimeout(consumer.deadlineTimer)
      consumer.deadlineTimer = null
    }
  }

  private async destroyInternal(): Promise<CleanupRecord> {
    this.admissionClosed = true
    const failures: CleanupFailure[] = []
    try {
      await this.dispatcher.cancelAll()
    } catch (error) {
      failures.push(...cleanupFailure('operation', 'winrt.destroy.cancel-operations', error).failures)
    }
    const group = this.scanGroup
    if (group !== null) {
      for (const consumer of group.consumers.values()) {
        consumer.released = true
        consumer.stream.closeWithReason('owner-released')
      }
      const firstConsumer = [...group.consumers.values()][0]
      if (firstConsumer === undefined) {
        failures.push(...cleanupFailure('scan', 'winrt.destroy.scan-consumer', new Error('WinRT scan group was empty')).failures)
      } else {
        failures.push(...(await this.stopScanConsumer(firstConsumer)).failures)
      }
    }
    for (const physical of [...this.subscriptions.values()]) {
      for (const consumer of physical.consumers) {
        consumer.removed = true
        consumer.stream.closeWithReason('owner-released')
      }
      physical.consumers.clear()
      failures.push(...(await stopWinRtPhysicalSubscription(this, physical)).failures)
    }
    for (const record of [...this.connectionsByNativeId.values()]) {
      failures.push(...(await this.disconnect(record, 'winrt.destroy.connection')).failures)
    }
    try {
      await this.boundary.destroy().completion
    } catch (error) {
      failures.push(...cleanupFailure('boundary', 'winrt.destroy.boundary', error).failures)
    }
    const nonZeroCounters = Object.entries(this.resourceCounters()).filter(([, value]) => Number(value) !== 0)
    if (nonZeroCounters.length > 0) {
      failures.push(
        ...cleanupFailure(
          'backend',
          'winrt.destroy.resource-counters',
          new Error(`WinRT cleanup retained counters: ${nonZeroCounters.map(([name]) => name).join(', ')}`)
        ).failures
      )
    }
    if (failures.length > 0 || this.dispatcher.activeCount() > 0) {
      if (this.dispatcher.activeCount() > 0) {
        failures.push(
          ...cleanupFailure('operation', 'winrt.destroy.pending-native-operation', new Error('WinRT operation is still awaiting native settlement')).failures
        )
      }
      return Object.freeze({ state: 'release-failed', failures: Object.freeze(failures) })
    }
    this.removeConnectionListener()
    this.removeDatabaseListener()
    this.removeAdapterStateListener()
    for (const stream of this.eventStreams) {
      stream.closeWithReason('owner-released')
    }
    this.eventStreams.clear()
    for (const stream of this.stateStreams) {
      stream.closeWithReason('owner-released')
    }
    this.stateStreams.clear()
    this.destroyed = true
    return releasedCleanup
  }

}
