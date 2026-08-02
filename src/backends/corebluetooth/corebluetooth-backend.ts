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
import {
  assertScanFilter,
  deviceIdentity,
  type AdvertisementObservation,
  type OwnerScanOptions
} from '../../backend-contract/advertisement'
import type { FeatureRegistry } from '../../backend-contract/capabilities'
import {
  BackendContractError,
  contractError,
  type CleanupFailure,
  type CleanupRecord
} from '../../backend-contract/errors'
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
  negotiateCoreVersions,
  opaqueId,
  resourceCount,
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
import { createCoreBluetoothIdentifiers } from './corebluetooth-identifiers'
import { createCoreBluetoothObservation } from './corebluetooth-advertisement-observation'
import { assertCoreBluetoothOperational, assertCoreBluetoothUsable } from './corebluetooth-operation-admission'
import { CoreBluetoothAttachmentLifecycle } from './corebluetooth-attachment-lifecycle'
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
import { releaseCoreBluetoothAdapterLossResources } from './corebluetooth-adapter-loss-cleanup'
import { releaseLateCoreBluetoothConnection } from './corebluetooth-late-connect-cleanup'
import { createCoreBluetoothRuntimeFeatureRegistry } from './corebluetooth-runtime-capabilities'
export type { DirectGattBackendIdentityOptions } from './corebluetooth-identity'
export interface ScanConsumer {
  readonly scanSessionId: ScanSessionId<string, string>
  readonly leaseId: LeaseId<string, string>
  readonly shareToken: ScanShareToken<string, string> | null
  readonly options: OwnerScanOptions<string, string>
  readonly stream: CoreBoundedStream<AdvertisementObservation<string>>
  abort: (() => void) | null
  deadlineTimer: ReturnType<typeof setTimeout> | null
  terminalCause: 'aborted' | 'timed-out' | null
}
export interface ScanGroup {
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
  state: 'connecting' | 'connected' | 'disconnecting' | 'disconnected' | 'lost' | 'cleanup-failed'
  database: CoreBluetoothGattDatabase | null
  lease: CoreBluetoothConnectionLease | null
}
export interface PhysicalSubscription {
  readonly key: string
  readonly address: CoreBluetoothCharacteristicAddress
  readonly consumers: Set<CoreBluetoothBackendSubscription>
  state: 'enabling' | 'ready' | 'removing' | 'cleanup-failed'
  removal: Promise<CleanupRecord> | null
}
let nextBackendInstance = 1
function allocateBackendInstance(): number {
  const current = nextBackendInstance
  nextBackendInstance += 1
  return current
}

function throwCoreBluetoothGattSnapshotMalformed(field: string): never {
  throw contractError('protocol.malformed', 'gatt', `corebluetooth.gatt.snapshot.${field}`)
}

function isCoreBluetoothGattRecord(value: unknown): value is Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return false
    }
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  } catch {
    return false
  }
}

function requireCoreBluetoothGattRecord(
  value: unknown,
  resource: string,
  allowedFields: readonly string[]
): Record<string, unknown> {
  try {
    if (!isCoreBluetoothGattRecord(value)) {
      throwCoreBluetoothGattSnapshotMalformed(resource)
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string' || !allowedFields.includes(key)) {
        throwCoreBluetoothGattSnapshotMalformed(resource)
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        throwCoreBluetoothGattSnapshotMalformed(resource)
      }
    }
  } catch (error) {
    if (error instanceof BackendContractError) {
      throw error
    }
    throwCoreBluetoothGattSnapshotMalformed(resource)
  }
  return value
}

function requireCoreBluetoothGattArray(value: unknown, field: string): readonly unknown[] {
  try {
    if (!Array.isArray(value)) {
      throwCoreBluetoothGattSnapshotMalformed(field)
    }
    return value
  } catch (error) {
    if (error instanceof BackendContractError) {
      throw error
    }
    throwCoreBluetoothGattSnapshotMalformed(field)
  }
}

function requireCoreBluetoothGattProperty(record: Record<string, unknown>, property: string, field: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, property)
    if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throwCoreBluetoothGattSnapshotMalformed(field)
    }
    return descriptor.value
  } catch (error) {
    if (error instanceof BackendContractError) {
      throw error
    }
    throwCoreBluetoothGattSnapshotMalformed(field)
  }
}

function requireCoreBluetoothGattArrayLength(array: readonly unknown[], field: string): number {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(array, 'length')
    if (
      descriptor === undefined ||
      !Object.prototype.hasOwnProperty.call(descriptor, 'value') ||
      typeof descriptor.value !== 'number' ||
      !Number.isSafeInteger(descriptor.value) ||
      descriptor.value < 0
    ) {
      throwCoreBluetoothGattSnapshotMalformed(field)
    }
    return descriptor.value
  } catch (error) {
    if (error instanceof BackendContractError) {
      throw error
    }
    throwCoreBluetoothGattSnapshotMalformed(field)
  }
}

function requireCoreBluetoothGattArrayEntry(array: readonly unknown[], index: number, field: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(array, String(index))
    if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throwCoreBluetoothGattSnapshotMalformed(field)
    }
    return descriptor.value
  } catch (error) {
    if (error instanceof BackendContractError) {
      throw error
    }
    throwCoreBluetoothGattSnapshotMalformed(field)
  }
}

function requireCoreBluetoothGattUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) {
    throwCoreBluetoothGattSnapshotMalformed(field)
  }
  return value
}

function requireCoreBluetoothGattOccurrence(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throwCoreBluetoothGattSnapshotMalformed(field)
  }
  return value
}

function requireCoreBluetoothGattBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throwCoreBluetoothGattSnapshotMalformed(field)
  }
  return value
}

function assertCoreBluetoothGattIdentity(
  identities: Set<string>,
  uuid: string,
  occurrence: number,
  field: string
): void {
  const identity = `${uuid}\u0000${occurrence}`
  if (identities.has(identity)) {
    throwCoreBluetoothGattSnapshotMalformed(field)
  }
  identities.add(identity)
}

/**
 * First-party CoreBluetooth backend for explicitly selected macOS Node or
 * Electron-main hosts. It uses only the typed direct addon boundary.
 */
export class CoreBluetoothBackend implements BleCentralBackend<string, HostNeutralBackendIdentity<string>> {
  readonly features: FeatureRegistry
  readonly adapter: AdapterBackend<string>
  readonly scanner: ScannerBackend<string>
  readonly connections: ConnectionBackend<string>
  readonly gatt: GattBackend<string>
  private readonly attachmentLifecycle: CoreBluetoothAttachmentLifecycle
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
  private readonly databaseChangedListener: (() => void) | null
  private readonly scanFailureListener: (() => void) | null
  private readonly adapterStateListener: () => void
  private attached = false
  private admissionClosed = false
  private destroyed = false
  private destroyResult: Promise<CleanupRecord> | null = null
  private adapterLossCleanup: Promise<void> | null = null
  private adapterLossPending = false
  private adapterLossActive = false
  private scanGroup: ScanGroup | null = null
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
    this.features = createCoreBluetoothRuntimeFeatureRegistry({
      boundary,
      existingFeatures: identityOptions.features,
      implementationVersion: identityOptions.implementationVersion,
      now,
      resolveNativePeerId: (connectionId, connectionGeneration, operation) =>
        this.nativePeerIdForRuntimeCapability(connectionId, connectionGeneration, operation)
    })
    const backendInstanceId = opaqueId(
      `${this.identityOptions.backendInstancePrefix}-${allocateBackendInstance()}`,
      'backend-instance',
      this.identityOptions.attachmentScope
    )
    this.dispatcher = new CoreBluetoothOperationDispatcher(now)
    this.operationLifecycle = new CoreBluetoothOperationLifecycle(now)
    this.attachmentLifecycle = new CoreBluetoothAttachmentLifecycle(
      backendInstanceId,
      identityOptions,
      now,
      boundary.adapterSnapshot()
    )
    this.gattOperations = new CoreBluetoothGattOperations(this)
    this.connectionControls = new CoreBluetoothConnectionControls(this)
    this.adapter = {
      currentState: async () => this.attachmentLifecycle.adapterState(),
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
    this.databaseChangedListener =
      boundary.onDatabaseChanged?.(nativePeerId => {
        this.handleDatabaseChanged(nativePeerId)
      }) ?? null
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
        [...this.connectionsByNativeId.values()].filter(
          record => record.state === 'connected' || record.state === 'cleanup-failed'
        ).length
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
    return this.attachmentLifecycle.attachment()
  }
  refreshAttachmentState(): void {
    if (this.admissionClosed || this.destroyed) {
      throw contractError('lifecycle.destroyed', 'core', 'corebluetooth.refresh-attachment-state')
    }
    this.attachmentLifecycle.refreshAttachmentState()
  }
  assertUsable(operation: string): void {
    assertCoreBluetoothUsable(this.admissionClosed, this.destroyed, this.adapterLossPending, operation)
  }
  assertOperational(operation: string): void {
    assertCoreBluetoothOperational(
      this.admissionClosed,
      this.destroyed,
      this.adapterLossPending,
      this.attachmentLifecycle.adapterState(),
      operation
    )
  }
  private watchAdapterState(): AdapterStateWatch<string> {
    const stream = new CoreBoundedStream<AdapterStateSnapshot<string>>(adapterStateLimits, 'latest')
    this.stateStreams.add(stream)
    return Object.freeze({ initial: this.attachmentLifecycle.adapterState(), transitions: stream })
  }
  identifiers() {
    return createCoreBluetoothIdentifiers(this.attachment())
  }
  private async startScan(
    options: OwnerScanOptions<string, string>,
    _clientId: ClientId<string, string>
  ): Promise<ScanLease<string, string>> {
    this.assertOperational('corebluetooth.scan.start')
    assertScanFilter(options.filter, 'corebluetooth.scan.start')
    if (this.scanGroup?.state === 'failed') {
      try {
        await this.boundary.stopScan()
        this.scanGroup.consumers.clear()
        this.scanGroup = null
      } catch (error) {
        throw this.operationLifecycle.platformError('scan.start-failed', 'scan', 'corebluetooth.scan.retry-stop', error)
      }
    }
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
      deadlineTimer: null,
      terminalCause: null
    }
    const group: ScanGroup = {
      ownerLeaseId: consumer.leaseId,
      shareToken: consumer.shareToken,
      consumers: new Map([[String(consumer.leaseId), consumer]]),
      state: 'starting'
    }
    this.scanGroup = group
    const abort = (): void => {
      if (consumer.terminalCause === null) {
        consumer.terminalCause = 'aborted'
      }
      this.stopScanConsumer(consumer)
        .then(result => {
          if (result.state === 'release-failed') {
            console.error('[CoreBluetoothBackend.scan.abort] Native scan cleanup requires retry:', result.failures)
          }
        })
        .catch(error => {
          console.error('[CoreBluetoothBackend.scan.abort] Native scan cleanup rejected:', error)
        })
    }
    const deadline = (): void => {
      if (consumer.terminalCause === null) consumer.terminalCause = 'timed-out'
      abort()
    }
    consumer.abort = abort
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.deadline !== null) {
      consumer.deadlineTimer = setTimeout(deadline, Math.max(0, options.deadline - this.now()))
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
      try {
        await this.boundary.stopScan()
      } catch (error) {
        console.error('[CoreBluetoothBackend.scan.late-start] Native scan compensation failed:', error)
        group.state = 'failed'
        group.consumers.clear()
        this.scanGroup = group
        throw this.scanStartTerminalError(consumer, 'corebluetooth.scan.start')
      }
      group.consumers.clear()
      if (this.scanGroup === group) {
        this.scanGroup = null
      }
      throw this.scanStartTerminalError(consumer, 'corebluetooth.scan.start')
    }
    if (group.state !== 'starting' || consumer.terminalCause !== null || options.signal?.aborted === true) {
      const cleanup = await this.stopScanConsumer(consumer)
      if (cleanup.state === 'release-failed') {
        group.state = 'failed'
      }
      throw this.scanStartTerminalError(consumer, 'corebluetooth.scan.start')
    }
    group.state = 'active'
    return new CoreBluetoothScanLease(this, consumer)
  }
  private async joinScan(
    leaseId: LeaseId<string, string>,
    token: ScanShareToken<string, string>,
    _clientId: ClientId<string, string>
  ): Promise<ScanLease<string, string>> {
    this.assertOperational('corebluetooth.scan.join')
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
      deadlineTimer: null,
      terminalCause: null
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
      group.state = 'failed'
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
  private scanStartTerminalError(consumer: ScanConsumer, operation: string): Error {
    return contractError(
      consumer.terminalCause === 'timed-out' ? 'operation.timed-out' : 'operation.aborted',
      'scan',
      operation
    )
  }
  private handleAdvertisement(advertisement: CoreBluetoothAdvertisement): void {
    const group = this.scanGroup
    if (group === null || group.state !== 'active') {
      return
    }
    const peerId = this.peerIdForNativeId(advertisement.nativePeerId)
    const owner = group.consumers.get(String(group.ownerLeaseId))
    if (owner === undefined) {
      throw contractError('lifecycle.invariant-violation', 'scan', 'corebluetooth.advertisement.scan-owner')
    }
    const observation = createCoreBluetoothObservation(
      advertisement,
      deviceIdentity(peerId, this.attachment().backendInstanceId, null),
      owner.scanSessionId,
      this.now(),
      this.nextIngressOrdinal
    )
    this.nextIngressOrdinal += 1
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
    this.assertOperational('corebluetooth.connect')
    this.operationLifecycle.assertAdmission(options, 'corebluetooth.connect')
    const nativePeerId = this.nativeIdsByPeerId.get(String(peerId))
    if (nativePeerId === undefined) {
      throw contractError('connection.not-found', 'connection', 'corebluetooth.connect.peer')
    }
    let existing = this.connectionsByNativeId.get(nativePeerId)
    if (existing?.state === 'cleanup-failed') {
      try {
        const released = await releaseLateCoreBluetoothConnection(this.boundary, this.connectionsByNativeId, existing)
        if (!released) {
          console.error('[CoreBluetoothBackend.connect] Late connection cleanup remains active:', existing.nativePeerId)
        }
      } catch (error) {
        console.error('[CoreBluetoothBackend.connect] Late connection cleanup retry failed:', error)
      }
      existing = this.connectionsByNativeId.get(nativePeerId)
    }
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
          const released = await releaseLateCoreBluetoothConnection(this.boundary, this.connectionsByNativeId, record)
          if (!released) {
            console.error('[CoreBluetoothBackend.connect] Late native connection remains active:', record.nativePeerId)
          }
        },
        async () => {
          if (this.connectionsByNativeId.get(nativePeerId) === record) {
            this.connectionsByNativeId.delete(nativePeerId)
          }
        }
      )
    } catch (error) {
      const terminalCancellation =
        error instanceof BackendContractError &&
        (error.normalized.code === 'operation.aborted' ||
          error.normalized.code === 'operation.timed-out' ||
          error.normalized.code === 'operation.cancelled-by-destroy')
      if (!terminalCancellation) {
        this.connectionsByNativeId.delete(nativePeerId)
      }
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
  private handleDatabaseChanged(nativePeerId: string): void {
    if (this.admissionClosed || this.destroyed) {
      return
    }
    const record = this.connectionsByNativeId.get(nativePeerId)
    const database = record?.database
    if (record === undefined || database === null || database === undefined || record.state !== 'connected') {
      return
    }
    database.invalidate()
    record.database = null
    this.removeConnectionSubscriptions(record, 'connection-lost').then(
      cleanup => {
        if (cleanup.state === 'release-failed') {
          console.error(
            '[CoreBluetoothBackend.database-changed] Subscription cleanup requires retry:',
            cleanup.failures
          )
        }
      },
      error => console.error('[CoreBluetoothBackend.database-changed] Subscription cleanup rejected:', error)
    )
    const attachment = this.attachment()
    this.broadcastEvent({
      attachment,
      attachmentId: attachment.attachmentId,
      kind: 'database-changed',
      database: database.path,
      ingressOrdinal: this.nextIngressOrdinal
    })
    this.nextIngressOrdinal += 1
  }
  private handleAdapterState(state: CoreBluetoothAdapterSnapshot): void {
    this.attachmentLifecycle.updateAdapterState(state)
    if (this.destroyed) {
      return
    }
    const adapterLost = state.availability !== 'available' || state.authorization !== 'granted' || state.power !== 'on'
    if (adapterLost || this.adapterLossPending) {
      this.startAdapterLossCleanup()
    } else {
      this.adapterLossActive = false
    }
    const snapshot = this.attachmentLifecycle.adapterState()
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
  private startAdapterLossCleanup(): void {
    if (this.adapterLossCleanup !== null || (this.adapterLossActive && !this.adapterLossPending)) {
      return
    }
    this.adapterLossActive = true
    this.adapterLossPending = true
    this.dispatcher.cancelAll()
    this.adapterLossCleanup = this.releaseAdapterLossResources().then(async cleanup => {
      this.adapterLossCleanup = null
      if (cleanup.state === 'release-failed') {
        console.error(
          '[CoreBluetoothBackend.handleAdapterState] Native adapter-loss cleanup requires retry:',
          cleanup.failures
        )
        const attachment = this.attachment()
        this.broadcastEvent({
          attachment,
          attachmentId: attachment.attachmentId,
          kind: 'diagnostic',
          ingressOrdinal: this.nextIngressOrdinal
        })
        this.nextIngressOrdinal += 1
        return
      }
      await this.dispatcher.waitForIdle()
      this.adapterLossPending = false
      this.advanceGeneration()
    })
  }
  private async releaseAdapterLossResources(): Promise<CleanupRecord> {
    return releaseCoreBluetoothAdapterLossResources({
      boundary: this.boundary,
      scanGroup: this.scanGroup,
      subscriptions: this.subscriptions,
      connections: this.connectionsByNativeId,
      gattOperations: this.gattOperations,
      releaseScanConsumerAdmission: consumer => this.releaseScanConsumerAdmission(consumer),
      clearScanGroup: group => {
        if (this.scanGroup === group) {
          this.scanGroup = null
        }
      },
      invalidateConnection: record => this.invalidateRecord(record, true)
    })
  }
  private advanceGeneration(): void {
    this.attachmentLifecycle.advanceGeneration()
    this.peerIdsByNativeId.clear()
    this.nativeIdsByPeerId.clear()
    const snapshot = this.attachmentLifecycle.adapterState()
    for (const stream of this.stateStreams) {
      stream.emit(snapshot, 96, String(snapshot.backendGeneration))
    }
    const attachment = this.attachment()
    this.broadcastEvent({
      attachment,
      attachmentId: attachment.attachmentId,
      kind: 'backend-restarted',
      ingressOrdinal: this.nextIngressOrdinal
    })
    this.nextIngressOrdinal += 1
  }
  private invalidateRecord(record: ConnectionRecord, preservePhysicalSubscriptions = false): void {
    record.state = 'lost'
    record.database?.invalidate()
    record.database = null
    record.lease?.markReleased()
    record.lease = null
    this.connectionsByNativeId.delete(record.nativePeerId)
    for (const physical of preservePhysicalSubscriptions ? [] : [...this.subscriptions.values()]) {
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
  private nativePeerIdForRuntimeCapability(
    connectionId: string,
    connectionGeneration: string,
    operation: string
  ): string {
    for (const record of this.connectionsByNativeId.values()) {
      if (
        String(record.connectionId) === connectionId &&
        String(record.connectionGeneration) === connectionGeneration &&
        record.state === 'connected'
      ) {
        return record.nativePeerId
      }
    }
    throw contractError('connection.stale', 'connection', operation)
  }
  private peerIdForNativeId(nativePeerId: string): PeerId<string> {
    const existing = this.peerIdsByNativeId.get(nativePeerId)
    if (existing !== undefined) {
      return existing
    }
    const peerId = opaqueId(
      `corebluetooth-peer-${this.attachmentLifecycle.generation}-${this.nextPeer}`,
      'peer',
      'corebluetooth'
    )
    this.nextPeer += 1
    this.peerIdsByNativeId.set(nativePeerId, peerId)
    this.nativeIdsByPeerId.set(String(peerId), nativePeerId)
    return peerId
  }
  assertGattSnapshot(snapshot: unknown): asserts snapshot is CoreBluetoothGattSnapshot {
    const snapshotRecord = requireCoreBluetoothGattRecord(snapshot, 'root', ['services'])
    const services = requireCoreBluetoothGattArray(
      requireCoreBluetoothGattProperty(snapshotRecord, 'services', 'services'),
      'services'
    )
    const serviceIdentities = new Set<string>()
    const serviceCount = requireCoreBluetoothGattArrayLength(services, 'services')
    for (let serviceIndex = 0; serviceIndex < serviceCount; serviceIndex += 1) {
      const serviceValue = requireCoreBluetoothGattArrayEntry(services, serviceIndex, 'services')
      const service = requireCoreBluetoothGattRecord(serviceValue, 'service', ['uuid', 'occurrence', 'characteristics'])
      const serviceUuid = requireCoreBluetoothGattUuid(
        requireCoreBluetoothGattProperty(service, 'uuid', 'service-uuid'),
        'service-uuid'
      )
      const serviceOccurrence = requireCoreBluetoothGattOccurrence(
        requireCoreBluetoothGattProperty(service, 'occurrence', 'service-occurrence'),
        'service-occurrence'
      )
      assertCoreBluetoothGattIdentity(serviceIdentities, serviceUuid, serviceOccurrence, 'service-identity')
      const characteristics = requireCoreBluetoothGattArray(
        requireCoreBluetoothGattProperty(service, 'characteristics', 'characteristics'),
        'characteristics'
      )
      const characteristicIdentities = new Set<string>()
      const characteristicCount = requireCoreBluetoothGattArrayLength(characteristics, 'characteristics')
      for (let characteristicIndex = 0; characteristicIndex < characteristicCount; characteristicIndex += 1) {
        const characteristicValue = requireCoreBluetoothGattArrayEntry(
          characteristics,
          characteristicIndex,
          'characteristics'
        )
        const characteristic = requireCoreBluetoothGattRecord(characteristicValue, 'characteristic', [
          'uuid',
          'occurrence',
          'readable',
          'writableWithResponse',
          'writableWithoutResponse',
          'notifiable',
          'descriptors'
        ])
        const characteristicUuid = requireCoreBluetoothGattUuid(
          requireCoreBluetoothGattProperty(characteristic, 'uuid', 'characteristic-uuid'),
          'characteristic-uuid'
        )
        const characteristicOccurrence = requireCoreBluetoothGattOccurrence(
          requireCoreBluetoothGattProperty(characteristic, 'occurrence', 'characteristic-occurrence'),
          'characteristic-occurrence'
        )
        assertCoreBluetoothGattIdentity(
          characteristicIdentities,
          characteristicUuid,
          characteristicOccurrence,
          'characteristic-identity'
        )
        requireCoreBluetoothGattBoolean(
          requireCoreBluetoothGattProperty(characteristic, 'readable', 'characteristic-readable'),
          'characteristic-readable'
        )
        requireCoreBluetoothGattBoolean(
          requireCoreBluetoothGattProperty(
            characteristic,
            'writableWithResponse',
            'characteristic-writable-with-response'
          ),
          'characteristic-writable-with-response'
        )
        requireCoreBluetoothGattBoolean(
          requireCoreBluetoothGattProperty(
            characteristic,
            'writableWithoutResponse',
            'characteristic-writable-without-response'
          ),
          'characteristic-writable-without-response'
        )
        requireCoreBluetoothGattBoolean(
          requireCoreBluetoothGattProperty(characteristic, 'notifiable', 'characteristic-notifiable'),
          'characteristic-notifiable'
        )
        const descriptors = requireCoreBluetoothGattArray(
          requireCoreBluetoothGattProperty(characteristic, 'descriptors', 'descriptors'),
          'descriptors'
        )
        const descriptorIdentities = new Set<string>()
        const descriptorCount = requireCoreBluetoothGattArrayLength(descriptors, 'descriptors')
        for (let descriptorIndex = 0; descriptorIndex < descriptorCount; descriptorIndex += 1) {
          const descriptorValue = requireCoreBluetoothGattArrayEntry(descriptors, descriptorIndex, 'descriptors')
          const descriptor = requireCoreBluetoothGattRecord(descriptorValue, 'descriptor', ['uuid', 'occurrence'])
          const descriptorUuid = requireCoreBluetoothGattUuid(
            requireCoreBluetoothGattProperty(descriptor, 'uuid', 'descriptor-uuid'),
            'descriptor-uuid'
          )
          const descriptorOccurrence = requireCoreBluetoothGattOccurrence(
            requireCoreBluetoothGattProperty(descriptor, 'occurrence', 'descriptor-occurrence'),
            'descriptor-occurrence'
          )
          assertCoreBluetoothGattIdentity(
            descriptorIdentities,
            descriptorUuid,
            descriptorOccurrence,
            'descriptor-identity'
          )
        }
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
    const adapterLossCleanup = this.adapterLossCleanup
    if (adapterLossCleanup !== null) {
      await adapterLossCleanup
    }
    await this.operationLifecycle.waitForIdle()
    await this.dispatcher.waitForIdle()
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
      this.databaseChangedListener?.()
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
