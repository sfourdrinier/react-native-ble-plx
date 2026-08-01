// src/backends/winrt/winrt-gatt-operations.ts

import type { BackendConnection, BackendSubscription } from '../../backend-contract/backend'
import { contractError, type CleanupRecord } from '../../backend-contract/errors'
import type { CharacteristicPath, DatabasePath, DescriptorPath, GattDatabase } from '../../backend-contract/gatt'
import type {
  OperationOptions,
  PublicOperationOptions,
  ReadRequest,
  ReadResult,
  SubscribeRequest,
  WriteReceipt,
  WriteRequest,
  WriteResult
} from '../../backend-contract/operations'
import { byteLimit, opaqueId, ownBytes, type OwnedBytes } from '../../backend-contract/primitives'
import {
  WinRtBackendSubscription,
  WinRtGattDatabase,
  WinRtSubscriptionStream,
  characteristicAddressKey,
  successfulTerminal
} from './winrt-handles'
import type {
  WinRtBackend,
  WinRtConnectionRecord,
  WinRtPendingSubscription,
  WinRtPhysicalSubscription
} from './winrt-backend'
import type {
  WinRtAsyncOperation,
  WinRtCancellationState,
  WinRtCharacteristicAddress,
  WinRtDescriptorAddress,
  WinRtGattSnapshot
} from './winrt-boundary'
import {
  createWinRtPhysicalSubscription,
  createWinRtSubscription,
  emitWinRtNotification,
  removeWinRtSubscription,
  requestWinRtPhysicalEnableCancellation,
  stopWinRtPhysicalSubscriptionAfterEnable,
  stopWinRtPhysicalSubscription
} from './winrt-subscription-runtime'
import { winRtPlatformError } from './winrt-backend-helpers'
import type { WinRtTrackedAsyncOperation } from './winrt-operation-dispatcher'

const maximumValueBytes = byteLimit(512 * 1024)

interface WinRtSubscribedResult {
  readonly outcome: 'subscribed'
  readonly subscription: WinRtBackendSubscription
}

interface WinRtCancelledSubscriptionResult {
  readonly outcome: 'cancelled'
}

type WinRtSubscriptionEnableResult = WinRtSubscribedResult | WinRtCancelledSubscriptionResult

const cancelledSubscriptionResult: WinRtCancelledSubscriptionResult = Object.freeze({ outcome: 'cancelled' })

/** Implements every complete GATT path against the strict WinRT boundary. */
export class WinRtGattOperations {
  constructor(private readonly backend: WinRtBackend) {}

  async discover(
    connection: BackendConnection<string, string>,
    options: PublicOperationOptions
  ): Promise<GattDatabase<string, string, string>> {
    this.backend.assertGattUsable('winrt.gatt.discover')
    const record = this.backend.requireConnection(connection, 'winrt.gatt.discover')
    const discoveryRevision = record.gattRevision
    const adapterResetEpoch = this.backend.captureAdapterResetEpoch()
    const dispatch = this.backend.trackConnectionOperation(
      record,
      discoveryRevision,
      this.backend.dispatcher.dispatch(options, 'winrt.gatt.discover', () =>
        this.backend.boundary.discover(record.nativePeerId)
      ),
      'winrt.gatt.discover',
      adapterResetEpoch
    )
    try {
      return this.createDatabase(record, await dispatch.completion, discoveryRevision)
    } catch (error) {
      throw winRtPlatformError('gatt.read-failed', 'gatt', 'winrt.gatt.discover', error)
    }
  }

  read(
    path: CharacteristicPath<string, string, string, string, string, 'current'>,
    request: ReadRequest<string, string>
  ) {
    this.backend.assertGattUsable('winrt.gatt.read')
    const database = this.backend.databaseForPath(path, 'winrt.gatt.read')
    const address = database.addressFor(path, 'winrt.gatt.read')
    const adapterResetEpoch = this.backend.captureAdapterResetEpoch()
    return this.backend.trackConnectionOperation(
      database.connectionRecord,
      database.connectionRecord.gattRevision,
      this.backend.dispatcher.dispatch(request.operation, 'winrt.gatt.read', () => {
        const native = this.backend.boundary.read(address)
        return {
          completion: native.completion.then(
            value =>
              Object.freeze({
                value: ownBytes(value, maximumValueBytes),
                terminal: successfulTerminal(request.operation)
              }),
            error => {
              throw winRtPlatformError('gatt.read-failed', 'gatt', 'winrt.gatt.read', error)
            }
          ),
          cancel: () => native.cancel()
        }
      }),
      'winrt.gatt.read',
      adapterResetEpoch
    )
  }

  write(
    path: CharacteristicPath<string, string, string, string, string, 'current'>,
    request: WriteRequest<string, string>
  ) {
    this.backend.assertGattUsable('winrt.gatt.write')
    const database = this.backend.databaseForPath(path, 'winrt.gatt.write')
    const address = database.addressFor(path, 'winrt.gatt.write')
    const copied = ownBytes(request.bytes, maximumValueBytes)
    const adapterResetEpoch = this.backend.captureAdapterResetEpoch()
    const result: WriteResult<string, string> = Object.freeze({
      terminal: successfulTerminal(request.operation),
      commitState: 'confirmed'
    })
    return this.backend.trackConnectionOperation(
      database.connectionRecord,
      database.connectionRecord.gattRevision,
      this.backend.dispatcher.dispatch(request.operation, 'winrt.gatt.write', () => {
        const native = this.backend.boundary.write(address, new Uint8Array(copied), request.mode)
        return {
          completion: native.completion.then(
            () => result,
            error => {
              throw winRtPlatformError('gatt.write-failed', 'gatt', 'winrt.gatt.write', error)
            }
          ),
          cancel: () => native.cancel()
        }
      }),
      'winrt.gatt.write',
      adapterResetEpoch
    )
  }

  readDescriptor(
    path: DescriptorPath<string, string, string, string, string, string, 'current'>,
    request: ReadRequest<string, string>
  ) {
    this.backend.assertGattUsable('winrt.gatt.read-descriptor')
    const database = this.backend.descriptorDatabaseForPath(path, 'winrt.gatt.read-descriptor')
    const address = database.descriptorAddressFor(path, 'winrt.gatt.read-descriptor')
    const adapterResetEpoch = this.backend.captureAdapterResetEpoch()
    return this.backend.trackConnectionOperation(
      database.connectionRecord,
      database.connectionRecord.gattRevision,
      this.backend.dispatcher.dispatch(request.operation, 'winrt.gatt.read-descriptor', () => {
        const native = this.backend.boundary.readDescriptor(address)
        const result: ReadResult<string, string> = Object.freeze({
          value: ownBytes(new Uint8Array(), maximumValueBytes),
          terminal: successfulTerminal(request.operation)
        })
        return {
          completion: native.completion.then(
            value => Object.freeze({ ...result, value: ownBytes(value, maximumValueBytes) }),
            error => {
              throw winRtPlatformError('gatt.read-failed', 'gatt', 'winrt.gatt.read-descriptor', error)
            }
          ),
          cancel: () => native.cancel()
        }
      }),
      'winrt.gatt.read-descriptor',
      adapterResetEpoch
    )
  }

  writeDescriptor(
    path: DescriptorPath<string, string, string, string, string, string, 'current'>,
    request: WriteRequest<string, string>
  ) {
    this.backend.assertGattUsable('winrt.gatt.write-descriptor')
    const database = this.backend.descriptorDatabaseForPath(path, 'winrt.gatt.write-descriptor')
    const address = database.descriptorAddressFor(path, 'winrt.gatt.write-descriptor')
    const copied = ownBytes(request.bytes, maximumValueBytes)
    const adapterResetEpoch = this.backend.captureAdapterResetEpoch()
    const result: WriteResult<string, string> = Object.freeze({
      terminal: successfulTerminal(request.operation),
      commitState: 'confirmed'
    })
    return this.backend.trackConnectionOperation(
      database.connectionRecord,
      database.connectionRecord.gattRevision,
      this.backend.dispatcher.dispatch(request.operation, 'winrt.gatt.write-descriptor', () => {
        const native = this.backend.boundary.writeDescriptor(address, new Uint8Array(copied), request.mode)
        return {
          completion: native.completion.then(
            () => result,
            error => {
              throw winRtPlatformError('gatt.write-failed', 'gatt', 'winrt.gatt.write-descriptor', error)
            }
          ),
          cancel: () => native.cancel()
        }
      }),
      'winrt.gatt.write-descriptor',
      adapterResetEpoch
    )
  }

  subscribe(
    path: CharacteristicPath<string, string, string, string, string, 'current'>,
    request: SubscribeRequest<string, string>
  ) {
    this.backend.assertGattUsable('winrt.gatt.subscribe')
    const database = this.backend.databaseForPath(path, 'winrt.gatt.subscribe')
    const address = database.addressFor(path, 'winrt.gatt.subscribe')
    const connectionRecord = database.connectionRecord
    const adapterResetEpoch = this.backend.captureAdapterResetEpoch()
    const dispatch = this.backend.trackConnectionOperation(
      connectionRecord,
      connectionRecord.gattRevision,
      this.backend.dispatcher.dispatch(
        request.operation,
        'winrt.gatt.subscribe',
        () => this.enableSubscription(address, path, request, connectionRecord),
        result => {
          if (result.outcome === 'cancelled') {
            return Promise.resolve()
          }
          return result.subscription.remove().then(cleanup => {
            if (cleanup.state === 'release-failed') {
              throw contractError('platform.failure', 'cleanup', 'winrt.gatt.subscribe.late-cleanup')
            }
          })
        }
      ),
      'winrt.gatt.subscribe',
      adapterResetEpoch
    )
    return {
      handle: dispatch.handle,
      completion: dispatch.completion.then(result => {
        if (result.outcome === 'cancelled') {
          throw contractError('operation.aborted', 'core', 'winrt.gatt.subscribe.cancelled')
        }
        return result.subscription
      }),
      requestCancellation: () => dispatch.requestCancellation()
    }
  }

  unsubscribe(
    subscription: BackendSubscription<string, string, string, string, string>,
    operation: OperationOptions<string, string>
  ) {
    this.backend.assertGattUsable('winrt.gatt.unsubscribe')
    if (!(subscription instanceof WinRtBackendSubscription) || !subscription.isOwnedBy(this.backend)) {
      throw contractError('ownership.denied', 'gatt', 'winrt.gatt.unsubscribe.subscription')
    }
    const adapterResetEpoch = this.backend.captureAdapterResetEpoch()
    return this.backend.trackConnectionOperation(
      subscription.connectionRecord,
      subscription.connectionRecord.gattRevision,
      this.backend.dispatcher.dispatch(operation, 'winrt.gatt.unsubscribe', () => ({
        completion: this.removeSubscription(subscription).then(cleanup => {
          if (cleanup.state === 'release-failed') {
            throw contractError('platform.failure', 'cleanup', 'winrt.gatt.unsubscribe.cleanup')
          }
          return successfulTerminal(operation)
        }),
        cancel: async () => 'not-cancellable'
      })),
      'winrt.gatt.unsubscribe',
      adapterResetEpoch
    )
  }

  removeSubscription(subscription: WinRtBackendSubscription): Promise<CleanupRecord> {
    return removeWinRtSubscription(this.backend, subscription)
  }

  async readFromDatabase(
    record: WinRtConnectionRecord,
    address: WinRtCharacteristicAddress,
    options: PublicOperationOptions
  ): Promise<OwnedBytes> {
    this.backend.assertGattUsable('winrt.gatt.database-read')
    const adapterResetEpoch = this.backend.captureAdapterResetEpoch()
    const dispatch = this.backend.trackConnectionOperation(
      record,
      record.gattRevision,
      this.backend.dispatcher.dispatch(options, 'winrt.gatt.database-read', () => this.backend.boundary.read(address)),
      'winrt.gatt.database-read',
      adapterResetEpoch
    )
    try {
      return ownBytes(await dispatch.completion, maximumValueBytes)
    } catch (error) {
      throw winRtPlatformError('gatt.read-failed', 'gatt', 'winrt.gatt.database-read', error)
    }
  }

  async writeFromDatabase(
    record: WinRtConnectionRecord,
    address: WinRtCharacteristicAddress,
    value: Uint8Array,
    options: import('../../backend-contract/operations').WritePolicy
  ): Promise<WriteReceipt<string, string>> {
    this.backend.assertGattUsable('winrt.gatt.database-write')
    const copied = ownBytes(value, maximumValueBytes)
    const adapterResetEpoch = this.backend.captureAdapterResetEpoch()
    const dispatch = this.backend.trackConnectionOperation(
      record,
      record.gattRevision,
      this.backend.dispatcher.dispatch(options, 'winrt.gatt.database-write', () =>
        this.backend.boundary.write(address, new Uint8Array(copied), options.mode)
      ),
      'winrt.gatt.database-write',
      adapterResetEpoch
    )
    try {
      await dispatch.completion
    } catch (error) {
      throw winRtPlatformError('gatt.write-failed', 'gatt', 'winrt.gatt.database-write', error)
    }
    return this.databaseWriteReceipt('winrt-database-write')
  }

  async readDescriptorFromDatabase(
    record: WinRtConnectionRecord,
    address: WinRtDescriptorAddress,
    options: PublicOperationOptions
  ): Promise<OwnedBytes> {
    this.backend.assertGattUsable('winrt.gatt.database-read-descriptor')
    const adapterResetEpoch = this.backend.captureAdapterResetEpoch()
    const dispatch = this.backend.trackConnectionOperation(
      record,
      record.gattRevision,
      this.backend.dispatcher.dispatch(options, 'winrt.gatt.database-read-descriptor', () =>
        this.backend.boundary.readDescriptor(address)
      ),
      'winrt.gatt.database-read-descriptor',
      adapterResetEpoch
    )
    try {
      return ownBytes(await dispatch.completion, maximumValueBytes)
    } catch (error) {
      throw winRtPlatformError('gatt.read-failed', 'gatt', 'winrt.gatt.database-read-descriptor', error)
    }
  }

  async writeDescriptorFromDatabase(
    record: WinRtConnectionRecord,
    address: WinRtDescriptorAddress,
    value: Uint8Array,
    options: import('../../backend-contract/operations').WritePolicy
  ): Promise<WriteReceipt<string, string>> {
    this.backend.assertGattUsable('winrt.gatt.database-write-descriptor')
    const copied = ownBytes(value, maximumValueBytes)
    const adapterResetEpoch = this.backend.captureAdapterResetEpoch()
    const dispatch = this.backend.trackConnectionOperation(
      record,
      record.gattRevision,
      this.backend.dispatcher.dispatch(options, 'winrt.gatt.database-write-descriptor', () =>
        this.backend.boundary.writeDescriptor(address, new Uint8Array(copied), options.mode)
      ),
      'winrt.gatt.database-write-descriptor',
      adapterResetEpoch
    )
    try {
      await dispatch.completion
    } catch (error) {
      throw winRtPlatformError('gatt.write-failed', 'gatt', 'winrt.gatt.database-write-descriptor', error)
    }
    return this.databaseWriteReceipt('winrt-database-write-descriptor')
  }

  async subscribeFromDatabase(
    path: CharacteristicPath<string, string, string, string, string, 'current'>,
    options: import('../../backend-contract/operations').SubscriptionOptions
  ): Promise<WinRtBackendSubscription> {
    this.backend.assertGattUsable('winrt.gatt.database-subscribe')
    const correlation = this.backend.identifiers().operationCorrelation('winrt-database-subscribe')
    return this.subscribe(path, { operation: { ...options, correlation }, options }).completion
  }

  private enableSubscription(
    address: WinRtCharacteristicAddress,
    path: CharacteristicPath<string, string, string, string, string, 'current'>,
    request: SubscribeRequest<string, string>,
    connectionRecord: WinRtConnectionRecord
  ): WinRtTrackedAsyncOperation<WinRtSubscriptionEnableResult> {
    let invalidateWaiter: (error: Error) => void = () => undefined
    const invalidation = new Promise<void>(resolve => {
      invalidateWaiter = () => resolve()
    })
    let resolvePhysicalCompletion: () => void = () => undefined
    const physicalCompletion = new Promise<void>(resolve => {
      resolvePhysicalCompletion = resolve
    })
    const waiter: WinRtPendingSubscription = {
      state: 'pending',
      physical: null,
      invalidation,
      invalidationError: null,
      invalidate: error => invalidateWaiter(error)
    }
    return {
      completion: this.enableSubscriptionCompletion(
        address,
        path,
        request,
        connectionRecord,
        waiter,
        resolvePhysicalCompletion
      ),
      physicalCompletion,
      cancel: () => this.cancelSubscriptionWaiter(waiter)
    }
  }

  private async enableSubscriptionCompletion(
    address: WinRtCharacteristicAddress,
    path: CharacteristicPath<string, string, string, string, string, 'current'>,
    request: SubscribeRequest<string, string>,
    connectionRecord: WinRtConnectionRecord,
    waiter: WinRtPendingSubscription,
    resolvePhysicalCompletion: () => void
  ): Promise<WinRtSubscriptionEnableResult> {
    let physicalCompletionTracked = false
    const trackPhysicalCompletion = (enablement: Promise<void>): void => {
      physicalCompletionTracked = true
      enablement.then(resolvePhysicalCompletion, resolvePhysicalCompletion)
    }
    try {
      const key = characteristicAddressKey(address)
      let physical = this.backend.subscriptions.get(key)
      if (physical?.state === 'removing') {
        if (physical.removal === null) {
          throw contractError('lifecycle.invariant-violation', 'cleanup', 'winrt.gatt.subscribe.removal-transition')
        }
        const cleanup = await physical.removal
        if (cleanup.state === 'release-failed') {
          throw contractError('platform.failure', 'cleanup', 'winrt.gatt.subscribe.cleanup-pending')
        }
        physical = this.backend.subscriptions.get(key)
      }
      if (
        physical !== undefined &&
        (physical.state === 'cleanup-pending' ||
          (physical.state === 'ready' && physical.consumers.size === 0 && physical.pendingConsumers.size === 0))
      ) {
        const cleanup = await stopWinRtPhysicalSubscription(this.backend, physical)
        if (cleanup.state === 'release-failed') {
          throw contractError('platform.failure', 'cleanup', 'winrt.gatt.subscribe.cleanup-retry')
        }
        physical = this.backend.subscriptions.get(key)
      }
      if (this.subscriptionWaiterIsCancelled(waiter)) {
        resolvePhysicalCompletion()
        return cancelledSubscriptionResult
      }
      if (physical === undefined) {
        const mode = this.backend.databaseForPath(path, 'winrt.gatt.subscribe.mode').notificationModeForPath(path)
        physical = createWinRtPhysicalSubscription(this.backend, address, mode)
        this.registerSubscriptionWaiter(waiter, physical)
        this.beginPhysicalSubscriptionEnablement(physical)
      } else {
        this.registerSubscriptionWaiter(waiter, physical)
      }
      const enablement = physical.enablement
      if (enablement === null) {
        this.completeSubscriptionWaiter(waiter)
        throw contractError('lifecycle.invariant-violation', 'gatt', 'winrt.gatt.subscribe.enablement-transition')
      }
      trackPhysicalCompletion(enablement)
      await Promise.race([enablement, waiter.invalidation])
      if (this.subscriptionWaiterIsInvalidated(waiter)) {
        if (waiter.invalidationError === null) {
          throw contractError('lifecycle.invariant-violation', 'gatt', 'winrt.gatt.subscribe.invalidation-terminal')
        }
        throw waiter.invalidationError
      }
      if (this.subscriptionWaiterIsCancelled(waiter)) {
        return cancelledSubscriptionResult
      }
      this.completeSubscriptionWaiter(waiter)
      if (this.backend.subscriptions.get(key) !== physical || physical.state !== 'ready') {
        throw contractError('operation.cancelled-by-destroy', 'gatt', 'winrt.gatt.subscribe.destroyed')
      }
      const subscription = createWinRtSubscription(
        this.backend,
        connectionRecord,
        physical,
        path,
        successfulTerminal(request.operation),
        new WinRtSubscriptionStream(request.options.delivery, request.options.delivery.overflowPolicy)
      )
      return Object.freeze({ outcome: 'subscribed', subscription })
    } catch (error) {
      this.completeSubscriptionWaiter(waiter)
      if (!physicalCompletionTracked) {
        resolvePhysicalCompletion()
      }
      throw error
    }
  }

  private beginPhysicalSubscriptionEnablement(physical: WinRtPhysicalSubscription): void {
    let resolveEnablement: () => void = () => undefined
    let rejectEnablement: (error: unknown) => void = () => undefined
    const enablement = new Promise<void>((resolve, reject) => {
      resolveEnablement = resolve
      rejectEnablement = reject
    })
    physical.enablement = enablement
    let native: WinRtAsyncOperation<void>
    try {
      native = this.backend.boundary.startNotify(physical.address, physical.mode, value =>
        emitWinRtNotification(this.backend, physical, value)
      )
    } catch (error) {
      physical.enableOutcome = 'failed'
      if (this.backend.subscriptions.get(physical.key) === physical) {
        this.backend.subscriptions.delete(physical.key)
      }
      console.error('[WinRtGattOperations.enableSubscription] WinRT CCCD enable failed:', error)
      rejectEnablement(winRtPlatformError('gatt.subscribe-failed', 'gatt', 'winrt.gatt.subscribe', error))
      return
    }
    physical.nativeEnable = native
    if (physical.enableCancellationRequested) {
      requestWinRtPhysicalEnableCancellation(physical).catch(error => {
        try {
          console.error('[WinRtGattOperations.enableSubscription] WinRT CCCD enable cancellation failed:', error)
        } catch {
          // Native enablement has already been invalidated; diagnostics cannot be allowed to re-enter the boundary.
        }
      })
    }
    native.completion
      .then(
        async () => {
          physical.nativeEnable = null
          physical.enableCancellation = null
          physical.enableOutcome = 'enabled'
          if (
            physical.invalidated ||
            this.backend.subscriptions.get(physical.key) !== physical ||
            physical.state !== 'enabling'
          ) {
            // The invalidating owner awaits and reports this exact cleanup receipt. Resolving the
            // enablement here lets every waiter publish its already-recorded lifecycle terminal
            // without misclassifying expected invalidation as an unhandled late native failure.
            await stopWinRtPhysicalSubscriptionAfterEnable(this.backend, physical)
            return
          }
          physical.enableConfirmed = true
          physical.state = 'ready'
          if (physical.pendingConsumers.size === 0 && physical.consumers.size === 0) {
            const cleanup = await stopWinRtPhysicalSubscription(this.backend, physical)
            if (cleanup.state === 'release-failed') {
              throw contractError('platform.failure', 'cleanup', 'winrt.gatt.subscribe.orphan-cleanup')
            }
          }
        },
        error => this.handlePhysicalSubscriptionEnableFailure(physical, error)
      )
      .then(resolveEnablement, rejectEnablement)
  }

  private async handlePhysicalSubscriptionEnableFailure(
    physical: WinRtPhysicalSubscription,
    error: unknown
  ): Promise<void> {
    physical.nativeEnable = null
    physical.enableCancellation = null
    physical.enableOutcome = 'failed'
    const preEnableRemoval = physical.removalPhase === 'pre-enable' ? physical.removal : null
    if (preEnableRemoval !== null) {
      const cleanup = await preEnableRemoval
      if (cleanup.state === 'released' && this.backend.subscriptions.get(physical.key) === physical) {
        this.backend.subscriptions.delete(physical.key)
      }
    } else if (this.backend.subscriptions.get(physical.key) === physical && physical.state === 'enabling') {
      this.backend.subscriptions.delete(physical.key)
    }
    console.error('[WinRtGattOperations.enableSubscription] WinRT CCCD enable failed:', error)
    throw winRtPlatformError('gatt.subscribe-failed', 'gatt', 'winrt.gatt.subscribe', error)
  }

  private registerSubscriptionWaiter(waiter: WinRtPendingSubscription, physical: WinRtPhysicalSubscription): void {
    waiter.physical = physical
    physical.pendingConsumers.add(waiter)
  }

  private completeSubscriptionWaiter(waiter: WinRtPendingSubscription): void {
    if (waiter.state !== 'pending') {
      return
    }
    waiter.physical?.pendingConsumers.delete(waiter)
    waiter.physical = null
    waiter.state = 'completed'
  }

  private subscriptionWaiterIsCancelled(waiter: WinRtPendingSubscription): boolean {
    return waiter.state === 'cancelled'
  }

  private subscriptionWaiterIsInvalidated(waiter: WinRtPendingSubscription): boolean {
    return waiter.state === 'invalidated'
  }

  private cancelSubscriptionWaiter(waiter: WinRtPendingSubscription): Promise<WinRtCancellationState> {
    if (waiter.state !== 'pending') {
      return Promise.resolve('already-terminal')
    }
    waiter.state = 'cancelled'
    const physical = waiter.physical
    if (physical === null) {
      return Promise.resolve('cancellation-requested')
    }
    physical.pendingConsumers.delete(waiter)
    if (
      this.backend.subscriptions.get(physical.key) !== physical ||
      physical.pendingConsumers.size > 0 ||
      physical.consumers.size > 0
    ) {
      return Promise.resolve('cancellation-requested')
    }
    if (physical.state === 'enabling' && physical.nativeEnable !== null) {
      return requestWinRtPhysicalEnableCancellation(physical)
    }
    if (physical.state === 'ready') {
      stopWinRtPhysicalSubscription(this.backend, physical).then(cleanup => {
        if (cleanup.state === 'release-failed') {
          console.error('[WinRtGattOperations.cancelSubscriptionWaiter] CCCD cleanup requires retry:', cleanup.failures)
        }
      })
    }
    return Promise.resolve('cancellation-requested')
  }

  private createDatabase(
    record: WinRtConnectionRecord,
    snapshot: unknown,
    discoveryRevision: number
  ): WinRtGattDatabase {
    const normalizedSnapshot = normalizeWinRtGattSnapshot(snapshot)
    if (record.state !== 'connected') {
      throw contractError('operation.disconnected', 'connection', 'winrt.gatt.discover.connection')
    }
    if (record.gattRevision !== discoveryRevision) {
      throw contractError('gatt.stale-handle', 'gatt', 'winrt.gatt.discover.services-changed')
    }
    record.database?.invalidate()
    const identifiers = this.backend.identifiers()
    const attachment = this.backend.attachment()
    const ordinal = this.backend.nextDatabase
    this.backend.nextDatabase += 1
    const path: DatabasePath<string, string, string> = Object.freeze({
      attachment,
      attachmentId: attachment.attachmentId,
      peerId: record.peerId,
      connectionId: record.connectionId,
      ownerLeaseId: record.ownerLeaseId,
      connectionGeneration: record.connectionGeneration,
      databaseId: identifiers.databaseId(`winrt-database-${ordinal}`),
      databaseGeneration: opaqueId(`winrt-database-generation-${ordinal}`, 'database-generation', 'winrt')
    })
    const database = new WinRtGattDatabase(this.backend, record, path, normalizedSnapshot)
    record.database = database
    return database
  }

  private databaseWriteReceipt(label: string): WriteReceipt<string, string> {
    return Object.freeze({
      terminal: Object.freeze({
        correlation: this.backend.identifiers().operationCorrelation(label),
        outcome: 'succeeded',
        cause: null
      }),
      commitState: 'confirmed'
    })
  }
}

/**
 * Reads every boundary value exactly once into backend-owned immutable records.
 * Native WinRT projections may be mutable, accessor-backed, or proxies, so no
 * native record is retained after discovery validation completes.
 */
function normalizeWinRtGattSnapshot(snapshot: unknown): WinRtGattSnapshot {
  const snapshotRecord = requireWinRtGattSnapshotRecord(snapshot, 'root')
  const cacheMode = readWinRtGattSnapshotProperty(snapshotRecord, 'cacheMode', 'cache-mode')
  if (cacheMode !== 'cached' && cacheMode !== 'uncached') {
    throwWinRtGattSnapshotMalformed('cache-mode')
  }
  const serviceIdentities = new Set<string>()
  const services = normalizeWinRtGattSnapshotArray(
    readWinRtGattSnapshotProperty(snapshotRecord, 'services', 'services'),
    'services',
    service => normalizeWinRtGattService(service, serviceIdentities)
  )
  return Object.freeze({ cacheMode, services })
}

function normalizeWinRtGattService(
  value: unknown,
  serviceIdentities: Set<string>
): WinRtGattSnapshot['services'][number] {
  const service = requireWinRtGattSnapshotRecord(value, 'service')
  const serviceOccurrence = requireWinRtGattSnapshotOccurrence(
    readWinRtGattSnapshotProperty(service, 'occurrence', 'service-occurrence'),
    'service'
  )
  const serviceUuid = requireWinRtGattSnapshotUuid(
    readWinRtGattSnapshotProperty(service, 'uuid', 'service-uuid'),
    'service'
  )
  assertUniqueGattIdentity(serviceIdentities, serviceUuid, serviceOccurrence, 'service')
  const characteristicIdentities = new Set<string>()
  const characteristics = normalizeWinRtGattSnapshotArray(
    readWinRtGattSnapshotProperty(service, 'characteristics', 'characteristics'),
    'characteristics',
    characteristic => normalizeWinRtGattCharacteristic(characteristic, characteristicIdentities)
  )
  return Object.freeze({ uuid: serviceUuid, occurrence: serviceOccurrence, characteristics })
}

function normalizeWinRtGattCharacteristic(
  value: unknown,
  characteristicIdentities: Set<string>
): WinRtGattSnapshot['services'][number]['characteristics'][number] {
  const characteristic = requireWinRtGattSnapshotRecord(value, 'characteristic')
  const characteristicOccurrence = requireWinRtGattSnapshotOccurrence(
    readWinRtGattSnapshotProperty(characteristic, 'occurrence', 'characteristic-occurrence'),
    'characteristic'
  )
  const characteristicUuid = requireWinRtGattSnapshotUuid(
    readWinRtGattSnapshotProperty(characteristic, 'uuid', 'characteristic-uuid'),
    'characteristic'
  )
  assertUniqueGattIdentity(characteristicIdentities, characteristicUuid, characteristicOccurrence, 'characteristic')
  const readable = requireWinRtGattSnapshotBoolean(
    readWinRtGattSnapshotProperty(characteristic, 'readable', 'characteristic-readable'),
    'characteristic-readable'
  )
  const writableWithResponse = requireWinRtGattSnapshotBoolean(
    readWinRtGattSnapshotProperty(characteristic, 'writableWithResponse', 'characteristic-writable-with-response'),
    'characteristic-writable-with-response'
  )
  const writableWithoutResponse = requireWinRtGattSnapshotBoolean(
    readWinRtGattSnapshotProperty(
      characteristic,
      'writableWithoutResponse',
      'characteristic-writable-without-response'
    ),
    'characteristic-writable-without-response'
  )
  const notifiable = requireWinRtGattSnapshotBoolean(
    readWinRtGattSnapshotProperty(characteristic, 'notifiable', 'characteristic-notifiable'),
    'characteristic-notifiable'
  )
  const indicatable = requireWinRtGattSnapshotBoolean(
    readWinRtGattSnapshotProperty(characteristic, 'indicatable', 'characteristic-indicatable'),
    'characteristic-indicatable'
  )
  const descriptorIdentities = new Set<string>()
  const descriptors = normalizeWinRtGattSnapshotArray(
    readWinRtGattSnapshotProperty(characteristic, 'descriptors', 'descriptors'),
    'descriptors',
    descriptor => normalizeWinRtGattDescriptor(descriptor, descriptorIdentities)
  )
  return Object.freeze({
    uuid: characteristicUuid,
    occurrence: characteristicOccurrence,
    readable,
    writableWithResponse,
    writableWithoutResponse,
    notifiable,
    indicatable,
    descriptors
  })
}

function normalizeWinRtGattDescriptor(
  value: unknown,
  descriptorIdentities: Set<string>
): WinRtGattSnapshot['services'][number]['characteristics'][number]['descriptors'][number] {
  const descriptor = requireWinRtGattSnapshotRecord(value, 'descriptor')
  const descriptorOccurrence = requireWinRtGattSnapshotOccurrence(
    readWinRtGattSnapshotProperty(descriptor, 'occurrence', 'descriptor-occurrence'),
    'descriptor'
  )
  const descriptorUuid = requireWinRtGattSnapshotUuid(
    readWinRtGattSnapshotProperty(descriptor, 'uuid', 'descriptor-uuid'),
    'descriptor'
  )
  assertUniqueGattIdentity(descriptorIdentities, descriptorUuid, descriptorOccurrence, 'descriptor')
  return Object.freeze({ uuid: descriptorUuid, occurrence: descriptorOccurrence })
}

function normalizeWinRtGattSnapshotArray<Value>(
  value: unknown,
  field: string,
  normalize: (entry: unknown) => Value
): readonly Value[] {
  const nativeArray = requireWinRtGattSnapshotArray(value, field)
  const length = requireWinRtGattSnapshotArrayLength(nativeArray, field)
  const normalized: Value[] = []
  for (let index = 0; index < length; index += 1) {
    normalized.push(normalize(readWinRtGattSnapshotArrayEntry(nativeArray, index, field)))
  }
  return Object.freeze(normalized)
}

function requireWinRtGattSnapshotRecord(value: unknown, field: string): object {
  if (!isWinRtGattSnapshotRecord(value)) {
    throwWinRtGattSnapshotMalformed(field)
  }
  return value
}

function isWinRtGattSnapshotRecord(value: unknown): value is object {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  try {
    return !Array.isArray(value)
  } catch {
    return false
  }
}

function requireWinRtGattSnapshotArray(value: unknown, field: string): readonly unknown[] {
  try {
    if (Array.isArray(value)) {
      return value
    }
  } catch {
    // A revoked proxy can throw during Array.isArray; it is malformed boundary data.
  }
  throwWinRtGattSnapshotMalformed(field)
}

function readWinRtGattSnapshotProperty(record: object, property: string, field: string): unknown {
  try {
    return Reflect.get(record, property)
  } catch {
    throwWinRtGattSnapshotMalformed(field)
  }
}

function requireWinRtGattSnapshotArrayLength(array: readonly unknown[], field: string): number {
  const length = readWinRtGattSnapshotProperty(array, 'length', field)
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) {
    throwWinRtGattSnapshotMalformed(field)
  }
  return length
}

function readWinRtGattSnapshotArrayEntry(array: readonly unknown[], index: number, field: string): unknown {
  return readWinRtGattSnapshotProperty(array, String(index), field)
}

function requireWinRtGattSnapshotBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throwWinRtGattSnapshotMalformed(field)
  }
  return value
}

function requireWinRtGattSnapshotOccurrence(value: unknown, resource: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throwWinRtGattSnapshotMalformed(`${resource}-occurrence`)
  }
  return value
}

function requireWinRtGattSnapshotUuid(value: unknown, resource: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) {
    throwWinRtGattSnapshotMalformed(`${resource}-uuid`)
  }
  return value
}

function assertUniqueGattIdentity(identities: Set<string>, uuid: string, occurrence: number, resource: string): void {
  const identity = `${uuid}\u0000${occurrence}`
  if (identities.has(identity)) {
    throwWinRtGattSnapshotMalformed(`${resource}-identity`)
  }
  identities.add(identity)
}

function throwWinRtGattSnapshotMalformed(field: string): never {
  throw contractError('protocol.malformed', 'gatt', `winrt.gatt.snapshot.${field}`)
}
