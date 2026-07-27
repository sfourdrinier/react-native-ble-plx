// src/web/web-bluetooth-backend.ts

import type { AdvertisementField, AdvertisementObservation, OwnerScanOptions } from '../backend-contract/advertisement'
import type {
  BackendAttachment,
  BackendConnection,
  BackendEvent,
  BleCentralBackend,
  ConnectionLease,
  GattBackend,
  ResourceCounters,
  ScanLease
} from '../backend-contract/backend'
import { BackendContractError, contractError } from '../backend-contract/errors'
import type { BleErrorCode, CleanupFailure, CleanupRecord } from '../backend-contract/errors'
import type {
  AdapterDescriptor,
  AdapterStateSnapshot,
  AdapterStateWatch,
  AttachmentRecord,
  BackendProvider,
  HostNeutralBackendIdentity,
  ProviderDescriptor
} from '../backend-contract/identity'
import type { CharacteristicPath, DescriptorPath } from '../backend-contract/gatt'
import type {
  PublicOperationOptions,
  SubscriptionOptions,
  WritePolicy,
  WriteReceipt
} from '../backend-contract/operations'
import {
  canonicalUuid,
  capacity,
  createAttachmentBoundIdFactory,
  monotonicTimestamp,
  negotiateCoreVersions,
  opaqueId,
  resourceCount,
  version,
  versionRange
} from '../backend-contract/primitives'
import type {
  AdapterId,
  AttachmentBinding,
  BackendCompatibilityOffer,
  ClientId,
  Deadline,
  GenerationId,
  HostNeutralVersionAxes,
  OwnedBytes,
  PeerId
} from '../backend-contract/primitives'
import type { BoundedAsyncStream, StreamLimits } from '../backend-contract/streams'
import type { ChooserRequest, ChooserSelection, WebChooser } from '../backend-contract/host/web'
import { CoreBoundedStream } from '../core/bounded-stream'
import type {
  WebBluetoothBoundary,
  WebBluetoothDeviceSelection,
  WebBluetoothRequestDeviceOptions,
  WebBluetoothTimerHandle
} from './web-bluetooth-boundary'
import { normalizeWebBluetoothError, validateWebChooserRequest, webCleanupFailure } from './web-bluetooth-errors'
import { createWebBluetoothFeatureRegistry } from './web-feature-registry'
import { WebBluetoothGattRuntime } from './web-bluetooth-gatt'
import { WebBackendConnection, WebConnectionLease, WebGattDatabase, WebScanLease } from './web-bluetooth-handles'
import type { WebConnectionRecord, WebPendingConnection, WebSelectedDevice } from './web-bluetooth-handles'

const WEB_ATTACHMENT = 'web-bluetooth'
const WEB_ADAPTER_ID = opaqueId('web-bluetooth-default', 'adapter', WEB_ATTACHMENT)
const DEFAULT_STREAM_LIMITS: StreamLimits = {
  itemCapacity: capacity(32),
  byteCapacity: capacity(512 * 1024),
  reservedControlCapacity: capacity(1)
}
const LOCAL_COMPATIBILITY: BackendCompatibilityOffer = {
  backendContract: versionRange(version('backend-contract', 1), version('backend-contract', 1)),
  capabilitySchema: versionRange(version('capability-schema', 1), version('capability-schema', 1)),
  eventSchema: versionRange(version('event-schema', 1), version('event-schema', 1)),
  traceFormat: versionRange(version('trace-format', 1), version('trace-format', 1))
}
const RELEASED: CleanupRecord = { state: 'released', failures: [] }

let nextBackendInstance = 1

interface AbortableOperation {
  readonly signal: AbortSignal | null
  readonly deadline: Deadline | null
}

interface WebProviderOptions {
  readonly boundary: WebBluetoothBoundary
}

/** Explicit Web Bluetooth provider. Importing this module never reads DOM globals. */
export class WebBluetoothProvider implements BackendProvider<string, HostNeutralBackendIdentity<string>> {
  readonly descriptor: ProviderDescriptor = {
    providerId: 'unified-ble:web-bluetooth',
    hostKind: 'browser',
    loadability: 'loadable',
    compatibility: LOCAL_COMPATIBILITY
  }

  constructor(private readonly options: WebProviderOptions) {}

  async listAdapters(): Promise<readonly AdapterDescriptor<string>[]> {
    const available = await this.options.boundary.bluetoothAvailable()
    return [webAdapterDescriptor(this.options.boundary, available)]
  }

  async create(selection: { readonly selectedAdapterId: AdapterId<string> }): Promise<WebBluetoothBackend> {
    if (selection.selectedAdapterId !== WEB_ADAPTER_ID) {
      throw contractError('adapter.selection-required', 'adapter', 'web-provider.create')
    }
    return new WebBluetoothBackend(this.options.boundary)
  }
}

export function createWebBluetoothProvider(boundary: WebBluetoothBoundary): WebBluetoothProvider {
  return new WebBluetoothProvider({ boundary })
}

/** Contract-v1 Web Bluetooth backend with chooser-limited discovery semantics. */
export class WebBluetoothBackend
  implements BleCentralBackend<string, HostNeutralBackendIdentity<string>>, WebChooser<string>
{
  readonly features
  readonly adapter: BleCentralBackend<string, HostNeutralBackendIdentity<string>>['adapter']
  readonly scanner: BleCentralBackend<string, HostNeutralBackendIdentity<string>>['scanner']
  readonly connections: BleCentralBackend<string, HostNeutralBackendIdentity<string>>['connections']
  readonly gatt: GattBackend<string>

  private readonly backendInstance: number
  private readonly attachmentRecord: AttachmentRecord<string>
  private negotiatedVersions: HostNeutralVersionAxes
  private attached = false
  private destroyed = false
  private chooserBusy = false
  private nextPeer = 1
  private nextScan = 1
  private nextConnection = 1
  private ingressOrdinal = 1
  private activeScan: WebScanLease | null = null
  private destroyResult: Promise<CleanupRecord> | null = null
  private readonly selectedDevices = new Map<string, WebSelectedDevice>()
  private readonly peerByBrowserDeviceId = new Map<string, PeerId<string>>()
  private readonly connectionsByPeer = new Map<string, WebConnectionRecord>()
  private readonly pendingConnectionsByPeer = new Map<string, WebPendingConnection>()
  private readonly eventStreams = new Set<CoreBoundedStream<BackendEvent<string>>>()
  private readonly adapterStreams = new Set<CoreBoundedStream<AdapterStateSnapshot<string>>>()
  private readonly destroyWaiters = new Set<() => void>()
  private readonly gattRuntime: WebBluetoothGattRuntime
  private removePageLifecycleListener: (() => void) | null

  constructor(private readonly boundary: WebBluetoothBoundary) {
    this.backendInstance = nextBackendInstance
    nextBackendInstance += 1
    const generation = opaqueId(`web-backend-generation-${this.backendInstance}`, 'backend-generation', WEB_ATTACHMENT)
    this.attachmentRecord = {
      attachmentId: opaqueId(`web-attachment-${this.backendInstance}`, 'attachment', WEB_ATTACHMENT),
      backendInstanceId: opaqueId(`web-backend-${this.backendInstance}`, 'backend-instance', WEB_ATTACHMENT),
      backendGeneration: generation,
      adapter: webAdapterDescriptor(boundary, true, generation)
    }
    this.negotiatedVersions = negotiateCoreVersions(LOCAL_COMPATIBILITY, LOCAL_COMPATIBILITY)
    this.features = createWebBluetoothFeatureRegistry(boundary.implementationVersion)
    this.adapter = {
      currentState: async () => this.currentAdapterState(),
      watchState: async () => this.watchAdapterState()
    }
    this.scanner = {
      start: async (options, clientId) => this.startChooserScan(options, clientId),
      join: async () => {
        throw contractError('capability.unsupported', 'chooser', 'web-scanner.join')
      }
    }
    this.connections = {
      connect: async (peerId, _clientId, options) => this.connect(peerId, options)
    }
    this.gattRuntime = new WebBluetoothGattRuntime(this)
    this.gatt = this.gattRuntime.gatt
    this.removePageLifecycleListener = boundary.addPageLifecycleListener(reason => {
      const cleanup = this.destroy()
      cleanup.then(result => {
        if (result.state === 'release-failed') {
          console.error(`[WebBluetoothBackend.pageLifecycle] ${reason} cleanup failed:`, result.failures)
        }
      })
    })
  }

  get identity(): HostNeutralBackendIdentity<string> {
    return {
      registeredBackendId: 'unified-ble:web-bluetooth',
      registeredPlatformId: `web:${this.boundary.browserEngine}`,
      attachment: this.attachmentRecord,
      versions: this.negotiatedVersions,
      runtime: {
        hostKind: 'browser',
        implementationVersion: this.boundary.implementationVersion,
        diagnostics: {
          browserEngine: this.boundary.browserEngine,
          chooserDiscovery: true,
          continuousScan: false,
          backgroundOperation: false,
          stateRestoration: false
        }
      }
    }
  }

  get attachment(): AttachmentRecord<string> {
    return this.attachmentRecord
  }

  async attach(request: {
    readonly coreCompatibility: BackendCompatibilityOffer
  }): Promise<BackendAttachment<string, HostNeutralBackendIdentity<string>>> {
    this.assertUsable('web-backend.attach')
    if (this.attached) {
      throw contractError('lifecycle.invalid-state', 'core', 'web-backend.attach')
    }
    this.negotiatedVersions = negotiateCoreVersions(LOCAL_COMPATIBILITY, request.coreCompatibility)
    this.attached = true
    return { attachment: this.attachmentRecord, identity: this.identity }
  }

  async choose(request: ChooserRequest): Promise<ChooserSelection<string>> {
    const selection = await this.chooseDevice(request, { signal: null, deadline: null })
    return { peerId: selection.peerId, grantedServices: [...selection.grantedServices].map(canonicalUuid) }
  }

  events(): BoundedAsyncStream<BackendEvent<string>> {
    this.assertUsable('web-backend.events')
    const stream = new CoreBoundedStream<BackendEvent<string>>(DEFAULT_STREAM_LIMITS, 'error')
    this.eventStreams.add(stream)
    return stream
  }

  resourceCounters(): ResourceCounters {
    return {
      activeScanControllers: resourceCount(this.activeScan === null ? 0 : 1),
      scanConsumers: resourceCount(this.activeScan === null ? 0 : 1),
      chooserSessions: resourceCount(this.chooserBusy ? 1 : 0),
      connectionLeases: resourceCount(this.connectionsByPeer.size),
      physicalLinks: resourceCount(
        this.connectionsByPeer.size +
          [...this.pendingConnectionsByPeer.values()].filter(pending => pending.device.gatt.connected).length
      ),
      databaseSnapshots: resourceCount(
        [...this.connectionsByPeer.values()].filter(record => record.database !== null).length
      ),
      physicalCccdEnablements: resourceCount(this.gattRuntime.subscriptionCount()),
      subscriptionConsumers: resourceCount(this.gattRuntime.subscriptionCount()),
      queuedOperations: resourceCount(this.pendingConnectionsByPeer.size),
      dispatchedOperations: resourceCount(0),
      retainedByteBuffers: resourceCount(this.gattRuntime.retainedSubscriptionCount()),
      restorationRecords: resourceCount(0),
      orphanedIpcOwners: resourceCount(0)
    }
  }

  destroy(): Promise<CleanupRecord> {
    if (this.destroyResult === null) {
      this.destroyed = true
      const destruction = this.destroyAllResources()
      this.destroyResult = destruction.then(
        result => {
          if (result.state === 'release-failed') {
            this.destroyResult = null
          }
          return result
        },
        error => {
          this.destroyResult = null
          throw error
        }
      )
    }
    return this.destroyResult
  }

  async disconnectConnection(connection: WebBackendConnection): Promise<CleanupRecord> {
    const record = this.connectionsByPeer.get(String(connection.peerId))
    if (record === undefined || record.connection !== connection) {
      return RELEASED
    }
    return this.disconnectRecord(record)
  }

  async disconnectRecord(record: WebConnectionRecord): Promise<CleanupRecord> {
    if (!record.valid) {
      return RELEASED
    }
    const subscriptionCleanup = await this.gattRuntime.stopConnectionSubscriptions(record)
    if (subscriptionCleanup.state === 'release-failed') {
      return subscriptionCleanup
    }
    try {
      if (record.device.gatt.connected) {
        record.device.gatt.disconnect()
      }
      this.invalidateConnection(record, 'owner-released')
      return RELEASED
    } catch (error) {
      console.error('[WebBluetoothBackend.disconnectRecord] Browser disconnect failed:', error)
      return webCleanupFailure('connection', 'web-connection.disconnect')
    }
  }

  staleGattError(operation: string): BackendContractError {
    return contractError('gatt.stale-handle', 'gatt', operation)
  }

  async readDirect(
    database: WebGattDatabase,
    path: CharacteristicPath<string, string, string, string, string, 'current'>,
    options: PublicOperationOptions
  ): Promise<OwnedBytes> {
    return this.gattRuntime.readDirect(database, path, options)
  }

  async writeDirect(
    database: WebGattDatabase,
    path: CharacteristicPath<string, string, string, string, string, 'current'>,
    value: Readonly<Uint8Array>,
    options: WritePolicy
  ): Promise<WriteReceipt<string, string>> {
    return this.gattRuntime.writeDirect(database, path, value, options)
  }

  async readDescriptorDirect(
    database: WebGattDatabase,
    path: DescriptorPath<string, string, string, string, string, string, 'current'>,
    options: PublicOperationOptions
  ): Promise<OwnedBytes> {
    return this.gattRuntime.readDescriptorDirect(database, path, options)
  }

  async writeDescriptorDirect(
    database: WebGattDatabase,
    path: DescriptorPath<string, string, string, string, string, string, 'current'>,
    value: Readonly<Uint8Array>,
    options: WritePolicy
  ): Promise<WriteReceipt<string, string>> {
    return this.gattRuntime.writeDescriptorDirect(database, path, value, options)
  }

  async subscribeDirect(
    database: WebGattDatabase,
    path: CharacteristicPath<string, string, string, string, string, 'current'>,
    options: SubscriptionOptions
  ): Promise<import('../backend-contract/gatt').Subscription<string, string, string, string, string, string>> {
    return this.gattRuntime.subscribeDirect(database, path, options)
  }

  private async currentAdapterState(): Promise<AdapterStateSnapshot<string>> {
    const available = await this.boundary.bluetoothAvailable()
    return webAdapterDescriptor(this.boundary, available, this.attachmentRecord.backendGeneration).state
  }

  private async watchAdapterState(): Promise<AdapterStateWatch<string>> {
    const initial = await this.currentAdapterState()
    const transitions = new CoreBoundedStream<AdapterStateSnapshot<string>>(DEFAULT_STREAM_LIMITS, 'latest')
    this.adapterStreams.add(transitions)
    return { initial, transitions }
  }

  private async startChooserScan(
    options: OwnerScanOptions<string, string>,
    _clientId: ClientId<string, string>
  ): Promise<ScanLease<string, string>> {
    this.assertAttached('web-scanner.start')
    if (this.activeScan !== null) {
      throw contractError('scan.already-active', 'scan', 'web-scanner.start')
    }
    const optionalServices = options.filter.serviceUuids
    const selection = await this.chooseDevice(
      {
        filters: [options.filter],
        acceptAllDevices: options.filter.serviceUuids.length === 0 && options.filter.localNamePrefix === null,
        optionalServices
      },
      options
    )
    const stream = new CoreBoundedStream<AdvertisementObservation<string>>(
      options.delivery,
      options.delivery.overflowPolicy
    )
    const scanNumber = this.nextScan
    this.nextScan += 1
    const identifiers = this.identifiers()
    let stopped = false
    const lease = new WebScanLease(
      identifiers.scanSessionId(`web-chooser-${scanNumber}`),
      identifiers.leaseId(`web-chooser-${scanNumber}`),
      stream,
      async () => {
        if (stopped) {
          return RELEASED
        }
        stopped = true
        if (this.activeScan === lease) {
          this.activeScan = null
        }
        await stream.close()
        return RELEASED
      }
    )
    this.activeScan = lease
    stream.emit(this.chooserObservation(selection), 1)
    return lease
  }

  private async chooseDevice(request: ChooserRequest, operation: AbortableOperation): Promise<WebSelectedDevice> {
    this.assertAttached('web-chooser.choose')
    if (!this.boundary.isSecureContext()) {
      throw contractError('chooser.insecure-context', 'chooser', 'web-chooser.choose')
    }
    if (!this.boundary.hasTransientUserActivation()) {
      throw contractError('chooser.user-activation-required', 'chooser', 'web-chooser.choose')
    }
    if (this.chooserBusy) {
      throw contractError('chooser.busy', 'chooser', 'web-chooser.choose')
    }
    validateWebChooserRequest(request)
    this.chooserBusy = true
    const browserRequest: WebBluetoothRequestDeviceOptions = {
      filters: request.filters.map(filter => ({
        services: filter.serviceUuids,
        namePrefix: filter.localNamePrefix
      })),
      acceptAllDevices: request.acceptAllDevices,
      optionalServices: [...request.optionalServices]
    }
    const browserSelection = Promise.resolve().then(() => this.boundary.requestDevice(browserRequest))
    browserSelection.then(
      () => {
        this.chooserBusy = false
      },
      () => {
        this.chooserBusy = false
      }
    )
    const selected = await this.runAbortable(
      null,
      operation,
      () => browserSelection,
      'chooser.cancelled',
      'chooser',
      'web-chooser.choose'
    )
    this.assertUsable('web-chooser.choose')
    return this.rememberSelection(selected)
  }

  private rememberSelection(selection: WebBluetoothDeviceSelection): WebSelectedDevice {
    let peerId = this.peerByBrowserDeviceId.get(selection.device.id)
    if (peerId === undefined) {
      peerId = opaqueId(`web-device-${this.nextPeer}`, 'peer', WEB_ATTACHMENT)
      this.nextPeer += 1
      this.peerByBrowserDeviceId.set(selection.device.id, peerId)
    }
    const selected: WebSelectedDevice = {
      peerId,
      device: selection.device,
      grantedServices: new Set(selection.grantedServices.map(String))
    }
    this.selectedDevices.set(String(peerId), selected)
    return selected
  }

  private chooserObservation(selection: WebSelectedDevice): AdvertisementObservation<string> {
    const unavailable = (reason: string): AdvertisementField<never> => ({
      state: 'unavailable',
      reason,
      provenance: 'not-provided'
    })
    const localName: AdvertisementObservation<string>['localName'] =
      selection.device.name === null
        ? unavailable('chooser did not expose a device name')
        : { state: 'present', value: selection.device.name, provenance: 'observed' }
    const observation: AdvertisementObservation<string> = {
      peerId: selection.peerId,
      observedAt: monotonicTimestamp(this.boundary.now()),
      source: 'platform-derived',
      ingressOrdinal: this.ingressOrdinal,
      localName,
      rssi: unavailable('Web Bluetooth chooser does not expose RSSI'),
      txPower: unavailable('Web Bluetooth chooser does not expose transmit power'),
      connectable: unavailable('Web Bluetooth chooser does not expose connectability'),
      appearance: unavailable('Web Bluetooth chooser does not expose appearance'),
      serviceUuids: unavailable('granted services are authorization, not advertisement data'),
      solicitedServiceUuids: unavailable('Web Bluetooth chooser does not expose solicited services'),
      overflowServiceUuids: unavailable('Web Bluetooth chooser does not expose overflow services'),
      serviceData: unavailable('Web Bluetooth chooser does not expose service data'),
      manufacturerData: unavailable('Web Bluetooth chooser does not expose manufacturer data'),
      rawRecord: unavailable('Web Bluetooth chooser does not expose raw advertising bytes'),
      scanResponseRecord: unavailable('Web Bluetooth chooser does not expose scan-response bytes')
    }
    this.ingressOrdinal += 1
    return observation
  }

  private async connect(
    peerId: PeerId<string>,
    options: PublicOperationOptions
  ): Promise<ConnectionLease<string, string, string>> {
    this.assertAttached('web-connection.connect')
    const peerKey = String(peerId)
    if (this.connectionsByPeer.has(peerKey) || this.pendingConnectionsByPeer.has(peerKey)) {
      throw contractError('connection.already-owned', 'connection', 'web-connection.connect')
    }
    const selected = this.selectedDevices.get(String(peerId))
    if (selected === undefined) {
      throw contractError('connection.not-found', 'connection', 'web-connection.connect')
    }
    const pending: WebPendingConnection = {
      peerId,
      device: selected.device,
      grantedServices: selected.grantedServices,
      ownershipToken: {},
      nativeConnect: Promise.resolve(),
      state: 'connecting',
      cleanupFailureReported: false
    }
    this.pendingConnectionsByPeer.set(peerKey, pending)
    pending.nativeConnect = Promise.resolve().then(() => selected.device.gatt.connect())
    pending.nativeConnect.then(
      () => undefined,
      error => {
        console.error('[WebBluetoothBackend.connect] Browser connect rejected:', error)
        this.deletePendingConnectionIfOwned(pending)
      }
    )
    try {
      await this.runAbortable(
        null,
        options,
        () => pending.nativeConnect,
        'connection.failed',
        'connection',
        'web-connection.connect',
        () => this.compensatePendingConnection(pending)
      )
    } catch (error) {
      if (
        error instanceof BackendContractError &&
        error.normalized.code !== 'operation.aborted' &&
        error.normalized.code !== 'operation.timed-out' &&
        error.normalized.code !== 'operation.cancelled-by-destroy'
      ) {
        this.deletePendingConnectionIfOwned(pending)
      }
      throw error
    }
    if (this.pendingConnectionsByPeer.get(peerKey) !== pending || this.destroyed) {
      await this.compensatePendingConnection(pending)
      throw contractError('operation.cancelled-by-destroy', 'connection', 'web-connection.connect')
    }
    const connectionNumber = this.nextConnection
    this.nextConnection += 1
    const connection = new WebBackendConnection(
      this,
      peerId,
      this.identifiers().connectionId(`web-connection-${connectionNumber}`),
      opaqueId(
        `web-connection-generation-${connectionNumber}`,
        'connection-generation',
        `${WEB_ATTACHMENT}:${String(peerId)}`
      )
    )
    const leaseId = this.identifiers().leaseId(`web-connection-lease-${connectionNumber}`)
    let record: WebConnectionRecord | null = null
    const disconnectListener = () => {
      if (record !== null) {
        this.invalidateConnection(record, 'connection-lost')
      }
    }
    record = {
      peerId,
      device: selected.device,
      grantedServices: selected.grantedServices,
      connection,
      leaseId,
      disconnectListener,
      disconnectWaiters: new Set(),
      database: null,
      valid: true
    }
    selected.device.addDisconnectListener(disconnectListener)
    this.deletePendingConnectionIfOwned(pending)
    this.connectionsByPeer.set(peerKey, record)
    return new WebConnectionLease(this, record, leaseId)
  }

  private async compensatePendingConnection(pending: WebPendingConnection): Promise<void> {
    if (pending.state === 'compensating') {
      return
    }
    pending.state = 'compensating'
    try {
      if (pending.device.gatt.connected) {
        pending.device.gatt.disconnect()
      }
      this.deletePendingConnectionIfOwned(pending)
    } catch (error) {
      pending.state = 'cleanup-failed'
      pending.cleanupFailureReported = false
      console.error('[WebBluetoothBackend.compensatePendingConnection] Browser disconnect failed:', error)
    }
  }

  private deletePendingConnectionIfOwned(pending: WebPendingConnection): void {
    const peerKey = String(pending.peerId)
    if (this.pendingConnectionsByPeer.get(peerKey) === pending) {
      this.pendingConnectionsByPeer.delete(peerKey)
    }
  }

  private invalidateConnection(record: WebConnectionRecord, reason: 'connection-lost' | 'owner-released'): void {
    if (!record.valid) {
      return
    }
    record.valid = false
    record.connection.transition(reason === 'connection-lost' ? 'lost' : 'disconnected')
    record.device.removeDisconnectListener(record.disconnectListener)
    record.database?.invalidate()
    for (const waiter of [...record.disconnectWaiters]) {
      waiter()
    }
    record.disconnectWaiters.clear()
    this.gattRuntime.invalidateConnection(record, reason)
    this.connectionsByPeer.delete(String(record.peerId))
    if (reason === 'connection-lost') {
      this.emitBackendEvent({
        attachment: this.attachmentRecord,
        attachmentId: this.attachmentRecord.attachmentId,
        ingressOrdinal: this.ingressOrdinal,
        kind: 'connection-lost',
        connection: {
          attachment: this.attachmentRecord,
          attachmentId: this.attachmentRecord.attachmentId,
          peerId: record.peerId,
          connectionId: record.connection.connectionId,
          ownerLeaseId: record.leaseId,
          connectionGeneration: record.connection.connectionGeneration
        }
      })
      this.ingressOrdinal += 1
    }
  }

  requireConnection(connection: BackendConnection<string, string>, operation: string): WebConnectionRecord {
    const record = this.connectionsByPeer.get(String(connection.peerId))
    if (record === undefined || record.connection !== connection || !record.valid) {
      throw contractError('connection.stale', 'connection', operation)
    }
    return record
  }

  requireDatabase(
    path:
      | CharacteristicPath<string, string, string, string, string>
      | DescriptorPath<string, string, string, string, string, string>,
    operation: string
  ): WebGattDatabase {
    const record = this.connectionsByPeer.get(String(path.peerId))
    const database = record?.database
    if (
      record === undefined ||
      database === null ||
      database === undefined ||
      !record.valid ||
      database.path.databaseId !== path.databaseId ||
      database.path.databaseGeneration !== path.databaseGeneration ||
      database.path.connectionGeneration !== path.connectionGeneration
    ) {
      throw this.staleGattError(operation)
    }
    database.assertCurrent(operation)
    return database
  }

  async runAbortable<Result>(
    record: WebConnectionRecord | null,
    operation: AbortableOperation,
    start: () => Promise<Result>,
    fallbackCode: BleErrorCode,
    domain: 'chooser' | 'connection' | 'gatt',
    operationName: string,
    onLateSuccess: ((result: Result) => Promise<void> | void) | null = null
  ): Promise<Result> {
    this.assertUsable(operationName)
    if (operation.signal?.aborted === true) {
      throw contractError('operation.aborted', domain, operationName)
    }
    if (operation.deadline !== null && this.boundary.now() >= operation.deadline) {
      throw contractError('operation.timed-out', domain, operationName)
    }
    return new Promise<Result>((resolve, reject) => {
      let settled = false
      let timer: WebBluetoothTimerHandle | null = null
      const cleanup = () => {
        operation.signal?.removeEventListener('abort', abort)
        if (timer !== null) {
          this.boundary.clearTimer(timer)
        }
        record?.disconnectWaiters.delete(disconnected)
        this.destroyWaiters.delete(destroyed)
      }
      const settleFailure = (error: BackendContractError) => {
        if (settled) {
          return
        }
        settled = true
        cleanup()
        reject(error)
      }
      const abort = () => {
        settleFailure(contractError('operation.aborted', domain, operationName))
      }
      const disconnected = () => {
        settleFailure(contractError('operation.disconnected', domain, operationName))
      }
      const destroyed = () => {
        settleFailure(contractError('operation.cancelled-by-destroy', domain, operationName))
      }
      operation.signal?.addEventListener('abort', abort, { once: true })
      record?.disconnectWaiters.add(disconnected)
      this.destroyWaiters.add(destroyed)
      if (operation.deadline !== null) {
        timer = this.boundary.setTimer(
          () => settleFailure(contractError('operation.timed-out', domain, operationName)),
          Math.max(0, Number(operation.deadline) - this.boundary.now())
        )
      }
      Promise.resolve()
        .then(start)
        .then(
          value => {
            if (settled) {
              if (onLateSuccess !== null) {
                Promise.resolve(onLateSuccess(value)).then(
                  () => undefined,
                  error => {
                    console.error(`[WebBluetoothBackend.runAbortable] ${operationName} late cleanup failed:`, error)
                  }
                )
              }
              return
            }
            if (record !== null && !record.valid) {
              disconnected()
              return
            }
            settled = true
            cleanup()
            resolve(value)
          },
          error => {
            if (settled) {
              return
            }
            const normalized =
              error instanceof Error
                ? normalizeWebBluetoothError(error, { fallbackCode, domain, operation: operationName })
                : contractError(fallbackCode, domain, operationName)
            settleFailure(normalized)
          }
        )
    })
  }

  private emitBackendEvent(event: BackendEvent<string>): void {
    for (const stream of this.eventStreams) {
      stream.emit(event, 1)
    }
  }

  identifiers() {
    const binding: AttachmentBinding<string> = {
      attachmentId: this.attachmentRecord.attachmentId,
      backendInstanceId: this.attachmentRecord.backendInstanceId,
      backendGeneration: this.attachmentRecord.backendGeneration,
      adapterId: this.attachmentRecord.adapter.adapterId,
      adapterGeneration: this.attachmentRecord.adapter.adapterGeneration
    }
    return createAttachmentBoundIdFactory(binding)
  }

  private assertAttached(operation: string): void {
    this.assertUsable(operation)
    if (!this.attached) {
      throw contractError('lifecycle.invalid-state', 'core', operation)
    }
  }

  private assertUsable(operation: string): void {
    if (this.destroyed) {
      throw contractError('lifecycle.destroyed', 'core', operation)
    }
  }

  private async destroyAllResources(): Promise<CleanupRecord> {
    const failures: CleanupFailure[] = []
    for (const waiter of [...this.destroyWaiters]) {
      waiter()
    }
    this.destroyWaiters.clear()
    for (const pending of [...this.pendingConnectionsByPeer.values()]) {
      if (pending.state === 'cleanup-failed') {
        if (!pending.cleanupFailureReported) {
          pending.cleanupFailureReported = true
          failures.push(...webCleanupFailure('connection', 'web-connection.retained-compensation-failure').failures)
          continue
        }
        await this.compensatePendingConnection(pending)
      }
      if (pending.device.gatt.connected) {
        await this.compensatePendingConnection(pending)
      }
    }
    if (this.removePageLifecycleListener !== null) {
      this.removePageLifecycleListener()
      this.removePageLifecycleListener = null
    }
    if (this.activeScan !== null) {
      const scanCleanup = await this.activeScan.stop()
      failures.push(...scanCleanup.failures)
    }
    failures.push(...(await this.gattRuntime.destroySubscriptions()))
    for (const record of [...this.connectionsByPeer.values()]) {
      const cleanup = await this.disconnectRecord(record)
      failures.push(...cleanup.failures)
    }
    for (const stream of this.eventStreams) {
      await stream.close()
    }
    this.eventStreams.clear()
    for (const stream of this.adapterStreams) {
      await stream.close()
    }
    this.adapterStreams.clear()
    this.selectedDevices.clear()
    this.peerByBrowserDeviceId.clear()
    if (this.chooserBusy) {
      failures.push(...webCleanupFailure('chooser', 'web-chooser.pending-destroy').failures)
    }
    for (const pending of this.pendingConnectionsByPeer.values()) {
      failures.push(
        ...webCleanupFailure(
          'connection',
          pending.state === 'cleanup-failed' ? 'web-connection.compensation-failed' : 'web-connection.pending-destroy'
        ).failures
      )
    }
    return failures.length === 0 ? RELEASED : { state: 'release-failed', failures }
  }
}

function webAdapterDescriptor(
  boundary: WebBluetoothBoundary,
  available: boolean,
  generation: GenerationId<'backend-generation', string> = opaqueId(
    'web-adapter-generation',
    'backend-generation',
    WEB_ATTACHMENT
  )
): AdapterDescriptor<string> {
  return {
    adapterId: WEB_ADAPTER_ID,
    displayName: 'Web Bluetooth',
    state: {
      availability: available ? 'available' : 'unavailable',
      authorization: available ? 'not-determined' : 'unavailable',
      power: available ? 'unknown' : 'unsupported',
      backendGeneration: generation,
      updatedAt: monotonicTimestamp(boundary.now()),
      safeReason: available ? null : 'Web Bluetooth is unavailable in this browser context.'
    },
    adapterGeneration: opaqueId(String(generation), 'adapter-generation', WEB_ATTACHMENT),
    limitations: [
      'chooser-based discovery only; continuous passive scanning is unavailable',
      'background execution and process-level restoration are unavailable'
    ]
  }
}

export const WEB_BLUETOOTH_ADAPTER_ID = WEB_ADAPTER_ID
