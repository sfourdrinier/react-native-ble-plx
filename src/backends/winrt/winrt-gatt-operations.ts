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
import { CoreBoundedStream } from '../../core/bounded-stream'
import {
  WinRtBackendSubscription,
  WinRtGattDatabase,
  characteristicAddressKey,
  releasedCleanup,
  successfulTerminal
} from './winrt-handles'
import type { WinRtBackend, WinRtConnectionRecord } from './winrt-backend'
import type { WinRtCharacteristicAddress, WinRtDescriptorAddress, WinRtGattSnapshot } from './winrt-boundary'
import {
  createWinRtPhysicalSubscription,
  createWinRtSubscription,
  emitWinRtNotification,
  removeWinRtSubscription,
  stopWinRtPhysicalSubscription
} from './winrt-subscription-runtime'
import { winRtPlatformError } from './winrt-backend-helpers'

const maximumValueBytes = byteLimit(512 * 1024)

/** Implements every complete GATT path against the strict WinRT boundary. */
export class WinRtGattOperations {
  constructor(private readonly backend: WinRtBackend) {}

  async discover(
    connection: BackendConnection<string, string>,
    options: PublicOperationOptions
  ): Promise<GattDatabase<string, string, string>> {
    this.backend.assertGattUsable('winrt.gatt.discover')
    const record = this.backend.requireConnection(connection, 'winrt.gatt.discover')
    const dispatch = this.backend.dispatcher.dispatch(options, 'winrt.gatt.discover', () =>
      this.backend.boundary.discover(record.nativePeerId)
    )
    try {
      return this.createDatabase(record, await dispatch.completion)
    } catch (error) {
      throw winRtPlatformError('gatt.read-failed', 'gatt', 'winrt.gatt.discover', error)
    }
  }

  read(
    path: CharacteristicPath<string, string, string, string, string, 'current'>,
    request: ReadRequest<string, string>
  ) {
    this.backend.assertGattUsable('winrt.gatt.read')
    const address = this.backend.databaseForPath(path, 'winrt.gatt.read').addressFor(path, 'winrt.gatt.read')
    return this.backend.dispatcher.dispatch(request.operation, 'winrt.gatt.read', () => {
      const native = this.backend.boundary.read(address)
      return {
        completion: native.completion.then(value =>
          Object.freeze({ value: ownBytes(value, maximumValueBytes), terminal: successfulTerminal(request.operation) })
        ),
        cancel: () => native.cancel()
      }
    })
  }

  write(
    path: CharacteristicPath<string, string, string, string, string, 'current'>,
    request: WriteRequest<string, string>
  ) {
    this.backend.assertGattUsable('winrt.gatt.write')
    const address = this.backend.databaseForPath(path, 'winrt.gatt.write').addressFor(path, 'winrt.gatt.write')
    const copied = ownBytes(request.bytes, maximumValueBytes)
    const result: WriteResult<string, string> = Object.freeze({
      terminal: successfulTerminal(request.operation),
      commitState: 'confirmed'
    })
    return this.backend.dispatcher.dispatch(request.operation, 'winrt.gatt.write', () => {
      const native = this.backend.boundary.write(address, new Uint8Array(copied), request.mode)
      return { completion: native.completion.then(() => result), cancel: () => native.cancel() }
    })
  }

  readDescriptor(
    path: DescriptorPath<string, string, string, string, string, string, 'current'>,
    request: ReadRequest<string, string>
  ) {
    this.backend.assertGattUsable('winrt.gatt.read-descriptor')
    const address = this.backend
      .descriptorDatabaseForPath(path, 'winrt.gatt.read-descriptor')
      .descriptorAddressFor(path, 'winrt.gatt.read-descriptor')
    return this.backend.dispatcher.dispatch(request.operation, 'winrt.gatt.read-descriptor', () => {
      const native = this.backend.boundary.readDescriptor(address)
      const result: ReadResult<string, string> = Object.freeze({
        value: ownBytes(new Uint8Array(), maximumValueBytes),
        terminal: successfulTerminal(request.operation)
      })
      return {
        completion: native.completion.then(value =>
          Object.freeze({ ...result, value: ownBytes(value, maximumValueBytes) })
        ),
        cancel: () => native.cancel()
      }
    })
  }

  writeDescriptor(
    path: DescriptorPath<string, string, string, string, string, string, 'current'>,
    request: WriteRequest<string, string>
  ) {
    this.backend.assertGattUsable('winrt.gatt.write-descriptor')
    const address = this.backend
      .descriptorDatabaseForPath(path, 'winrt.gatt.write-descriptor')
      .descriptorAddressFor(path, 'winrt.gatt.write-descriptor')
    const copied = ownBytes(request.bytes, maximumValueBytes)
    const result: WriteResult<string, string> = Object.freeze({
      terminal: successfulTerminal(request.operation),
      commitState: 'confirmed'
    })
    return this.backend.dispatcher.dispatch(request.operation, 'winrt.gatt.write-descriptor', () => {
      const native = this.backend.boundary.writeDescriptor(address, new Uint8Array(copied), request.mode)
      return { completion: native.completion.then(() => result), cancel: () => native.cancel() }
    })
  }

  subscribe(
    path: CharacteristicPath<string, string, string, string, string, 'current'>,
    request: SubscribeRequest<string, string>
  ) {
    this.backend.assertGattUsable('winrt.gatt.subscribe')
    const address = this.backend.databaseForPath(path, 'winrt.gatt.subscribe').addressFor(path, 'winrt.gatt.subscribe')
    return this.backend.dispatcher.dispatch(
      request.operation,
      'winrt.gatt.subscribe',
      () => ({ completion: this.enableSubscription(address, path, request), cancel: async () => 'not-cancellable' }),
      subscription =>
        subscription.remove().then(cleanup => {
          if (cleanup.state === 'release-failed') {
            throw contractError('platform.failure', 'cleanup', 'winrt.gatt.subscribe.late-cleanup')
          }
        })
    )
  }

  unsubscribe(
    subscription: BackendSubscription<string, string, string, string, string>,
    operation: OperationOptions<string, string>
  ) {
    this.backend.assertGattUsable('winrt.gatt.unsubscribe')
    if (!(subscription instanceof WinRtBackendSubscription)) {
      throw contractError('ownership.denied', 'gatt', 'winrt.gatt.unsubscribe.subscription')
    }
    return this.backend.dispatcher.dispatch(operation, 'winrt.gatt.unsubscribe', () => ({
      completion: this.removeSubscription(subscription).then(cleanup => {
        if (cleanup.state === 'release-failed') {
          throw contractError('platform.failure', 'cleanup', 'winrt.gatt.unsubscribe.cleanup')
        }
        return successfulTerminal(operation)
      }),
      cancel: async () => 'not-cancellable'
    }))
  }

  removeSubscription(subscription: WinRtBackendSubscription): Promise<CleanupRecord> {
    return removeWinRtSubscription(this.backend, subscription)
  }

  async readFromDatabase(address: WinRtCharacteristicAddress, options: PublicOperationOptions): Promise<OwnedBytes> {
    this.backend.assertGattUsable('winrt.gatt.database-read')
    const dispatch = this.backend.dispatcher.dispatch(options, 'winrt.gatt.database-read', () =>
      this.backend.boundary.read(address)
    )
    return ownBytes(await dispatch.completion, maximumValueBytes)
  }

  async writeFromDatabase(
    address: WinRtCharacteristicAddress,
    value: Uint8Array,
    options: import('../../backend-contract/operations').WritePolicy
  ): Promise<WriteReceipt<string, string>> {
    this.backend.assertGattUsable('winrt.gatt.database-write')
    const copied = ownBytes(value, maximumValueBytes)
    const dispatch = this.backend.dispatcher.dispatch(options, 'winrt.gatt.database-write', () =>
      this.backend.boundary.write(address, new Uint8Array(copied), options.mode)
    )
    await dispatch.completion
    return this.databaseWriteReceipt('winrt-database-write')
  }

  async readDescriptorFromDatabase(
    address: WinRtDescriptorAddress,
    options: PublicOperationOptions
  ): Promise<OwnedBytes> {
    this.backend.assertGattUsable('winrt.gatt.database-read-descriptor')
    const dispatch = this.backend.dispatcher.dispatch(options, 'winrt.gatt.database-read-descriptor', () =>
      this.backend.boundary.readDescriptor(address)
    )
    return ownBytes(await dispatch.completion, maximumValueBytes)
  }

  async writeDescriptorFromDatabase(
    address: WinRtDescriptorAddress,
    value: Uint8Array,
    options: import('../../backend-contract/operations').WritePolicy
  ): Promise<WriteReceipt<string, string>> {
    this.backend.assertGattUsable('winrt.gatt.database-write-descriptor')
    const copied = ownBytes(value, maximumValueBytes)
    const dispatch = this.backend.dispatcher.dispatch(options, 'winrt.gatt.database-write-descriptor', () =>
      this.backend.boundary.writeDescriptor(address, new Uint8Array(copied), options.mode)
    )
    await dispatch.completion
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

  private async enableSubscription(
    address: WinRtCharacteristicAddress,
    path: CharacteristicPath<string, string, string, string, string, 'current'>,
    request: SubscribeRequest<string, string>
  ): Promise<WinRtBackendSubscription> {
    const key = characteristicAddressKey(address)
    let physical = this.backend.subscriptions.get(key)
    if (physical?.state === 'removing') {
      const cleanup = physical.removal === null ? releasedCleanup : await physical.removal
      if (cleanup.state === 'release-failed') {
        throw contractError('platform.failure', 'cleanup', 'winrt.gatt.subscribe.cleanup-pending')
      }
      physical = this.backend.subscriptions.get(key)
    }
    if (physical === undefined) {
      const mode = this.backend.databaseForPath(path, 'winrt.gatt.subscribe.mode').notificationModeForPath(path)
      physical = createWinRtPhysicalSubscription(this.backend, address, mode)
      const enabling = physical
      try {
        await this.backend.boundary.startNotify(address, mode, value => emitWinRtNotification(enabling, value))
          .completion
      } catch (error) {
        if (this.backend.subscriptions.get(key) === enabling) {
          this.backend.subscriptions.delete(key)
        }
        console.error('[WinRtGattOperations.enableSubscription] WinRT CCCD enable failed:', error)
        throw error
      }
      if (this.backend.subscriptions.get(key) !== enabling) {
        const cleanup = await stopWinRtPhysicalSubscription(this.backend, enabling)
        if (cleanup.state === 'release-failed') {
          throw contractError('platform.failure', 'cleanup', 'winrt.gatt.subscribe.destroyed-cleanup')
        }
        throw contractError('operation.cancelled-by-destroy', 'gatt', 'winrt.gatt.subscribe.destroyed')
      }
      enabling.state = 'ready'
    }
    return createWinRtSubscription(
      this.backend,
      physical,
      path,
      successfulTerminal(request.operation),
      new CoreBoundedStream(request.options.delivery, request.options.delivery.overflowPolicy)
    )
  }

  private createDatabase(record: WinRtConnectionRecord, snapshot: WinRtGattSnapshot): WinRtGattDatabase {
    assertWinRtGattSnapshot(snapshot)
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
    const database = new WinRtGattDatabase(this.backend, record, path, snapshot)
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

function assertWinRtGattSnapshot(snapshot: WinRtGattSnapshot): void {
  if (snapshot.cacheMode !== 'cached' && snapshot.cacheMode !== 'uncached') {
    throw contractError('protocol.malformed', 'gatt', 'winrt.gatt.snapshot.cache-mode')
  }
  for (const service of snapshot.services) {
    assertNativeOccurrence(service.occurrence, 'service')
    assertCanonicalUuid(service.uuid, 'service')
    for (const characteristic of service.characteristics) {
      assertNativeOccurrence(characteristic.occurrence, 'characteristic')
      assertCanonicalUuid(characteristic.uuid, 'characteristic')
      for (const descriptor of characteristic.descriptors) {
        assertNativeOccurrence(descriptor.occurrence, 'descriptor')
        assertCanonicalUuid(descriptor.uuid, 'descriptor')
      }
    }
  }
}

function assertNativeOccurrence(value: number, resource: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw contractError('protocol.malformed', 'gatt', `winrt.gatt.snapshot.${resource}-occurrence`)
  }
}

function assertCanonicalUuid(value: string, resource: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) {
    throw contractError('protocol.malformed', 'gatt', `winrt.gatt.snapshot.${resource}-uuid`)
  }
}
