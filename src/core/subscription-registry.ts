// src/core/subscription-registry.ts

// src/core/subscription-registry.ts

import { BackendContractError, contractError } from '../backend-contract/errors'
import { ownBytes } from '../backend-contract/primitives'
import type { BackendSubscription, BleCentralBackend } from '../backend-contract/backend'
import type { CleanupFailure, CleanupRecord, NormalizedBleError } from '../backend-contract/errors'
import type { CharacteristicPath, DatabasePath, NotificationValue } from '../backend-contract/gatt'
import type { BackendIdentity } from '../backend-contract/identity'
import type { PublicOperationOptions, SubscriptionOptions } from '../backend-contract/operations'
import type { AttachmentBoundIdFactory, AttachmentId, ByteLimit, SubscriptionId } from '../backend-contract/primitives'
import type { BoundedAsyncStream, StreamItem } from '../backend-contract/streams'
import { AggregateStreamQuota } from './aggregate-stream-quota'
import { CoreBoundedStream } from './bounded-stream'
import { assertSuccessfulOperationTerminal, awaitWithOperationAdmission } from './unified-ble-core-helpers'
import { CoreOperationCoordinator, type CoreOperationDispatch, type CoreOperationResult } from './operation-coordinator'
import { ResourceLedger } from './resource-ledger'
import { CoreTraceRecorder } from './trace-recorder'
import { characteristicPathKey, characteristicPathsEqual, databasePathsEqual } from './gatt-path-equality'

type CurrentCharacteristicPath<Attachment extends string> = CharacteristicPath<
  Attachment,
  string,
  string,
  string,
  string,
  'current'
>

interface PhysicalSubscription<Attachment extends string, Identity extends BackendIdentity<Attachment>> {
  readonly key: string
  readonly path: CurrentCharacteristicPath<Attachment>
  readonly queueKey: string
  readonly consumers: Set<CoreSubscription<Attachment, Identity>>
  backend: BackendSubscription<Attachment, string, string, string, string> | null
  ready: Promise<void> | null
  closed: boolean
  released: boolean
  releaseInFlight: Promise<CleanupRecord> | null
  releasedDuringEnable: boolean
  backendInvalidated: boolean
  lateSubscriptionPending: boolean
  pump: Promise<void> | null
}

export interface SubscriptionRegistryRuntime<Attachment extends string, Identity extends BackendIdentity<Attachment>> {
  readonly backend: BleCentralBackend<Attachment, Identity>
  readonly attachmentId: AttachmentId<Attachment>
  readonly idFactory: AttachmentBoundIdFactory<Attachment>
  readonly operationCoordinator: CoreOperationCoordinator<Attachment>
  readonly aggregateQuota: AggregateStreamQuota
  readonly resourceLedger: ResourceLedger
  readonly trace: CoreTraceRecorder
  readonly now: () => number
  readonly maximumValueBytes: ByteLimit
  isPathCurrent(path: CurrentCharacteristicPath<Attachment>): boolean
}

/** Public subscription handle with a consumer-owned bounded value stream. */
export class CoreSubscription<Attachment extends string, Identity extends BackendIdentity<Attachment>> {
  private removal: Promise<CleanupRecord> | null = null
  private state: 'enabling' | 'ready' | 'removed' | 'invalid' = 'enabling'

  constructor(
    readonly subscriptionId: SubscriptionId<Attachment, string, string, string, string, string>,
    readonly path: CurrentCharacteristicPath<Attachment>,
    readonly values: BoundedAsyncStream<NotificationValue>,
    private readonly removeSubscription: (
      subscription: CoreSubscription<Attachment, Identity>
    ) => Promise<CleanupRecord>
  ) {}

  isReady(): boolean {
    return this.state === 'ready'
  }

  isActive(): boolean {
    return this.state === 'enabling' || this.state === 'ready'
  }

  markReady(): void {
    if (this.state === 'enabling') {
      this.state = 'ready'
    }
  }

  invalidate(reason: 'connection-lost' | 'owner-released' | 'source-failed'): void {
    if (!this.isActive()) {
      return
    }
    this.state = 'invalid'
    if (this.values instanceof CoreBoundedStream) {
      this.values.closeWithReason(reason)
    }
  }

  remove(): Promise<CleanupRecord> {
    if (this.removal === null) {
      const removal = this.removeSubscription(this)
      this.removal = removal
      removal.then(
        result => {
          if (result.state === 'release-failed') {
            this.removal = null
          }
        },
        () => {
          this.removal = null
        }
      )
    }
    return this.removal
  }

  markRemoved(): void {
    this.state = 'removed'
  }
}

/**
 * Owns the one physical CCCD enablement for each exact current path. Each
 * consumer gets its own bounded stream; removing one never disables another.
 */
export class SubscriptionRegistry<Attachment extends string, Identity extends BackendIdentity<Attachment>> {
  private readonly physicalByPath = new Map<string, PhysicalSubscription<Attachment, Identity>>()
  private nextSubscription = 1
  private nextLateCompensation = 1

  constructor(private readonly runtime: SubscriptionRegistryRuntime<Attachment, Identity>) {}

  async subscribe(
    path: CurrentCharacteristicPath<Attachment>,
    options: SubscriptionOptions,
    queueKey: string
  ): Promise<CoreSubscription<Attachment, Identity>> {
    this.assertCurrent(path)
    this.assertAdmission(options)
    const stream = new CoreBoundedStream<NotificationValue>(options.delivery, options.delivery.overflowPolicy)
    this.runtime.aggregateQuota.register(stream)
    const subscription = new CoreSubscription(
      this.runtime.idFactory.subscriptionId(`subscription-${this.nextSubscription}`),
      path,
      stream,
      current => this.remove(current)
    )
    this.nextSubscription += 1
    this.runtime.resourceLedger.increment('subscriptionConsumers')
    const key = exactPathKey(path)
    const existing = this.physicalByPath.get(key)
    if (existing !== undefined) {
      if (existing.closed) {
        const cleanup = await this.disable(existing)
        if (cleanup.state === 'release-failed') {
          this.closeConsumer(subscription, 'owner-released')
          throw new BackendContractError(
            cleanup.failures[0]?.error ??
              contractError('platform.failure', 'gatt', 'subscription-registry.closed-physical').normalized
          )
        }
        this.closeConsumer(subscription, 'owner-released')
        return this.subscribe(path, options, queueKey)
      }
      existing.consumers.add(subscription)
      // Native CCCD enablement may yield a value before the shared enable promise settles.
      subscription.markReady()
      try {
        await this.waitForReady(existing, options)
        return subscription
      } catch (error) {
        const admissionError =
          error instanceof Error
            ? error
            : contractError('platform.failure', 'gatt', 'subscription-registry.shared-enable')
        if (this.isOwnAdmissionTerminal(admissionError, options)) {
          const cleanup = await this.remove(subscription)
          if (cleanup.state === 'release-failed') {
            throw new BackendContractError(
              cleanup.failures[0]?.error ??
                contractError('platform.failure', 'cleanup', 'subscription-registry.joiner-cleanup').normalized
            )
          }
          throw admissionError
        }
        this.failEnableConsumers(existing)
        throw this.normalizeEnableError(admissionError)
      }
    }
    const physical: PhysicalSubscription<Attachment, Identity> = {
      key,
      path,
      queueKey,
      consumers: new Set([subscription]),
      backend: null,
      ready: null,
      closed: false,
      released: false,
      releaseInFlight: null,
      releasedDuringEnable: false,
      backendInvalidated: false,
      lateSubscriptionPending: false,
      pump: null
    }
    this.physicalByPath.set(key, physical)
    // The consumer is not public until the await below resolves, so readiness here safely retains early native values.
    subscription.markReady()
    physical.ready = this.enable(physical, options)
    try {
      await physical.ready
      return subscription
    } catch (error) {
      this.failEnableConsumers(physical)
      throw this.normalizeEnableError(
        error instanceof Error ? error : contractError('platform.failure', 'gatt', 'subscription-registry.enable')
      )
    }
  }

  async remove(subscription: CoreSubscription<Attachment, Identity>): Promise<CleanupRecord> {
    const physical = this.physicalByPath.get(exactPathKey(subscription.path))
    this.closeConsumer(subscription, 'owner-released')
    if (physical === undefined) {
      return { state: 'released', failures: [] }
    }
    physical.consumers.delete(subscription)
    if (physical.consumers.size > 0) {
      return { state: 'released', failures: [] }
    }
    return this.disable(physical)
  }

  async invalidatePath(
    path: CurrentCharacteristicPath<Attachment>,
    reason: 'connection-lost' | 'owner-released' | 'source-failed'
  ): Promise<CleanupRecord> {
    const physical = this.physicalByPath.get(exactPathKey(path))
    if (physical === undefined) {
      return { state: 'released', failures: [] }
    }
    for (const subscription of [...physical.consumers]) {
      this.closeConsumer(subscription, reason)
      physical.consumers.delete(subscription)
    }
    return this.disable(physical, reason === 'connection-lost')
  }

  async invalidateDatabase(
    database: DatabasePath<Attachment, string, string>,
    reason: 'connection-lost' | 'owner-released' | 'source-failed'
  ): Promise<CleanupRecord> {
    const failures: CleanupFailure[] = []
    for (const physical of [...this.physicalByPath.values()]) {
      if (!matchesDatabasePath(physical.path, database)) {
        continue
      }
      for (const subscription of [...physical.consumers]) {
        this.closeConsumer(subscription, reason)
        physical.consumers.delete(subscription)
      }
      const result = await this.disable(physical, reason === 'connection-lost')
      failures.push(...result.failures)
    }
    return failures.length === 0 ? { state: 'released', failures: [] } : { state: 'release-failed', failures }
  }

  async destroy(): Promise<CleanupRecord> {
    const failures: CleanupFailure[] = []
    for (const physical of [...this.physicalByPath.values()]) {
      for (const subscription of [...physical.consumers]) {
        this.closeConsumer(subscription, 'owner-released')
        physical.consumers.delete(subscription)
      }
      const result = await this.disable(physical)
      failures.push(...result.failures)
    }
    return failures.length === 0 ? { state: 'released', failures: [] } : { state: 'release-failed', failures }
  }

  private async enable(
    physical: PhysicalSubscription<Attachment, Identity>,
    options: SubscriptionOptions
  ): Promise<void> {
    const result = await this.runtime.operationCoordinator.run({
      queueKey: physical.queueKey,
      options,
      mayCommit: false,
      dispatch: correlation => {
        this.assertCurrent(physical.path)
        return this.subscribeDispatch(physical, options, correlation)
      },
      onQuarantined: () => {
        physical.lateSubscriptionPending = true
      },
      onLateSuccess: backendSubscription => this.compensateLateSubscription(physical, backendSubscription),
      onLateFailure: () => {
        physical.lateSubscriptionPending = false
        this.finalizeUnusedPhysical(physical)
        return Promise.resolve()
      }
    })
    const backendSubscription = requireOperationValue(result, 'subscription-registry.enable')
    if (physical.closed || physical.consumers.size === 0 || !this.runtime.isPathCurrent(physical.path)) {
      physical.backend = backendSubscription
      this.runtime.resourceLedger.increment('physicalCccdEnablements')
      await this.unsubscribeBackend(physical, backendSubscription)
      this.runtime.resourceLedger.decrement('physicalCccdEnablements')
      physical.backend = null
      physical.releasedDuringEnable = true
      throw contractError('operation.disconnected', 'gatt', 'subscription-registry.enable-invalidated')
    }
    physical.lateSubscriptionPending = false
    physical.backend = backendSubscription
    this.runtime.resourceLedger.increment('physicalCccdEnablements')
    physical.pump = this.pumpNotifications(physical, backendSubscription.notifications)
    this.runtime.trace.record({
      timestamp: this.runtime.now(),
      resource: 'subscription',
      transition: 'ready',
      operation: null,
      cause: null,
      queuedOperations: 0,
      dispatchedOperations: 0,
      quarantinedOperations: 0
    })
  }

  private subscribeDispatch(
    physical: PhysicalSubscription<Attachment, Identity>,
    options: SubscriptionOptions,
    correlation: import('../backend-contract/primitives').OperationCorrelation<Attachment, string>
  ): CoreOperationDispatch<BackendSubscription<Attachment, string, string, string, string>> {
    const dispatch = this.runtime.backend.gatt.subscribe(physical.path, {
      operation: { ...options, correlation },
      options
    })
    return {
      completion: dispatch.completion.then(async subscription => {
        try {
          if (!characteristicPathsEqual(subscription.path, physical.path)) {
            throw contractError('protocol.violation', 'gatt', 'subscription-registry.subscribe-path')
          }
          assertSuccessfulOperationTerminal(
            subscription.terminal,
            correlation,
            'subscription-registry.subscribe-terminal'
          )
          return subscription
        } catch (error) {
          await this.compensateMalformedSubscription(physical, subscription)
          throw error
        }
      }),
      requestCancellation: () => dispatch.requestCancellation().then(() => undefined)
    }
  }

  private async compensateMalformedSubscription(
    physical: PhysicalSubscription<Attachment, Identity>,
    backendSubscription: BackendSubscription<Attachment, string, string, string, string>
  ): Promise<void> {
    physical.lateSubscriptionPending = false
    physical.backend = backendSubscription
    this.runtime.resourceLedger.increment('physicalCccdEnablements')
    const options: PublicOperationOptions = { signal: null, deadline: null }
    const correlation = this.runtime.idFactory.operationCorrelation(
      `malformed-subscription-compensation-${this.nextLateCompensation}`
    )
    this.nextLateCompensation += 1
    try {
      await this.unsubscribeDispatch(backendSubscription, options, correlation).completion
      this.runtime.resourceLedger.decrement('physicalCccdEnablements')
      physical.backend = null
      physical.releasedDuringEnable = true
      this.runtime.trace.record({
        timestamp: this.runtime.now(),
        resource: 'subscription',
        transition: 'malformed-subscription-compensated',
        operation: null,
        cause: null,
        queuedOperations: 0,
        dispatchedOperations: 0,
        quarantinedOperations: 0
      })
    } catch (error) {
      const normalized =
        error instanceof BackendContractError
          ? error.normalized
          : contractError('platform.failure', 'cleanup', 'subscription-registry.malformed-subscription').normalized
      this.runtime.trace.record({
        timestamp: this.runtime.now(),
        resource: 'subscription',
        transition: 'malformed-subscription-compensation-failed',
        operation: null,
        cause: normalized.code,
        queuedOperations: 0,
        dispatchedOperations: 0,
        quarantinedOperations: 0
      })
    }
  }

  private async disable(
    physical: PhysicalSubscription<Attachment, Identity>,
    backendInvalidated = false
  ): Promise<CleanupRecord> {
    if (backendInvalidated) {
      physical.backendInvalidated = true
    }
    if (physical.released) {
      return { state: 'released', failures: [] }
    }
    if (physical.releaseInFlight !== null) {
      return physical.releaseInFlight
    }
    physical.closed = true
    const release = this.disablePhysical(physical)
    physical.releaseInFlight = release
    release.then(
      result => {
        physical.releaseInFlight = null
        if (result.state === 'released') {
          physical.released = true
          this.physicalByPath.delete(physical.key)
        }
      },
      () => {
        physical.releaseInFlight = null
      }
    )
    return release
  }

  private async disablePhysical(physical: PhysicalSubscription<Attachment, Identity>): Promise<CleanupRecord> {
    if (physical.ready !== null) {
      try {
        await physical.ready
      } catch (error) {
        if (physical.releasedDuringEnable) {
          return { state: 'released', failures: [] }
        }
        if (physical.backendInvalidated) {
          return this.releaseInvalidatedBackend(physical)
        }
        if (physical.backend !== null) {
          return this.unsubscribePhysical(physical, physical.backend)
        }
        if (error instanceof BackendContractError) {
          return cleanupFailure('subscription', error.normalized)
        }
        return cleanupFailure(
          'subscription',
          contractError('platform.failure', 'cleanup', 'subscription-registry.ready').normalized
        )
      }
    }
    if (physical.backendInvalidated) {
      return this.releaseInvalidatedBackend(physical)
    }
    const backendSubscription = physical.backend
    if (backendSubscription === null) {
      return { state: 'released', failures: [] }
    }
    return this.unsubscribePhysical(physical, backendSubscription)
  }

  private releaseInvalidatedBackend(physical: PhysicalSubscription<Attachment, Identity>): CleanupRecord {
    if (physical.backend !== null) {
      this.runtime.resourceLedger.decrement('physicalCccdEnablements')
      physical.backend = null
    }
    return { state: 'released', failures: [] }
  }

  private async unsubscribePhysical(
    physical: PhysicalSubscription<Attachment, Identity>,
    backendSubscription: BackendSubscription<Attachment, string, string, string, string>
  ): Promise<CleanupRecord> {
    const options: PublicOperationOptions = { signal: null, deadline: null }
    const result = await this.runtime.operationCoordinator.runCleanup({
      queueKey: physical.queueKey,
      options,
      mayCommit: false,
      dispatch: correlation => this.unsubscribeDispatch(backendSubscription, options, correlation)
    })
    if (result.outcome !== 'succeeded') {
      if (
        physical.backendInvalidated ||
        result.error.code === 'gatt.stale-handle' ||
        result.error.code === 'operation.disconnected'
      ) {
        this.runtime.trace.record({
          timestamp: this.runtime.now(),
          resource: 'subscription',
          transition: 'backend-invalidated-during-disable',
          operation: null,
          cause: result.error.code,
          queuedOperations: 0,
          dispatchedOperations: 0,
          quarantinedOperations: 0
        })
        return this.releaseInvalidatedBackend(physical)
      }
      return cleanupFailure('subscription', result.error)
    }
    this.runtime.resourceLedger.decrement('physicalCccdEnablements')
    physical.backend = null
    return { state: 'released', failures: [] }
  }

  private unsubscribeDispatch(
    backendSubscription: BackendSubscription<Attachment, string, string, string, string>,
    options: PublicOperationOptions,
    correlation: import('../backend-contract/primitives').OperationCorrelation<Attachment, string>
  ): CoreOperationDispatch<import('../backend-contract/operations').OperationTerminalRecord<Attachment, string>> {
    const dispatch = this.runtime.backend.gatt.unsubscribe(backendSubscription, { ...options, correlation })
    return {
      completion: dispatch.completion.then(terminal => {
        assertSuccessfulOperationTerminal(terminal, correlation, 'subscription-registry.unsubscribe-terminal')
        return terminal
      }),
      requestCancellation: () => dispatch.requestCancellation().then(() => undefined)
    }
  }

  private async unsubscribeBackend(
    physical: PhysicalSubscription<Attachment, Identity>,
    backendSubscription: BackendSubscription<Attachment, string, string, string, string>
  ): Promise<void> {
    const options: PublicOperationOptions = { signal: null, deadline: null }
    const result = await this.runtime.operationCoordinator.runCleanup({
      queueKey: physical.queueKey,
      options,
      mayCommit: false,
      dispatch: correlation => this.unsubscribeDispatch(backendSubscription, options, correlation)
    })
    if (result.outcome !== 'succeeded') {
      throw new BackendContractError(result.error)
    }
  }

  private async compensateLateSubscription(
    physical: PhysicalSubscription<Attachment, Identity>,
    backendSubscription: BackendSubscription<Attachment, string, string, string, string>
  ): Promise<void> {
    physical.lateSubscriptionPending = false
    physical.backend = backendSubscription
    this.runtime.resourceLedger.increment('physicalCccdEnablements')
    const options: PublicOperationOptions = { signal: null, deadline: null }
    const correlation = this.runtime.idFactory.operationCorrelation(
      `late-subscription-compensation-${this.nextLateCompensation}`
    )
    this.nextLateCompensation += 1
    try {
      await this.unsubscribeDispatch(backendSubscription, options, correlation).completion
      this.runtime.resourceLedger.decrement('physicalCccdEnablements')
      physical.backend = null
      physical.releasedDuringEnable = true
      this.runtime.trace.record({
        timestamp: this.runtime.now(),
        resource: 'subscription',
        transition: 'late-subscription-compensated',
        operation: null,
        cause: null,
        queuedOperations: 0,
        dispatchedOperations: 0,
        quarantinedOperations: 0
      })
      this.finalizeUnusedPhysical(physical)
    } catch (error) {
      const normalized =
        error instanceof BackendContractError
          ? error.normalized
          : contractError('platform.failure', 'cleanup', 'subscription-registry.late-subscription').normalized
      this.runtime.trace.record({
        timestamp: this.runtime.now(),
        resource: 'subscription',
        transition: 'late-subscription-compensation-failed',
        operation: null,
        cause: normalized.code,
        queuedOperations: 0,
        dispatchedOperations: 0,
        quarantinedOperations: 0
      })
      throw new BackendContractError(normalized)
    }
  }

  private async pumpNotifications(
    physical: PhysicalSubscription<Attachment, Identity>,
    source: BoundedAsyncStream<NotificationValue>
  ): Promise<void> {
    try {
      for await (const item of source) {
        if (physical.closed) {
          return
        }
        if (await this.forwardNotificationItem(physical, item)) {
          return
        }
      }
      await this.invalidatePath(physical.path, 'source-failed')
    } catch (error) {
      const normalized =
        error instanceof BackendContractError
          ? error.normalized
          : contractError('platform.failure', 'gatt', 'subscription-registry.notification-pump').normalized
      this.runtime.trace.record({
        timestamp: this.runtime.now(),
        resource: 'subscription',
        transition: 'notification-source-failed',
        operation: null,
        cause: normalized.code,
        queuedOperations: 0,
        dispatchedOperations: 0,
        quarantinedOperations: 0
      })
      await this.invalidatePath(physical.path, 'source-failed')
    }
  }

  private async forwardNotificationItem(
    physical: PhysicalSubscription<Attachment, Identity>,
    item: StreamItem<NotificationValue>
  ): Promise<boolean> {
    if (item.kind === 'overflow') {
      for (const subscription of [...physical.consumers]) {
        if (!subscription.isReady()) {
          continue
        }
        const stream = subscription.values
        if (!(stream instanceof CoreBoundedStream)) {
          throw contractError('lifecycle.invariant-violation', 'gatt', 'subscription-registry.stream')
        }
        stream.observeSourceOverflow(item)
      }
      return false
    }
    if (item.kind !== 'value') {
      if (item.kind === 'terminal') {
        const reason =
          item.reason === 'connection-lost'
            ? 'connection-lost'
            : item.reason === 'owner-released'
              ? 'owner-released'
              : 'source-failed'
        await this.invalidatePath(physical.path, reason)
        return true
      }
      return false
    }
    const value = ownBytes(item.value.value, this.runtime.maximumValueBytes)
    for (const subscription of [...physical.consumers]) {
      if (!subscription.isReady()) {
        continue
      }
      const stream = subscription.values
      if (!(stream instanceof CoreBoundedStream)) {
        throw contractError('lifecycle.invariant-violation', 'gatt', 'subscription-registry.stream')
      }
      const outcome = this.runtime.aggregateQuota.emit(
        stream,
        { value: ownBytes(value, this.runtime.maximumValueBytes), indication: item.value.indication },
        value.byteLength
      )
      if (outcome.terminated) {
        await subscription.remove()
      }
    }
    return false
  }

  private async waitForReady(
    physical: PhysicalSubscription<Attachment, Identity>,
    options: SubscriptionOptions
  ): Promise<void> {
    if (physical.ready === null) {
      throw contractError('lifecycle.invariant-violation', 'gatt', 'subscription-registry.missing-ready')
    }
    await awaitWithOperationAdmission(physical.ready, options, this.runtime.now, 'subscription-registry.join')
  }

  private closeConsumer(
    subscription: CoreSubscription<Attachment, Identity>,
    reason: 'connection-lost' | 'owner-released' | 'source-failed'
  ): void {
    if (!subscription.isActive()) {
      return
    }
    subscription.invalidate(reason)
    subscription.markRemoved()
    this.runtime.resourceLedger.decrement('subscriptionConsumers')
    if (subscription.values instanceof CoreBoundedStream) {
      this.runtime.aggregateQuota.unregister(subscription.values)
    }
  }

  private failEnableConsumers(physical: PhysicalSubscription<Attachment, Identity>): void {
    physical.closed = true
    for (const consumer of [...physical.consumers]) {
      this.closeConsumer(consumer, 'owner-released')
      physical.consumers.delete(consumer)
    }
    this.finalizeUnusedPhysical(physical)
  }

  private finalizeUnusedPhysical(physical: PhysicalSubscription<Attachment, Identity>): void {
    if (physical.consumers.size > 0 || physical.backend !== null || physical.lateSubscriptionPending) {
      return
    }
    physical.released = true
    this.physicalByPath.delete(physical.key)
  }

  private normalizeEnableError(error: Error): BackendContractError {
    if (error instanceof BackendContractError) {
      return error
    }
    return contractError('gatt.subscribe-failed', 'gatt', 'subscription-registry.enable')
  }

  private assertCurrent(path: CurrentCharacteristicPath<Attachment>): void {
    if (!this.runtime.isPathCurrent(path)) {
      throw contractError('gatt.stale-handle', 'gatt', 'subscription-registry.path')
    }
  }

  private assertAdmission(options: SubscriptionOptions): void {
    if (options.signal?.aborted === true) {
      throw contractError('operation.aborted', 'gatt', 'subscription-registry.subscribe')
    }
    if (options.deadline !== null && options.deadline <= this.runtime.now()) {
      throw contractError('operation.timed-out', 'gatt', 'subscription-registry.subscribe')
    }
  }

  private isOwnAdmissionTerminal(error: Error, options: SubscriptionOptions): boolean {
    if (!(error instanceof BackendContractError)) {
      return false
    }
    return (
      (error.normalized.code === 'operation.aborted' && options.signal?.aborted === true) ||
      (error.normalized.code === 'operation.timed-out' &&
        options.deadline !== null &&
        options.deadline <= this.runtime.now())
    )
  }
}

function exactPathKey<Attachment extends string>(path: CurrentCharacteristicPath<Attachment>): string {
  return characteristicPathKey(path)
}

function matchesDatabasePath<Attachment extends string>(
  characteristic: CurrentCharacteristicPath<Attachment>,
  database: DatabasePath<Attachment, string, string>
): boolean {
  return databasePathsEqual(characteristic, database)
}

function requireOperationValue<Attachment extends string, Value>(
  result: CoreOperationResult<Attachment, Value>,
  operation: string
): Value {
  if (result.outcome === 'succeeded') {
    return result.value
  }
  throw new BackendContractError(result.error ?? contractError('platform.failure', 'core', operation).normalized)
}

function cleanupFailure(resourceKind: string, error: NormalizedBleError): CleanupRecord {
  return { state: 'release-failed', failures: [{ resourceKind, error }] }
}
