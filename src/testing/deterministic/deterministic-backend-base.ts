// src/testing/deterministic/deterministic-backend-base.ts

import {
  advertisementMatchesFilter,
  type AdvertisementObservation,
  type OwnerScanOptions
} from '../../backend-contract/advertisement'
import {
  BUILT_IN_FEATURE_IDS,
  createFeatureRegistry,
  type FeatureImplementation,
  type FeatureRegistration,
  type MaximumWriteLengthFeatureImplementation,
  type MaximumWriteLengthFeatureInput,
  type MaximumWriteLengthFeatureOutput
} from '../../backend-contract/capabilities'
import { createCoreFeatureRegistry } from '../../core/core-capabilities'
import {
  BackendContractError,
  contractError,
  type BleErrorCode,
  type CleanupRecord
} from '../../backend-contract/errors'
import type {
  AdapterBackend,
  BackendAttachment,
  BackendAttachmentRequest,
  BackendEvent,
  BackendGenericEvent,
  ConnectionBackend,
  ConnectionLease,
  ScanLease,
  ScannerBackend
} from '../../backend-contract/backend'
import type {
  AdapterStateSnapshot,
  AdapterStateWatch,
  AttachmentRecord,
  HostNeutralBackendIdentity
} from '../../backend-contract/identity'
import {
  createBackendOperationDispatch,
  createOperationSettlementCoordinator,
  type BackendOperationDispatch,
  type CancellationAcknowledgement,
  type OperationOptions,
  type PublicOperationOptions
} from '../../backend-contract/operations'
import {
  byteLimit,
  capacity,
  createAttachmentBoundIdFactory,
  negotiateCoreVersions,
  opaqueId,
  version,
  versionRange,
  type AdapterId,
  type AttachmentBinding,
  type BackendCompatibilityOffer,
  type ClientId,
  type LeaseId,
  type PeerId,
  type ScanSessionId,
  type ScanShareToken,
  type SerializableRecord
} from '../../backend-contract/primitives'
import type { BoundedAsyncStream, OverflowPolicy } from '../../backend-contract/streams'
import { DeterministicBoundedStream, streamLimits } from './deterministic-stream'
import {
  defaultCompletion,
  DeterministicOperationRuntime,
  type DeterministicCompletionStage,
  type DeterministicOperationTrace,
  type ProgrammableCompletion
} from './deterministic-operation-runtime'
import { VirtualPeripheral, createDefaultVirtualPeripheral } from './virtual-peripheral'
import { DeterministicVirtualClock } from './virtual-clock'
import type { ScheduledTaskHandle } from './virtual-clock'
import {
  UNIFIED_BLE_TRACE_FORMAT,
  type DiagnosticTraceDocument,
  type DiagnosticTraceRecord
} from '../../diagnostics/trace-format'

export interface DeterministicBackendTraceRecord extends DiagnosticTraceRecord {
  readonly cause: BleErrorCode | null
}

export interface DeterministicBackendOptions {
  readonly peripheral?: VirtualPeripheral
  readonly maximumOperationBytes?: number
  readonly maximumWriteLength?: number
  readonly aggregateStreamByteQuota?: number
  readonly adapterId?: string
  readonly featureRegistrations?: readonly FeatureRegistration<
    `${string}:${string}`,
    SerializableRecord,
    SerializableRecord,
    FeatureImplementation<SerializableRecord, SerializableRecord>
  >[]
}

export interface ScanConsumer {
  readonly id: string
  readonly scanSessionId: ScanSessionId<string, string>
  readonly leaseId: LeaseId<string, string>
  readonly shareToken: ScanShareToken<string, string> | null
  readonly options: OwnerScanOptions<string, string>
  readonly stream: DeterministicBoundedStream<AdvertisementObservation<string>>
  readonly observedPayloads: Map<string, Uint8Array>
  stopped: Promise<CleanupRecord> | null
  activeAbortListener: (() => void) | null
  activeDeadlineTask: ScheduledTaskHandle | null
}

export interface ScanGroup {
  readonly signature: string
  readonly ownerLeaseId: LeaseId<string, string>
  readonly shareToken: ScanShareToken<string, string> | null
  readonly consumers: Map<string, ScanConsumer>
}

const defaultStreamLimits = streamLimits(capacity(64), capacity(1024 * 1024), capacity(1))
const defaultCompatibility: BackendCompatibilityOffer = {
  backendContract: versionRange(version('backend-contract', 1), version('backend-contract', 1)),
  capabilitySchema: versionRange(version('capability-schema', 1), version('capability-schema', 1)),
  eventSchema: versionRange(version('event-schema', 1), version('event-schema', 1)),
  traceFormat: versionRange(version('trace-format', 1), version('trace-format', 1))
}
let nextBackendInstance = 1

function allocateBackendInstance(): number {
  const allocated = nextBackendInstance
  nextBackendInstance += 1
  return allocated
}

function createDeterministicMaximumWriteLengthRegistration(
  currentMaximumWriteLength: () => number,
  now: () => number,
  maximumOperationBytes: number
) {
  const implementation: MaximumWriteLengthFeatureImplementation = Object.freeze({
    async invoke(input: MaximumWriteLengthFeatureInput): Promise<MaximumWriteLengthFeatureOutput> {
      if (
        input.connectionId.length === 0 ||
        input.connectionGeneration.length === 0 ||
        (input.mode !== 'with-response' && input.mode !== 'without-response')
      ) {
        throw contractError('argument.invalid', 'gatt', 'deterministic.maximum-write-length-observation')
      }
      return Object.freeze({
        connectionId: input.connectionId,
        connectionGeneration: input.connectionGeneration,
        mode: input.mode,
        maximumWriteLength: currentMaximumWriteLength(),
        observedAtMonotonicMs: now()
      })
    }
  })
  const limitations = Object.freeze([
    Object.freeze({
      code: 'deterministic-virtual-peripheral',
      explanation: 'The reported limit belongs to the deterministic virtual peripheral, not a live radio link.',
      affectedGuarantee: 'No live-platform maximum-write-length support is evidenced by this backend.'
    })
  ])
  const scenarioIds = Object.freeze(['gatt.maximum-write-length-boundaries'])
  return Object.freeze({
    id: BUILT_IN_FEATURE_IDS.maximumWriteLength,
    state: 'limited' as const,
    selectedSchemaRange: versionRange(version('capability-schema', 1), version('capability-schema', 1)),
    implementationOrigin: 'backend-native' as const,
    implementation,
    tck: Object.freeze({
      suiteId: 'tck.feature.gatt.maximum-write-length',
      requiredScenarioIds: scenarioIds,
      contractRange: versionRange(version('capability-schema', 1), version('capability-schema', 1))
    }),
    evidence: Object.freeze({
      receiptId: 'deterministic-maximum-write-length-v1',
      evidenceLevel: 'deterministic' as const,
      implementationVersion: '4.0.0',
      sourceDigest: 'deterministic-virtual-peripheral-max-write-length-v1',
      scenarioIds,
      limitations
    }),
    limitations,
    limits: Object.freeze({
      maximumWriteLength: Object.freeze({ minimum: 1, maximum: maximumOperationBytes, unit: 'bytes' })
    })
  })
}

/** Shared deterministic radio, attachment, stream, and operation mechanics. */
export abstract class DeterministicBackendBase {
  readonly clock = new DeterministicVirtualClock()
  readonly peripheral: VirtualPeripheral
  readonly adapter: AdapterBackend<string>
  readonly scanner: ScannerBackend<string>
  readonly connections: ConnectionBackend<string>
  readonly features

  protected readonly maximumOperationBytes
  protected currentMaximumWriteLength: number
  protected readonly aggregateStreamByteQuota
  protected readonly eventStreams = new Set<DeterministicBoundedStream<BackendEvent<string>>>()
  protected readonly stateWatchers = new Set<DeterministicBoundedStream<AdapterStateSnapshot<string>>>()
  protected scanGroup: ScanGroup | null = null
  protected readonly plans = new Map<DeterministicCompletionStage, ProgrammableCompletion[]>()
  protected readonly traceRecords: DeterministicBackendTraceRecord[] = []
  protected traceTruncated = false
  protected readonly operations: DeterministicOperationRuntime
  protected adapterState: AdapterStateSnapshot<string>
  protected backendGeneration = 1
  protected backendInstance: number
  protected nextScanLease = 1
  protected nextBackendOperation = 1
  protected destroyed = false
  protected ingressOrdinal = 1
  protected readonly adapterIdentifier: AdapterId<string>
  private attached = false

  constructor(options: DeterministicBackendOptions = {}) {
    this.backendInstance = allocateBackendInstance()
    this.peripheral = options.peripheral ?? createDefaultVirtualPeripheral()
    this.maximumOperationBytes = byteLimit(options.maximumOperationBytes ?? 512 * 1024)
    this.currentMaximumWriteLength = options.maximumWriteLength ?? 20
    this.assertMaximumWriteLength(this.currentMaximumWriteLength)
    const backendFeatures = createFeatureRegistry(
      Object.freeze([
        createDeterministicMaximumWriteLengthRegistration(
          () => this.currentMaximumWriteLength,
          () => Number(this.clock.now()),
          Number(this.maximumOperationBytes)
        ),
        ...(options.featureRegistrations ?? [])
      ])
    )
    this.features = createCoreFeatureRegistry(backendFeatures)
    this.aggregateStreamByteQuota = options.aggregateStreamByteQuota ?? 4 * 1024 * 1024
    if (!Number.isSafeInteger(this.aggregateStreamByteQuota) || this.aggregateStreamByteQuota < 1) {
      throw new Error('deterministic aggregate stream quota must be a positive safe integer')
    }
    this.adapterIdentifier = opaqueId(options.adapterId ?? 'deterministic-adapter', 'adapter', 'deterministic')
    this.adapterState = this.createAdapterState('available', 'granted', 'on', null)
    this.operations = new DeterministicOperationRuntime(
      this.clock,
      stage => this.takePlan(stage),
      trace => {
        this.recordOperationTrace(trace)
      }
    )
    this.adapter = {
      currentState: async () => this.currentAdapterState(),
      watchState: async () => this.createStateWatch()
    }
    this.scanner = {
      start: async (optionsValue, clientId) => this.startScan(optionsValue, clientId),
      join: async (leaseId, token, clientId) => this.joinScan(leaseId, token, clientId)
    }
    this.connections = {
      connect: async (peerId, clientId, optionsValue) => this.connect(peerId, clientId, optionsValue)
    }
    this.recordTrace('attachment', 'created', null)
  }

  abstract get identity(): HostNeutralBackendIdentity<string>

  events(): BoundedAsyncStream<BackendEvent<string>> {
    const stream = new DeterministicBoundedStream<BackendEvent<string>>(defaultStreamLimits, 'error')
    this.eventStreams.add(stream)
    return stream
  }

  async attach(
    request: BackendAttachmentRequest
  ): Promise<BackendAttachment<string, HostNeutralBackendIdentity<string>>> {
    this.assertUsable('backend.attach')
    if (this.attached) {
      throw contractError('lifecycle.invalid-state', 'core', 'backend.attach')
    }
    negotiateCoreVersions(defaultCompatibility, request.coreCompatibility)
    const identity = this.identity
    this.attached = true
    return { attachment: identity.attachment, identity }
  }

  queueCompletion(stage: DeterministicCompletionStage, completion: ProgrammableCompletion): void {
    const plans = this.plans.get(stage) ?? []
    plans.push(completion)
    this.plans.set(stage, plans)
  }

  setMaximumWriteLength(maximumWriteLength: number): void {
    this.assertUsable('gatt.set-maximum-write-length')
    this.assertMaximumWriteLength(maximumWriteLength)
    this.currentMaximumWriteLength = maximumWriteLength
    this.recordTrace('operation', 'maximum-write-length-updated', null)
  }

  emitAdvertisement(observation: AdvertisementObservation<string>): void {
    this.assertUsable('emitAdvertisement')
    const group = this.scanGroup
    if (group === null) {
      this.recordTrace('stream', 'late-advertisement-suppressed', null)
      return
    }
    for (const consumer of group.consumers.values()) {
      if (!this.matchesScan(consumer.options, observation)) {
        continue
      }
      const sessionObservation = Object.freeze({ ...observation, scanSessionId: consumer.scanSessionId })
      const peerKey = String(sessionObservation.device.id)
      const previousPayload = consumer.observedPayloads.get(peerKey)
      if (consumer.options.duplicatePolicy === 'first' && previousPayload !== undefined) {
        continue
      }
      if (
        consumer.options.duplicatePolicy === 'merged' &&
        previousPayload !== undefined &&
        sessionObservation.rawRecord.state === 'present' &&
        equalBytes(previousPayload, sessionObservation.rawRecord.value)
      ) {
        continue
      }
      if (sessionObservation.rawRecord.state === 'present') {
        consumer.observedPayloads.set(peerKey, new Uint8Array(sessionObservation.rawRecord.value))
      } else if (consumer.options.duplicatePolicy === 'first') {
        consumer.observedPayloads.set(peerKey, new Uint8Array())
      }
      const outcome = this.pushWithinAggregateQuota(
        consumer.stream,
        sessionObservation,
        advertisementByteLength(sessionObservation),
        String(sessionObservation.device.id)
      )
      if (outcome.terminated) {
        this.recordTrace('stream', 'scan-overflow-terminal', outcome.quotaExceeded ? 'stream.quota' : 'stream.overflow')
        this.observeCleanup(this.stopScanConsumer(consumer), 'scan-overflow-stop-failed')
      }
    }
  }

  setAdapterState(
    availability: AdapterStateSnapshot<string>['availability'],
    authorization: AdapterStateSnapshot<string>['authorization'],
    power: AdapterStateSnapshot<string>['power'],
    safeReason: string | null
  ): void {
    this.adapterState = this.createAdapterState(availability, authorization, power, safeReason)
    for (const watcher of this.stateWatchers) {
      watcher.push(this.currentAdapterState(), 1, 'adapter-state')
    }
    this.emitEvent('adapter-state')
    if (availability !== 'available' || authorization !== 'granted' || power !== 'on') {
      this.handleAdapterUnavailable()
      this.stopAllScans('adapter-scan-stop-failed')
    }
  }

  reset(): void {
    this.backendGeneration += 1
    this.backendInstance = allocateBackendInstance()
    this.handleReset()
    this.stopAllScans('reset-scan-stop-failed')
    this.adapterState = this.createAdapterState('available', 'granted', 'on', 'backend reset')
    this.emitEvent('backend-restarted')
    this.recordTrace('attachment', 'reset', 'backend.reset')
  }

  traceSnapshot(): readonly DeterministicBackendTraceRecord[] {
    return this.traceRecords.map(record => ({ ...record }))
  }

  traceDocument(): DiagnosticTraceDocument {
    return Object.freeze({
      format: UNIFIED_BLE_TRACE_FORMAT,
      truncated: this.traceTruncated,
      records: Object.freeze(this.traceRecords.map(record => Object.freeze({ ...record })))
    })
  }

  pendingBackendAcknowledgements(): number {
    return this.operations.snapshot().pendingAcknowledgements
  }

  protected async startScan(
    optionsValue: OwnerScanOptions<string, string>,
    _clientId: ClientId<string, string>
  ): Promise<ScanLease<string, string>> {
    this.assertUsable('scan.start')
    this.assertAdapterReady('scan.start')
    if (this.scanGroup !== null) {
      throw contractError('scan.already-active', 'scan', 'scan.start')
    }
    const stream = this.createStream<AdvertisementObservation<string>>(
      optionsValue.delivery,
      optionsValue.delivery.overflowPolicy
    )
    this.assertAggregateAdmission(stream)
    const created = this.createScanConsumer(optionsValue, stream)
    const candidate: ScanGroup = {
      signature: scanSignature(optionsValue),
      ownerLeaseId: created.consumer.leaseId,
      shareToken: created.consumer.shareToken,
      consumers: new Map([[created.consumer.id, created.consumer]])
    }
    await this.operations.run(
      'scan-start',
      optionsValue,
      null,
      false,
      () => {
        this.scanGroup = candidate
        this.activateScanConsumer(created.consumer)
        return undefined
      },
      () => {
        this.deactivateScanConsumer(created.consumer)
        created.consumer.stream.closeWithReason('owner-released')
        candidate.consumers.clear()
        if (this.scanGroup === candidate) {
          this.scanGroup = null
        }
      }
    )
    return created.lease
  }

  protected async joinScan(
    leaseId: LeaseId<string, string>,
    token: ScanShareToken<string, string>,
    _clientId: ClientId<string, string>
  ): Promise<ScanLease<string, string>> {
    this.assertUsable('scan.join')
    const group = this.scanGroup
    if (
      group === null ||
      String(group.ownerLeaseId) !== String(leaseId) ||
      String(group.shareToken) !== String(token)
    ) {
      throw contractError('ownership.denied', 'scan', 'scan.join')
    }
    const owner = group.consumers.get(String(group.ownerLeaseId))
    if (owner === undefined) {
      throw contractError('lifecycle.invariant-violation', 'scan', 'scan.join')
    }
    const created = this.createScanConsumer(
      owner.options,
      this.createStream(owner.options.delivery, owner.options.delivery.overflowPolicy)
    )
    this.assertAggregateAdmission(created.consumer.stream)
    group.consumers.set(created.consumer.id, created.consumer)
    this.recordTrace('resource', 'scan-shared', null)
    return created.lease
  }

  async stopScanConsumer(consumer: ScanConsumer): Promise<CleanupRecord> {
    if (consumer.stopped !== null) {
      return consumer.stopped
    }
    const stopping = this.stopScanConsumerInternal(consumer)
    consumer.stopped = stopping
    stopping.then(
      result => {
        if (result.state === 'release-failed') {
          consumer.stopped = null
        }
      },
      () => {
        consumer.stopped = null
      }
    )
    return stopping
  }

  protected createStream<Value>(
    delivery: {
      readonly itemCapacity: import('../../backend-contract/primitives').Capacity
      readonly byteCapacity: import('../../backend-contract/primitives').Capacity
      readonly reservedControlCapacity: import('../../backend-contract/primitives').Capacity
    },
    overflowPolicy: OverflowPolicy
  ): DeterministicBoundedStream<Value> {
    return new DeterministicBoundedStream(delivery, overflowPolicy)
  }

  protected assertAggregateAdmission<Value>(stream: DeterministicBoundedStream<Value>): void {
    if (this.reservedStreamBytes() + stream.reservedBytes() > this.aggregateStreamByteQuota) {
      throw contractError('stream.quota', 'stream', 'stream.admission')
    }
  }

  protected pushWithinAggregateQuota<Value>(
    stream: DeterministicBoundedStream<Value>,
    value: Value,
    byteLength: number,
    key: string | null = null
  ): ReturnType<DeterministicBoundedStream<Value>['push']> {
    if (
      this.reservedStreamBytes() - stream.reservedBytes() + stream.projectedReservedBytes(byteLength, key) >
      this.aggregateStreamByteQuota
    ) {
      return stream.terminateForQuota(byteLength)
    }
    return stream.push(value, byteLength, key)
  }

  protected currentAdapterState(): AdapterStateSnapshot<string> {
    return { ...this.adapterState }
  }

  protected attachment(): AttachmentRecord<string> {
    const state = this.currentAdapterState()
    return {
      attachmentId: opaqueId(`attachment-${this.backendInstance}`, 'attachment', 'deterministic'),
      backendInstanceId: opaqueId(`backend-${this.backendInstance}`, 'backend-instance', 'deterministic'),
      backendGeneration: state.backendGeneration,
      adapter: {
        adapterId: this.adapterIdentifier,
        displayName: 'Deterministic virtual adapter',
        state,
        adapterGeneration: opaqueId(String(this.backendGeneration), 'adapter-generation', 'deterministic'),
        limitations: ['deterministic-only; no live-radio support claim']
      }
    }
  }

  idFactory(attachment: AttachmentRecord<string>) {
    const binding: AttachmentBinding<string> = {
      attachmentId: attachment.attachmentId,
      backendInstanceId: attachment.backendInstanceId,
      backendGeneration: attachment.backendGeneration,
      adapterId: attachment.adapter.adapterId,
      adapterGeneration: attachment.adapter.adapterGeneration
    }
    return createAttachmentBoundIdFactory(binding)
  }

  createBackendOperationDispatch<Operation extends string, Result>(
    operation: OperationOptions<string, Operation>,
    start: (operation: OperationOptions<string, Operation>) => Promise<Result>
  ): BackendOperationDispatch<string, Result> {
    return this.dispatch(operation, start)
  }

  protected dispatch<Operation extends string, Result>(
    operation: OperationOptions<string, Operation>,
    start: (operation: OperationOptions<string, Operation>) => Promise<Result>
  ): BackendOperationDispatch<string, Result> {
    const handle = this.idFactory(this.attachment()).backendOperationHandle(
      `backend-operation-${this.nextBackendOperation}`
    )
    this.nextBackendOperation += 1
    const settlement = createOperationSettlementCoordinator<string, Result>(handle)
    const controller = new AbortController()
    let terminal = false
    let cancellation: CancellationAcknowledgement<string> | null = null
    const abortFromCaller = () => {
      controller.abort()
    }
    if (operation.signal?.aborted === true) {
      controller.abort()
    } else if (operation.signal !== null) {
      operation.signal.addEventListener('abort', abortFromCaller, { once: true })
    }
    const dispatchedOperation: OperationOptions<string, Operation> = {
      correlation: operation.correlation,
      deadline: operation.deadline,
      signal: controller.signal
    }
    const completion = start(dispatchedOperation).then(
      result => {
        terminal = true
        if (operation.signal !== null) {
          operation.signal.removeEventListener('abort', abortFromCaller)
        }
        return settlement.complete(result)
      },
      error => {
        terminal = true
        if (operation.signal !== null) {
          operation.signal.removeEventListener('abort', abortFromCaller)
        }
        throw error
      }
    )
    return createBackendOperationDispatch(handle, completion, async () => {
      if (cancellation !== null) {
        return cancellation
      }
      if (terminal) {
        cancellation = settlement.acknowledgeCancellation('already-terminal')
        return cancellation
      }
      controller.abort()
      cancellation = settlement.acknowledgeCancellation('cancellation-requested')
      return cancellation
    })
  }

  protected assertUsable(operation: string): void {
    if (this.destroyed) {
      throw contractError('lifecycle.destroyed', 'core', operation)
    }
  }

  private assertMaximumWriteLength(maximumWriteLength: number): void {
    if (
      !Number.isSafeInteger(maximumWriteLength) ||
      maximumWriteLength < 1 ||
      maximumWriteLength > Number(this.maximumOperationBytes)
    ) {
      throw contractError('argument.invalid', 'gatt', 'deterministic.maximum-write-length')
    }
  }

  protected assertAdapterReady(operation: string): void {
    if (this.adapterState.availability !== 'available') {
      throw contractError('adapter.unavailable', 'adapter', operation)
    }
    if (this.adapterState.authorization === 'denied') {
      throw contractError('permission.denied', 'adapter', operation)
    }
    if (this.adapterState.authorization === 'restricted') {
      throw contractError('permission.restricted', 'adapter', operation)
    }
    if (this.adapterState.authorization !== 'granted') {
      throw contractError('permission.not-determined', 'adapter', operation)
    }
    if (this.adapterState.power !== 'on') {
      throw contractError(
        this.adapterState.power === 'resetting' ? 'adapter.resetting' : 'adapter.powered-off',
        'adapter',
        operation
      )
    }
  }

  protected observeCleanup(cleanup: Promise<CleanupRecord>, event: string): void {
    cleanup.then(
      () => undefined,
      error => {
        const cause = error instanceof BackendContractError ? error.normalized.code : 'platform.failure'
        this.recordTrace('resource', event, cause)
      }
    )
  }

  protected emitEvent(kind: BackendGenericEvent<string>['kind']): void {
    const attachment = this.attachment()
    this.broadcastEvent({
      attachment,
      attachmentId: attachment.attachmentId,
      kind,
      ingressOrdinal: this.ingressOrdinal
    })
    this.ingressOrdinal += 1
  }

  protected recordTrace(
    kind: DeterministicBackendTraceRecord['kind'],
    event: string,
    cause: BleErrorCode | null,
    correlation: string | null = null
  ): void {
    this.traceRecords.push({
      ordinal: this.ingressOrdinal,
      time: Number(this.clock.now()),
      kind,
      event,
      cause,
      correlation,
      redactedClient: true,
      redactedPeer: true,
      redactedPath: true,
      redactedPayload: true
    })
    this.ingressOrdinal += 1
    while (this.traceRecords.length > 256) {
      this.traceRecords.shift()
      this.traceTruncated = true
    }
  }

  protected abstract connect(
    peerId: PeerId<string>,
    clientId: ClientId<string, string>,
    optionsValue: PublicOperationOptions
  ): Promise<ConnectionLease<string, string, string>>
  protected abstract createScanConsumer(
    optionsValue: OwnerScanOptions<string, string>,
    stream: DeterministicBoundedStream<AdvertisementObservation<string>>
  ): { readonly consumer: ScanConsumer; readonly lease: ScanLease<string, string> }
  protected abstract reservedAdditionalStreamBytes(): number
  protected abstract handleAdapterUnavailable(): void
  protected abstract handleReset(): void

  private async stopScanConsumerInternal(consumer: ScanConsumer): Promise<CleanupRecord> {
    consumer.stream.closeWithReason('owner-released')
    this.deactivateScanConsumer(consumer)
    const group = this.scanGroup
    if (group === null) {
      return { state: 'released', failures: [] }
    }
    if (!group.consumers.has(consumer.id)) {
      return { state: 'released', failures: [] }
    }
    if (group.consumers.size > 1) {
      group.consumers.delete(consumer.id)
      return { state: 'released', failures: [] }
    }
    await this.operations.run(
      'scan-stop',
      noOperationOptions(),
      null,
      false,
      () => {
        if (this.scanGroup !== group || !group.consumers.has(consumer.id)) {
          throw contractError('operation.disconnected', 'scan', 'scan.stop')
        }
        this.scanGroup = null
        return undefined
      },
      null,
      null,
      null,
      true
    )
    return { state: 'released', failures: [] }
  }

  private reservedStreamBytes(): number {
    let retained = 0
    for (const stream of this.eventStreams) {
      retained += stream.reservedBytes()
    }
    const group = this.scanGroup
    if (group !== null) {
      for (const consumer of group.consumers.values()) {
        retained += consumer.stream.reservedBytes()
      }
    }
    return retained + this.reservedAdditionalStreamBytes()
  }

  private takePlan(stage: DeterministicCompletionStage): ProgrammableCompletion {
    const queue = this.plans.get(stage)
    const plan = queue?.shift()
    if (plan === undefined) {
      return defaultCompletion()
    }
    if (queue?.length === 0) {
      this.plans.delete(stage)
    }
    return plan
  }

  private matchesScan(
    optionsValue: OwnerScanOptions<string, string>,
    observation: AdvertisementObservation<string>
  ): boolean {
    return advertisementMatchesFilter(optionsValue.filter, observation)
  }

  private createStateWatch(): AdapterStateWatch<string> {
    const stream = new DeterministicBoundedStream<AdapterStateSnapshot<string>>(defaultStreamLimits, 'latest')
    this.stateWatchers.add(stream)
    return { initial: this.currentAdapterState(), transitions: stream }
  }

  private createAdapterState(
    availability: AdapterStateSnapshot<string>['availability'],
    authorization: AdapterStateSnapshot<string>['authorization'],
    power: AdapterStateSnapshot<string>['power'],
    safeReason: string | null
  ): AdapterStateSnapshot<string> {
    return {
      availability,
      authorization,
      power,
      backendGeneration: opaqueId(String(this.backendGeneration), 'backend-generation', 'deterministic'),
      updatedAt: this.clock.now(),
      safeReason
    }
  }

  private stopAllScans(event: string): void {
    const group = this.scanGroup
    if (group === null) {
      return
    }
    for (const consumer of [...group.consumers.values()]) {
      this.observeCleanup(this.stopScanConsumer(consumer), event)
    }
  }

  private recordOperationTrace(trace: DeterministicOperationTrace): void {
    this.recordTrace('operation', trace.event, trace.cause, trace.operationId)
  }

  protected broadcastEvent(event: BackendEvent<string>): void {
    for (const stream of [...this.eventStreams]) {
      if (stream.isClosed()) {
        this.eventStreams.delete(stream)
        continue
      }
      const outcome = stream.push(event, 1, event.kind)
      if (outcome.terminated) {
        this.recordTrace('stream', 'backend-event-overflow-terminal', 'stream.overflow')
      }
    }
  }

  protected activateScanConsumer(consumer: ScanConsumer): void {
    if (consumer.options.signal?.aborted === true) {
      this.observeCleanup(this.stopScanConsumer(consumer), 'scan-active-abort-stop-failed')
      return
    }
    if (consumer.options.signal !== null) {
      const onAbort = () => {
        this.observeCleanup(this.stopScanConsumer(consumer), 'scan-active-abort-stop-failed')
      }
      consumer.options.signal.addEventListener('abort', onAbort, { once: true })
      consumer.activeAbortListener = onAbort
    }
    if (consumer.options.deadline !== null) {
      const deadline = Number(consumer.options.deadline)
      if (deadline <= Number(this.clock.now())) {
        this.observeCleanup(this.stopScanConsumer(consumer), 'scan-active-deadline-stop-failed')
        return
      }
      consumer.activeDeadlineTask = this.clock.scheduleAfter(deadline - Number(this.clock.now()), () => {
        this.observeCleanup(this.stopScanConsumer(consumer), 'scan-active-deadline-stop-failed')
      })
    }
  }

  protected deactivateScanConsumer(consumer: ScanConsumer): void {
    if (consumer.activeAbortListener !== null && consumer.options.signal !== null) {
      consumer.options.signal.removeEventListener('abort', consumer.activeAbortListener)
      consumer.activeAbortListener = null
    }
    if (consumer.activeDeadlineTask !== null) {
      consumer.activeDeadlineTask.cancel()
      consumer.activeDeadlineTask = null
    }
  }
}

function noOperationOptions(): PublicOperationOptions {
  return { signal: null, deadline: null }
}

function scanSignature(optionsValue: OwnerScanOptions<string, string>): string {
  return JSON.stringify({
    serviceUuids: optionsValue.filter.serviceUuids.map(value => String(value)).sort(),
    manufacturerData: optionsValue.filter.manufacturerData.map(filter => ({
      companyIdentifier: filter.companyIdentifier,
      dataPrefix: filter.dataPrefix === null ? null : Array.from(filter.dataPrefix)
    })),
    localNamePrefix: optionsValue.filter.localNamePrefix,
    duplicatePolicy: optionsValue.duplicatePolicy,
    timestampPolicy: optionsValue.timestampPolicy,
    delivery: optionsValue.delivery,
    deadline: optionsValue.deadline === null ? null : Number(optionsValue.deadline)
  })
}

function advertisementByteLength(observation: AdvertisementObservation<string>): number {
  let length = 0
  if (observation.rawRecord.state === 'present') {
    length += observation.rawRecord.value.byteLength
  }
  if (observation.scanResponseRecord.state === 'present') {
    length += observation.scanResponseRecord.value.byteLength
  }
  if (observation.serviceData.state === 'present') {
    for (const entry of observation.serviceData.value) {
      length += entry.value.byteLength
    }
  }
  if (observation.manufacturerData.state === 'present') {
    for (const entry of observation.manufacturerData.value) {
      length += entry.value.byteLength
    }
  }
  return length
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false
  }
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) {
      return false
    }
  }
  return true
}
