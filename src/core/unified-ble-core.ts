// src/core/unified-ble-core.ts

import { BackendContractError, contractError } from '../backend-contract/errors'
import {
  assertAttachedBackend,
  type BackendAttachment,
  type BackendEvent,
  type BleCentralBackend,
  type ConnectionLease,
  type ManagerConstruction,
  type ScanLease
} from '../backend-contract/backend'
import { createAttachmentBoundIdFactory } from '../backend-contract/primitives'
import type { AdvertisementObservation, OwnerScanOptions, ScanOptions } from '../backend-contract/advertisement'
import type { CleanupFailure, CleanupRecord } from '../backend-contract/errors'
import type { AdapterStateSnapshot, BackendIdentity } from '../backend-contract/identity'
import type {
  PublicOperationOptions,
  SubscriptionOptions,
  WritePolicy,
  WriteReceipt
} from '../backend-contract/operations'
import type {
  AttachmentBoundIdFactory,
  AttachmentId,
  ByteLimit,
  OwnedBytes,
  PeerId
} from '../backend-contract/primitives'
import type { BoundedAsyncStream } from '../backend-contract/streams'
import type { ConnectionLifecycleTerminalCause } from '../backend-contract/connection-lifecycle'
import { AggregateStreamQuota } from './aggregate-stream-quota'
import { CoreBoundedStream } from './bounded-stream'
import { CoreOperationCoordinator } from './operation-coordinator'
import { ResourceLedger } from './resource-ledger'
import { CoreSubscription, SubscriptionRegistry } from './subscription-registry'
import { CoreTraceRecorder } from './trace-recorder'
import { CoreLifecycleObserver } from './core-lifecycle-observer'
import { CoreConnection, CoreGattDatabase } from './core-gatt-handles'
import { readCoreAdapterState } from './core-adapter-state'
import { readCoreCharacteristic, writeCoreCharacteristic } from './core-characteristic-operations'
import { createCoreConnectionControls, type CoreConnectionControls } from './core-connection-controls'
import { readCoreDescriptor, writeCoreDescriptor } from './core-descriptor-operations'
import { discoverCoreGattDatabase } from './core-discovery'
import type { CurrentCharacteristicPath, CurrentDescriptorPath } from './current-gatt-paths'
import {
  advertisementByteLength,
  advertisementPayloadByteLength,
  awaitWithOperationAdmission,
  activateScanLifetime,
  cleanupFailure,
  cloneObservation,
  deactivateScanLifetime,
  retryableCleanup,
  scheduleCoreDeadline,
  type CoreDeadlineHandle,
  type CoreDeadlineScheduler
} from './unified-ble-core-helpers'
import { forwardCoreBackendEvents } from './core-backend-event-stream'
import { isConnectionLossCause, lifecycleCauseFromBackendDisconnect } from './connection-lifecycle-rules'
export { DEFAULT_CORE_MAXIMUM_VALUE_BYTES } from './unified-ble-core-helpers'
export type { CoreDeadlineHandle, CoreDeadlineScheduler } from './unified-ble-core-helpers'

export interface UnifiedBleCoreOptions {
  readonly now: () => number
  readonly maximumValueBytes: ByteLimit
  readonly maximumAggregateRetainedBytes: number
  readonly traceMaximumRecords: number
  readonly traceMaximumBytes: number
  /** Optional host-neutral scheduler used for active scan deadline enforcement. */
  readonly timer?: CoreDeadlineScheduler
}

export interface CoreScanSession<Attachment extends string> {
  readonly scanSessionId: ScanLease<Attachment, string>['scanSessionId']
  readonly leaseId: ScanLease<Attachment, string>['leaseId']
  readonly shareToken: ScanLease<Attachment, string>['shareToken']
  readonly observations: BoundedAsyncStream<AdvertisementObservation<Attachment>>
  stop(): Promise<CleanupRecord>
}

interface TrackedScan<Attachment extends string> extends CoreScanSession<Attachment> {
  readonly lease: ScanLease<Attachment, string>
  readonly stream: CoreBoundedStream<AdvertisementObservation<Attachment>>
  readonly ownsPhysicalController: boolean
  stopInFlight: Promise<CleanupRecord> | null
  released: boolean
  activeAbortListener: (() => void) | null
  activeAbortSignal: AbortSignal | null
  activeDeadline: CoreDeadlineHandle | null
}

/**
 * One attached core owns the portable policy for one manager. It delegates only
 * radio mechanics to the negotiated backend and never imports a host runtime.
 */
export class UnifiedBleCore<Attachment extends string, Identity extends BackendIdentity<Attachment>> {
  private coreState: 'new' | 'ready' | 'destroying' | 'destroyed' | 'failed' = 'new'
  private attachment: BackendAttachment<Attachment, Identity> | null = null
  private idFactory: AttachmentBoundIdFactory<Attachment> | null = null
  private readonly resourceLedger = new ResourceLedger()
  private readonly trace: CoreTraceRecorder
  private readonly lifecycleObserver: CoreLifecycleObserver
  private readonly aggregateQuota: AggregateStreamQuota
  private readonly operationCoordinator: CoreOperationCoordinator<Attachment>
  private readonly connectionControls: CoreConnectionControls<Attachment, Identity>
  private readonly scans = new Map<string, TrackedScan<Attachment>>()
  private readonly connections = new Map<string, CoreConnection<Attachment, Identity>>()
  private readonly connectionReleases = new Map<string, Promise<CleanupRecord>>()
  private readonly subscriptions: SubscriptionRegistry<Attachment, Identity>
  private backendEventStream: BoundedAsyncStream<BackendEvent<Attachment>> | null = null
  private destroyResult: Promise<CleanupRecord> | null = null
  private resourceReleaseResult: Promise<CleanupRecord> | null = null
  private backendDestroyResult: Promise<CleanupRecord> | null = null
  private readonly discoveries = new Map<string, Promise<CoreGattDatabase<Attachment, Identity>>>()
  private admissionEpoch = 1
  private nextOperation = 1

  private constructor(
    readonly construction: ManagerConstruction<Attachment, Identity>,
    readonly options: UnifiedBleCoreOptions
  ) {
    this.trace = new CoreTraceRecorder(options.traceMaximumRecords, options.traceMaximumBytes)
    this.lifecycleObserver = new CoreLifecycleObserver(this.trace, options.now)
    this.aggregateQuota = new AggregateStreamQuota(options.maximumAggregateRetainedBytes)
    this.operationCoordinator = new CoreOperationCoordinator({
      now: options.now,
      createCorrelation: () => this.requireIdFactory().operationCorrelation(`operation-${this.nextOperationValue()}`),
      resourceLedger: this.resourceLedger,
      trace: this.trace
    })
    this.connectionControls = createCoreConnectionControls(this.backend, this.operationCoordinator, operation => {
      this.assertReady(operation)
    })
    this.subscriptions = new SubscriptionRegistry({
      backend: construction.attachedBackend.backend,
      attachmentId: construction.attachedBackend.attachment.attachment.attachmentId,
      idFactory: {
        clientId: value => this.requireIdFactory().clientId(value),
        managerId: value => this.requireIdFactory().managerId(value),
        connectionId: value => this.requireIdFactory().connectionId(value),
        leaseId: value => this.requireIdFactory().leaseId(value),
        scanShareToken: value => this.requireIdFactory().scanShareToken(value),
        scanSessionId: value => this.requireIdFactory().scanSessionId(value),
        databaseId: value => this.requireIdFactory().databaseId(value),
        subscriptionId: value => this.requireIdFactory().subscriptionId(value),
        operationCorrelation: value => this.requireIdFactory().operationCorrelation(value),
        backendOperationHandle: value => this.requireIdFactory().backendOperationHandle(value)
      },
      operationCoordinator: this.operationCoordinator,
      aggregateQuota: this.aggregateQuota,
      resourceLedger: this.resourceLedger,
      trace: this.trace,
      now: options.now,
      maximumValueBytes: options.maximumValueBytes,
      isPathCurrent: path => this.isCurrentPath(path)
    })
  }

  static async attach<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
    construction: ManagerConstruction<Attachment, Identity>,
    options: UnifiedBleCoreOptions
  ): Promise<UnifiedBleCore<Attachment, Identity>> {
    const core = new UnifiedBleCore(construction, options)
    core.adoptAttachedBackend()
    return core
  }

  get state(): 'new' | 'ready' | 'destroying' | 'destroyed' | 'failed' {
    return this.coreState
  }

  get identity(): Identity {
    return this.requireAttachment().identity
  }

  get attachmentId(): AttachmentId<Attachment> {
    return this.requireAttachment().attachment.attachmentId
  }

  get backend(): BleCentralBackend<Attachment, Identity> {
    return this.construction.attachedBackend.backend
  }

  traces(): readonly import('./trace-recorder').CoreTraceRecord[] {
    return this.trace.snapshot()
  }

  monotonicNow(): number {
    return this.options.now()
  }

  scheduleDeadline(deadline: number, action: () => void): CoreDeadlineHandle {
    return scheduleCoreDeadline(deadline, action, this.options.timer, this.options.now)
  }

  localResourceCounters(): import('../backend-contract/backend').ResourceCounters {
    this.syncRetainedByteBuffers()
    return this.resourceLedger.snapshot()
  }

  async adapterState(): Promise<AdapterStateSnapshot<Attachment>> {
    this.assertReady('adapter-state')
    return readCoreAdapterState(this.backend)
  }

  async scan(options: ScanOptions<Attachment, string>): Promise<CoreScanSession<Attachment>> {
    this.assertReady('scan')
    this.assertOperationAdmission(options, 'scan')
    const admissionEpoch = this.admissionEpoch
    const stream = new CoreBoundedStream<AdvertisementObservation<Attachment>>(
      options.delivery,
      options.delivery.overflowPolicy
    )
    this.aggregateQuota.register(stream)
    let lease: ScanLease<Attachment, string>
    try {
      if (options.sharing.mode === 'owner') {
        const ownerOptions: OwnerScanOptions<Attachment, string> = { ...options, sharing: options.sharing }
        lease = await this.backend.scanner.start(ownerOptions, this.construction.clientId)
      } else {
        lease = await this.backend.scanner.join(
          options.sharing.sharedLeaseId,
          options.sharing.token,
          this.construction.clientId
        )
      }
    } catch (error) {
      this.aggregateQuota.unregister(stream)
      if (error instanceof BackendContractError) {
        throw error
      }
      throw contractError('scan.start-failed', 'scan', 'unified-core.scan')
    }
    try {
      this.assertAdmissionCurrent(admissionEpoch, options, 'scan')
    } catch (error) {
      stream.closeWithReason('owner-released')
      this.aggregateQuota.unregister(stream)
      await this.lifecycleObserver.captureCleanup(lease.stop(), 'scan', 'scan-stale-admission-release')
      throw error
    }
    const tracked: TrackedScan<Attachment> = {
      scanSessionId: lease.scanSessionId,
      leaseId: lease.leaseId,
      shareToken: lease.shareToken,
      observations: stream,
      lease,
      stream,
      ownsPhysicalController: options.sharing.mode === 'owner',
      stopInFlight: null,
      released: false,
      activeAbortListener: null,
      activeAbortSignal: null,
      activeDeadline: null,
      stop: () => this.stopScan(tracked)
    }
    this.scans.set(String(lease.leaseId), tracked)
    this.resourceLedger.increment('scanConsumers')
    if (tracked.ownsPhysicalController) {
      this.resourceLedger.increment('activeScanControllers')
    }
    activateScanLifetime(
      tracked,
      options,
      this.options.now,
      this.options.timer,
      () => this.stopScan(tracked),
      (cleanup, transition) => this.lifecycleObserver.observeCleanup(cleanup, transition)
    )
    this.lifecycleObserver.observeBackground(
      this.forwardScanSource(tracked, lease.observations),
      'scan',
      'scan-source-pump'
    )
    return tracked
  }

  async connect(
    peerId: PeerId<Attachment>,
    options: PublicOperationOptions
  ): Promise<CoreConnection<Attachment, Identity>> {
    this.assertReady('connect')
    this.assertOperationAdmission(options, 'connect')
    const admissionEpoch = this.admissionEpoch
    let lease: ConnectionLease<Attachment, string, string>
    try {
      lease = await this.backend.connections.connect(peerId, this.construction.clientId, options)
    } catch (error) {
      if (error instanceof BackendContractError) {
        throw error
      }
      throw contractError('connection.failed', 'connection', 'unified-core.connect')
    }
    try {
      this.assertAdmissionCurrent(admissionEpoch, options, 'connect')
    } catch (error) {
      await this.lifecycleObserver.captureCleanup(lease.release(), 'connection', 'connect-stale-admission-release')
      throw error
    }
    const connection = new CoreConnection(this, lease, this.connectionControls)
    this.connections.set(String(lease.connection.connectionId), connection)
    this.resourceLedger.increment('connectionLeases')
    return connection
  }

  async destroy(): Promise<CleanupRecord> {
    if (this.destroyResult !== null) {
      return this.destroyResult
    }
    const destruction = this.releaseResources().then(async released => {
      if (released.state === 'release-failed' || this.construction.ownerMode === 'borrowing') {
        return released
      }
      return this.destroyBackend()
    })
    this.destroyResult = retryableCleanup(destruction, () => {
      this.destroyResult = null
    })
    return this.destroyResult
  }

  async releaseResources(cause: ConnectionLifecycleTerminalCause = 'manager-destroyed'): Promise<CleanupRecord> {
    if (this.resourceReleaseResult !== null) {
      return this.resourceReleaseResult
    }
    this.admissionEpoch += 1
    this.coreState = 'destroying'
    this.operationCoordinator.destroy()
    for (const connection of this.connections.values()) {
      connection.finishLifecycle(cause, null)
    }
    const release = this.destroyOwnedResources(cause)
    this.resourceReleaseResult = retryableCleanup(release, () => {
      this.resourceReleaseResult = null
    })
    return this.resourceReleaseResult
  }

  destroyBackend(): Promise<CleanupRecord> {
    if (this.backendDestroyResult !== null) {
      return this.backendDestroyResult
    }
    const destruction = this.backend.destroy().then(
      result => result,
      error => {
        this.trace.record({
          timestamp: this.options.now(),
          resource: 'manager',
          transition: 'backend-destroy-rejected',
          operation: null,
          cause: error instanceof BackendContractError ? error.normalized.code : 'platform.failure',
          queuedOperations: 0,
          dispatchedOperations: 0,
          quarantinedOperations: 0
        })
        return cleanupFailure('backend', contractError('platform.failure', 'cleanup', 'unified-core.backend-destroy'))
      }
    )
    this.backendDestroyResult = retryableCleanup(destruction, () => {
      this.backendDestroyResult = null
    })
    return this.backendDestroyResult
  }

  async discover(
    connection: CoreConnection<Attachment, Identity>,
    options: PublicOperationOptions
  ): Promise<CoreGattDatabase<Attachment, Identity>> {
    this.assertReady('discover')
    this.assertOperationAdmission(options, 'discover')
    const key = String(connection.resource.connectionId)
    const existing = this.discoveries.get(key)
    if (existing !== undefined) {
      const database = await awaitWithOperationAdmission(existing, options, this.options.now, 'discover')
      database.assertCurrent()
      return database
    }
    const discovery = discoverCoreGattDatabase(
      this,
      this.backend,
      this.resourceLedger,
      connection,
      options,
      operation => this.assertReady(operation),
      (value, operation) => this.assertOperationAdmission(value, operation),
      (admissionEpoch, value, operation) => this.assertAdmissionCurrent(admissionEpoch, value, operation),
      this.admissionEpoch
    )
    this.discoveries.set(key, discovery)
    try {
      return await discovery
    } finally {
      if (this.discoveries.get(key) === discovery) {
        this.discoveries.delete(key)
      }
    }
  }

  async read(
    database: CoreGattDatabase<Attachment, Identity>,
    path: CurrentCharacteristicPath<Attachment>,
    options: PublicOperationOptions
  ): Promise<OwnedBytes> {
    return readCoreCharacteristic(
      this.backend,
      this.operationCoordinator,
      this.options.maximumValueBytes,
      database,
      path,
      options
    )
  }

  async write(
    database: CoreGattDatabase<Attachment, Identity>,
    path: CurrentCharacteristicPath<Attachment>,
    bytes: Readonly<Uint8Array>,
    options: WritePolicy
  ): Promise<WriteReceipt<Attachment, string>> {
    return writeCoreCharacteristic(
      this.backend,
      this.operationCoordinator,
      this.options.maximumValueBytes,
      database,
      path,
      bytes,
      options
    )
  }

  async readDescriptor(
    database: CoreGattDatabase<Attachment, Identity>,
    path: CurrentDescriptorPath<Attachment>,
    options: PublicOperationOptions
  ): Promise<OwnedBytes> {
    return readCoreDescriptor(
      this.backend,
      this.operationCoordinator,
      this.options.maximumValueBytes,
      database,
      path,
      options
    )
  }

  async writeDescriptor(
    database: CoreGattDatabase<Attachment, Identity>,
    path: CurrentDescriptorPath<Attachment>,
    bytes: Readonly<Uint8Array>,
    options: WritePolicy
  ): Promise<WriteReceipt<Attachment, string>> {
    return writeCoreDescriptor(
      this.backend,
      this.operationCoordinator,
      this.options.maximumValueBytes,
      database,
      path,
      bytes,
      options
    )
  }

  async subscribe(
    database: CoreGattDatabase<Attachment, Identity>,
    path: CurrentCharacteristicPath<Attachment>,
    options: SubscriptionOptions
  ): Promise<CoreSubscription<Attachment, Identity>> {
    database.assertPath(path)
    return this.subscriptions.subscribe(path, options, String(path.connectionId))
  }

  async releaseConnection(
    connection: CoreConnection<Attachment, Identity>,
    cause: ConnectionLifecycleTerminalCause
  ): Promise<CleanupRecord> {
    const key = String(connection.resource.connectionId)
    const inFlight = this.connectionReleases.get(key)
    if (inFlight !== undefined) {
      return inFlight
    }
    if (connection.isReleased()) {
      return { state: 'released', failures: [] }
    }
    const release = this.releaseConnectionCurrent(connection, cause)
    this.connectionReleases.set(key, release)
    try {
      return await release
    } finally {
      if (this.connectionReleases.get(key) === release) {
        this.connectionReleases.delete(key)
      }
    }
  }

  private async releaseConnectionCurrent(
    connection: CoreConnection<Attachment, Identity>,
    cause: ConnectionLifecycleTerminalCause
  ): Promise<CleanupRecord> {
    this.operationCoordinator.cancelQueue(String(connection.resource.connectionId), 'disconnected')
    const disconnect = cause === 'requested-disconnect'
    const reason = isConnectionLossCause(cause) ? 'connection-lost' : 'owner-released'
    const cleanup = await connection.cleanupChildren(reason)
    if (cleanup.state === 'release-failed') {
      return cleanup
    }
    let backendResult: CleanupRecord
    try {
      backendResult =
        disconnect && connection.isCurrent() ? await connection.resource.disconnect() : await connection.lease.release()
    } catch (error) {
      this.trace.record({
        timestamp: this.options.now(),
        resource: 'connection',
        transition: 'release-rejected',
        operation: null,
        cause: error instanceof BackendContractError ? error.normalized.code : 'platform.failure',
        queuedOperations: 0,
        dispatchedOperations: 0,
        quarantinedOperations: 0
      })
      return cleanupFailure(
        'connection',
        contractError('platform.failure', 'cleanup', 'unified-core.connection-release')
      )
    }
    if (backendResult.state === 'release-failed') {
      return backendResult
    }
    connection.finishLifecycle(cause, null)
    connection.markReleased()
    this.connections.delete(String(connection.resource.connectionId))
    this.resourceLedger.decrement('connectionLeases')
    return backendResult
  }

  async invalidateDatabase(
    database: CoreGattDatabase<Attachment, Identity>,
    reason: 'connection-lost' | 'owner-released'
  ): Promise<CleanupRecord> {
    const alreadyPending = database.connection.isPendingDatabaseCleanup(database)
    if (!database.isAttached() && !alreadyPending) {
      return { state: 'released', failures: [] }
    }
    if (!alreadyPending) {
      database.markInvalid()
      if (database.connection.retainPendingDatabaseCleanup(database)) {
        this.resourceLedger.decrement('databaseSnapshots')
      }
    }
    const cleanup = await this.subscriptions.invalidateDatabase(database.path, reason)
    if (cleanup.state === 'released') {
      database.connection.completeDatabaseCleanup(database)
    }
    return cleanup
  }

  private adoptAttachedBackend(): void {
    this.coreState = 'new'
    try {
      assertAttachedBackend(this.construction.attachedBackend)
    } catch (error) {
      this.coreState = 'failed'
      if (error instanceof BackendContractError) {
        throw error
      }
      throw contractError('protocol.incompatible', 'core', 'unified-core.adopt-attached-backend')
    }
    const attachment = this.construction.attachedBackend.attachment
    if (
      attachment.attachment.attachmentId !== attachment.identity.attachment.attachmentId ||
      attachment.attachment.attachmentId !== this.backend.identity.attachment.attachmentId
    ) {
      this.coreState = 'failed'
      throw contractError('protocol.violation', 'core', 'unified-core.adopt-identity')
    }
    this.attachment = attachment
    this.idFactory = createAttachmentBoundIdFactory({
      attachmentId: attachment.attachment.attachmentId,
      backendInstanceId: attachment.attachment.backendInstanceId,
      backendGeneration: attachment.attachment.backendGeneration,
      adapterId: attachment.attachment.adapter.adapterId,
      adapterGeneration: attachment.attachment.adapter.adapterGeneration
    })
    this.coreState = 'ready'
    const events = this.backend.events()
    this.backendEventStream = events
    this.lifecycleObserver.observeBackground(
      forwardCoreBackendEvents({
        events,
        isReady: () => this.coreState === 'ready',
        applyEvent: event => this.applyBackendEvent(event),
        releaseAfterFailure: () => this.releaseResources('backend-failure'),
        trace: this.trace,
        now: this.options.now
      }),
      'manager',
      'backend-event-pump'
    )
  }

  private async forwardScanSource(
    scan: TrackedScan<Attachment>,
    source: BoundedAsyncStream<AdvertisementObservation<Attachment>>
  ): Promise<void> {
    try {
      for await (const item of source) {
        if (scan.released || this.coreState !== 'ready') {
          return
        }
        if (item.kind === 'value') {
          const observation = cloneObservation(item.value, this.options.maximumValueBytes)
          const outcome = this.aggregateQuota.emit(
            scan.stream,
            observation,
            advertisementByteLength(observation),
            String(observation.device.id),
            advertisementPayloadByteLength(observation)
          )
          if (outcome.terminated) {
            await this.stopScan(scan)
            return
          }
        }
        if (item.kind === 'overflow') {
          scan.stream.observeSourceOverflow(item)
        }
        if (item.kind === 'terminal') {
          scan.stream.closeWithReason(item.reason)
          await this.stopScan(scan)
          return
        }
      }
    } catch (error) {
      const code = error instanceof BackendContractError ? error.normalized.code : 'platform.failure'
      this.trace.record({
        timestamp: this.options.now(),
        resource: 'scan',
        transition: 'source-failed',
        operation: null,
        cause: code,
        queuedOperations: 0,
        dispatchedOperations: 0,
        quarantinedOperations: 0
      })
      scan.stream.closeWithReason('source-failed')
      await this.stopScan(scan)
    }
  }

  private applyBackendEvent(event: BackendEvent<Attachment>): void {
    if (event.kind === 'backend-restarted' || event.kind === 'backend-restarting') {
      if (event.attachment.adapter.adapterId === this.requireAttachment().attachment.adapter.adapterId) {
        this.lifecycleObserver.observeCleanup(this.releaseResources('backend-restart'), 'backend-restarted-cleanup')
      }
      return
    }
    if (event.attachmentId !== this.attachmentId) {
      return
    }
    if (event.kind === 'database-changed') {
      for (const connection of this.connections.values()) {
        const database = connection.database
        if (database !== null && database.matchesDatabasePath(event.database)) {
          this.lifecycleObserver.observeCleanup(
            this.invalidateDatabase(database, 'connection-lost'),
            'database-changed-cleanup'
          )
        }
      }
      return
    }
    if (event.kind === 'connection-lost') {
      const connection = this.connections.get(String(event.connection.connectionId))
      if (connection !== undefined && connection.matchesConnectionPath(event.connection)) {
        connection.finishLifecycle('peer-link-loss', event.ingressOrdinal)
        this.lifecycleObserver.observeCleanup(
          this.releaseConnection(connection, 'peer-link-loss'),
          'backend-event-connection-cleanup'
        )
      }
      return
    }
    if (event.kind === 'connection-state-changed') {
      const connection = this.connections.get(String(event.connection.connectionId))
      if (connection !== undefined && connection.matchesConnectionPath(event.connection)) {
        if (event.current === 'disconnected' || event.current === 'lost') {
          if (event.reason === null) {
            throw contractError(
              'lifecycle.invariant-violation',
              'connection',
              'backend-event-terminal-transition-reason'
            )
          }
          const cause = lifecycleCauseFromBackendDisconnect(event.reason)
          connection.finishBackendLifecycle(event.previous, event.current, cause, event.ingressOrdinal)
          this.lifecycleObserver.observeCleanup(
            this.releaseConnection(connection, cause),
            'backend-event-connection-state-cleanup'
          )
        } else {
          connection.applyBackendTransition(event.previous, event.current, event.ingressOrdinal)
        }
      }
      return
    }
    if (event.kind === 'disconnected') {
      const connection = this.connections.get(String(event.connection.connectionId))
      if (connection !== undefined && connection.matchesConnectionPath(event.connection)) {
        const cause = lifecycleCauseFromBackendDisconnect(event.reason)
        connection.finishLifecycle(cause, event.ingressOrdinal)
        this.lifecycleObserver.observeCleanup(
          this.releaseConnection(connection, cause),
          'backend-event-disconnected-cleanup'
        )
      }
      return
    }
    if (event.kind === 'adapter-state') {
      this.lifecycleObserver.observeBackground(this.applyAdapterStateEvent(), 'manager', 'backend-adapter-state')
    }
  }

  private async applyAdapterStateEvent(): Promise<void> {
    const state = await this.backend.adapter.currentState()
    if (state.availability !== 'available' || state.authorization !== 'granted' || state.power !== 'on') {
      await this.releaseResources('adapter-loss')
    }
  }

  private async stopScan(scan: TrackedScan<Attachment>): Promise<CleanupRecord> {
    if (scan.released) {
      return { state: 'released', failures: [] }
    }
    if (scan.stopInFlight !== null) {
      return scan.stopInFlight
    }
    scan.stream.closeWithReason('owner-released')
    deactivateScanLifetime(scan)
    const stop = this.stopScanPhysical(scan)
    scan.stopInFlight = stop
    stop.then(
      result => {
        scan.stopInFlight = null
        if (result.state === 'released') {
          this.finalizeStoppedScan(scan)
        }
      },
      () => {
        scan.stopInFlight = null
      }
    )
    return stop
  }

  private async stopScanPhysical(scan: TrackedScan<Attachment>): Promise<CleanupRecord> {
    try {
      return await scan.lease.stop()
    } catch (error) {
      const cause = error instanceof BackendContractError ? error.normalized.code : 'platform.failure'
      this.trace.record({
        timestamp: this.options.now(),
        resource: 'scan',
        transition: 'stop-rejected',
        operation: null,
        cause,
        queuedOperations: 0,
        dispatchedOperations: 0,
        quarantinedOperations: 0
      })
      return cleanupFailure('scan', contractError('platform.failure', 'cleanup', 'unified-core.scan-stop'))
    }
  }

  private finalizeStoppedScan(scan: TrackedScan<Attachment>): void {
    if (scan.released) {
      return
    }
    scan.released = true
    this.aggregateQuota.unregister(scan.stream)
    this.scans.delete(String(scan.leaseId))
    this.resourceLedger.decrement('scanConsumers')
    if (scan.ownsPhysicalController) {
      this.resourceLedger.decrement('activeScanControllers')
    }
  }

  private async destroyOwnedResources(cause: ConnectionLifecycleTerminalCause): Promise<CleanupRecord> {
    const failures: CleanupFailure[] = []
    const eventClose = this.closeBackendEventStream()
    for (const scan of [...this.scans.values()]) {
      const result = await this.lifecycleObserver.captureCleanup(this.stopScan(scan), 'scan', 'destroy-scan')
      failures.push(...result.failures)
    }
    for (const connection of [...this.connections.values()]) {
      const result = await this.lifecycleObserver.captureCleanup(
        this.releaseConnection(connection, cause),
        'connection',
        'destroy-connection'
      )
      failures.push(...result.failures)
    }
    const subscriptions = await this.lifecycleObserver.captureCleanup(
      this.subscriptions.destroy(),
      'subscription',
      'destroy-subscriptions'
    )
    failures.push(...subscriptions.failures)
    const events = await eventClose
    failures.push(...events.failures)
    await this.operationCoordinator.waitForQuarantineDrain()
    const result: CleanupRecord =
      failures.length === 0 ? { state: 'released', failures: [] } : { state: 'release-failed', failures }
    this.syncRetainedByteBuffers()
    this.coreState = result.state === 'released' ? 'destroyed' : 'failed'
    return result
  }

  private assertReady(operation: string): void {
    if (this.coreState !== 'ready') {
      throw contractError(
        this.coreState === 'destroyed' ? 'lifecycle.destroyed' : 'lifecycle.invalid-state',
        'core',
        operation
      )
    }
  }

  private assertOperationAdmission(options: PublicOperationOptions, operation: string): void {
    if (options.signal?.aborted === true) {
      throw contractError('operation.aborted', 'core', operation)
    }
    if (options.deadline !== null && options.deadline <= this.options.now()) {
      throw contractError('operation.timed-out', 'core', operation)
    }
  }

  private assertAdmissionCurrent(admissionEpoch: number, options: PublicOperationOptions, operation: string): void {
    this.assertOperationAdmission(options, operation)
    if (this.coreState !== 'ready' || this.admissionEpoch !== admissionEpoch) {
      throw contractError('operation.cancelled-by-destroy', 'core', operation)
    }
  }

  private isCurrentPath(path: CurrentCharacteristicPath<Attachment>): boolean {
    if (this.coreState !== 'ready' || path.attachmentId !== this.attachmentId || path.validity !== 'current') {
      return false
    }
    const connection = this.connections.get(String(path.connectionId))
    return connection !== undefined && connection.isPathCurrent(path)
  }

  private requireAttachment(): BackendAttachment<Attachment, Identity> {
    if (this.attachment === null) {
      throw contractError('lifecycle.invalid-state', 'core', 'unified-core.attachment')
    }
    return this.attachment
  }

  private requireIdFactory(): AttachmentBoundIdFactory<Attachment> {
    if (this.idFactory === null) {
      throw contractError('lifecycle.invalid-state', 'core', 'unified-core.id-factory')
    }
    return this.idFactory
  }

  private nextOperationValue(): number {
    const value = this.nextOperation
    this.nextOperation += 1
    return value
  }

  private syncRetainedByteBuffers(): void {
    this.resourceLedger.setRetainedStreamBytes(this.aggregateQuota.retainedPayloadBytes())
  }

  private async closeBackendEventStream(): Promise<CleanupRecord> {
    const events = this.backendEventStream
    if (events === null) {
      return { state: 'released', failures: [] }
    }
    const cleanup = await this.lifecycleObserver.captureCleanup(events.close(), 'manager', 'destroy-backend-events')
    if (cleanup.state === 'released') {
      this.backendEventStream = null
    }
    return cleanup
  }
}
