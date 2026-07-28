// src/web/web-bluetooth-gatt.ts

import type { BackendConnection, BackendSubscription, GattBackend } from '../backend-contract/backend'
import { contractError } from '../backend-contract/errors'
import type { CleanupFailure, CleanupRecord } from '../backend-contract/errors'
import type { AttachmentRecord } from '../backend-contract/identity'
import type {
  Characteristic,
  CharacteristicPath,
  Descriptor,
  DescriptorPath,
  GattDatabase,
  NotificationValue,
  Service
} from '../backend-contract/gatt'
import { createBackendOperationDispatch, createOperationSettlementCoordinator } from '../backend-contract/operations'
import type {
  BackendOperationDispatch,
  CancellationAcknowledgement,
  OperationOptions,
  OperationTerminalRecord,
  PublicOperationOptions,
  ReadRequest,
  ReadResult,
  SubscribeRequest,
  SubscriptionOptions,
  WritePolicy,
  WriteReceipt,
  WriteRequest,
  WriteResult
} from '../backend-contract/operations'
import { canonicalUuid, opaqueId, ownBytes } from '../backend-contract/primitives'
import type { AttachmentBoundIdFactory, ByteLimit, Deadline, OwnedBytes } from '../backend-contract/primitives'
import { byteLimit } from '../backend-contract/primitives'
import { CoreBoundedStream } from '../core/bounded-stream'
import type {
  WebBluetoothCharacteristicBoundary,
  WebBluetoothDescriptorBoundary,
  WebBluetoothServiceBoundary
} from './web-bluetooth-boundary'
import { webCleanupFailure } from './web-bluetooth-errors'
import { characteristicKey, descriptorKey, WebBackendSubscription, WebGattDatabase } from './web-bluetooth-handles'
import type { WebConnectionRecord, WebGattDatabaseHost, WebManagedSubscription } from './web-bluetooth-handles'

export interface WebGattHost extends WebGattDatabaseHost {
  readonly attachment: AttachmentRecord<string>
  identifiers(): AttachmentBoundIdFactory<string>
  requireConnection(connection: BackendConnection<string, string>, operation: string): WebConnectionRecord
  requireDatabase(
    path:
      | CharacteristicPath<string, string, string, string, string>
      | DescriptorPath<string, string, string, string, string, string>,
    operation: string
  ): WebGattDatabase
  runAbortable<Result>(
    record: WebConnectionRecord | null,
    operation: { readonly signal: AbortSignal | null; readonly deadline: Deadline | null },
    start: () => Promise<Result>,
    fallbackCode: import('../backend-contract/errors').BleErrorCode,
    domain: 'chooser' | 'connection' | 'gatt',
    operationName: string,
    onLateSuccess?: ((result: Result) => Promise<void> | void) | null
  ): Promise<Result>
  staleGattError(operation: string): import('../backend-contract/errors').BackendContractError
}

const RELEASED: CleanupRecord = { state: 'released', failures: [] }
const MAXIMUM_VALUE_BYTES: ByteLimit = byteLimit(512 * 1024)

export class WebBluetoothGattRuntime {
  readonly gatt: GattBackend<string>
  private nextDatabase = 1
  private nextSubscription = 1
  private nextOperation = 1
  private readonly subscriptions = new Map<string, WebManagedSubscription>()

  constructor(private readonly host: WebGattHost) {
    this.gatt = this.createGattBackend()
  }

  subscriptionCount(): number {
    return this.subscriptions.size
  }

  retainedSubscriptionCount(): number {
    return [...this.subscriptions.values()].filter(subscription => subscription.stream.retainedPayloadBytes() > 0)
      .length
  }

  async destroySubscriptions(): Promise<readonly CleanupFailure[]> {
    const failures: CleanupFailure[] = []
    for (const subscription of [...this.subscriptions.values()]) {
      if (subscription.state === 'cleanup-failed' && !subscription.cleanupFailureReported) {
        subscription.cleanupFailureReported = true
        failures.push(...webCleanupFailure('subscription', 'web-gatt.retained-cleanup-failure').failures)
        continue
      }
      const cleanup = await this.removeManagedSubscription(subscription)
      failures.push(...cleanup.failures)
    }
    return failures
  }

  invalidateConnection(record: WebConnectionRecord, reason: 'connection-lost' | 'owner-released'): void {
    for (const subscription of [...this.subscriptions.values()]) {
      if (subscription.database.record === record) {
        this.beginLogicalSubscriptionStop(subscription, reason)
        this.finishStoppedSubscription(subscription)
      }
    }
  }

  async stopConnectionSubscriptions(record: WebConnectionRecord): Promise<CleanupRecord> {
    const failures: CleanupFailure[] = []
    for (const subscription of [...this.subscriptions.values()]) {
      if (subscription.database.record === record) {
        const cleanup = await this.removeManagedSubscription(subscription)
        failures.push(...cleanup.failures)
      }
    }
    return failures.length === 0 ? RELEASED : { state: 'release-failed', failures }
  }

  async readDirect(
    database: WebGattDatabase,
    path: CharacteristicPath<string, string, string, string, string, 'current'>,
    options: PublicOperationOptions
  ): Promise<OwnedBytes> {
    return this.readCharacteristic(database, path, options)
  }

  async writeDirect(
    database: WebGattDatabase,
    path: CharacteristicPath<string, string, string, string, string, 'current'>,
    value: Readonly<Uint8Array>,
    options: WritePolicy
  ): Promise<WriteReceipt<string, string>> {
    await this.writeCharacteristic(database, path, value, options)
    return terminalWriteReceipt(this.operationCorrelation('direct-write'), 'confirmed')
  }

  async readDescriptorDirect(
    database: WebGattDatabase,
    path: DescriptorPath<string, string, string, string, string, string, 'current'>,
    options: PublicOperationOptions
  ): Promise<OwnedBytes> {
    return this.readDescriptorValue(database, path, options)
  }

  async writeDescriptorDirect(
    database: WebGattDatabase,
    path: DescriptorPath<string, string, string, string, string, string, 'current'>,
    value: Readonly<Uint8Array>,
    options: WritePolicy
  ): Promise<WriteReceipt<string, string>> {
    await this.writeDescriptorValue(database, path, value, options)
    return terminalWriteReceipt(this.operationCorrelation('direct-descriptor-write'), 'confirmed')
  }

  async subscribeDirect(
    database: WebGattDatabase,
    path: CharacteristicPath<string, string, string, string, string, 'current'>,
    options: SubscriptionOptions
  ): Promise<import('../backend-contract/gatt').Subscription<string, string, string, string, string, string>> {
    const managed = await this.enableSubscription(
      database,
      path,
      options,
      this.operationCorrelation('direct-subscribe')
    )
    return {
      subscriptionId: managed.subscriptionId,
      path: managed.path,
      values: managed.stream,
      remove: () => this.removeManagedSubscription(managed)
    }
  }

  private createGattBackend(): GattBackend<string> {
    return {
      discover: async (connection, options) => this.discover(connection, options),
      read: (path, request) => this.dispatch(request.operation, operation => this.readResult(path, { operation })),
      write: (path, request) =>
        this.dispatch(request.operation, operation => this.writeResult(path, { ...request, operation })),
      readDescriptor: (path, request) =>
        this.dispatch(request.operation, operation => this.readDescriptorResult(path, { operation })),
      writeDescriptor: (path, request) =>
        this.dispatch(request.operation, operation => this.writeDescriptorResult(path, { ...request, operation })),
      subscribe: (path, request) =>
        this.dispatch(request.operation, operation => this.subscribeResult(path, { ...request, operation })),
      unsubscribe: (subscription, operation) =>
        this.dispatch(operation, dispatched => this.unsubscribeResult(subscription, dispatched))
    }
  }

  private async discover(
    connection: BackendConnection<string, string>,
    options: PublicOperationOptions
  ): Promise<GattDatabase<string, string, string>> {
    const record = this.host.requireConnection(connection, 'web-gatt.discover')
    if (record.database !== null) {
      const cleanup = await this.stopDatabaseSubscriptions(record.database)
      if (cleanup.state === 'release-failed') {
        throw contractError('gatt.subscribe-failed', 'gatt', 'web-gatt.rediscovery-subscription-cleanup')
      }
      record.database.invalidate()
      record.database = null
    }
    const nativeServices = await this.host.runAbortable(
      record,
      options,
      () => record.device.gatt.getPrimaryServices(),
      'gatt.not-found',
      'gatt',
      'web-gatt.discover'
    )
    const database = await this.buildDatabase(record, nativeServices, options)
    record.database = database
    return database
  }

  private async buildDatabase(
    record: WebConnectionRecord,
    nativeServices: readonly WebBluetoothServiceBoundary[],
    options: PublicOperationOptions
  ): Promise<WebGattDatabase> {
    const databaseNumber = this.nextDatabase
    this.nextDatabase += 1
    const attachment = this.host.attachment
    const databasePath = {
      attachment,
      attachmentId: attachment.attachmentId,
      peerId: record.peerId,
      connectionId: record.connection.connectionId,
      ownerLeaseId: record.leaseId,
      connectionGeneration: record.connection.connectionGeneration,
      databaseId: this.host.identifiers().databaseId(`web-database-${databaseNumber}`),
      databaseGeneration: opaqueId(
        `web-database-generation-${databaseNumber}`,
        'database-generation',
        `web-bluetooth:${String(record.connection.connectionId)}`
      )
    }
    const services: Service<string, string, string, string>[] = []
    const characteristics: Characteristic<string, string, string, string, string>[] = []
    const descriptors: Descriptor<string, string, string, string, string, string>[] = []
    const characteristicBoundaries = new Map<string, WebBluetoothCharacteristicBoundary>()
    const descriptorBoundaries = new Map<string, WebBluetoothDescriptorBoundary>()
    for (let serviceIndex = 0; serviceIndex < nativeServices.length; serviceIndex += 1) {
      const nativeService = nativeServices[serviceIndex]
      if (nativeService === undefined) {
        throw contractError('protocol.malformed', 'gatt', 'web-gatt.discovery-service')
      }
      const serviceUuid = canonicalUuid(nativeService.uuid)
      const servicePath = {
        ...databasePath,
        serviceUuid,
        serviceOccurrence: opaqueId(
          String(serviceIndex + 1),
          'service-occurrence',
          `${String(databasePath.databaseId)}:${String(serviceUuid)}`
        )
      }
      services.push({ path: servicePath })
      const nativeCharacteristics = await this.host.runAbortable(
        record,
        options,
        () => nativeService.getCharacteristics(),
        'gatt.not-found',
        'gatt',
        'web-gatt.discover-characteristics'
      )
      for (let characteristicIndex = 0; characteristicIndex < nativeCharacteristics.length; characteristicIndex += 1) {
        const nativeCharacteristic = nativeCharacteristics[characteristicIndex]
        if (nativeCharacteristic === undefined) {
          throw contractError('protocol.malformed', 'gatt', 'web-gatt.discovery-characteristic')
        }
        const characteristicUuid = canonicalUuid(nativeCharacteristic.uuid)
        const path: CharacteristicPath<string, string, string, string, string, 'current'> = {
          ...servicePath,
          characteristicUuid,
          characteristicOccurrence: opaqueId(
            String(characteristicIndex + 1),
            'characteristic-occurrence',
            `${String(servicePath.serviceOccurrence)}:${String(characteristicUuid)}`
          ),
          validity: 'current'
        }
        characteristics.push({ path })
        characteristicBoundaries.set(characteristicKey(path), nativeCharacteristic)
        const nativeDescriptors = await this.host.runAbortable(
          record,
          options,
          () => nativeCharacteristic.getDescriptors(),
          'gatt.not-found',
          'gatt',
          'web-gatt.discover-descriptors'
        )
        for (let descriptorIndex = 0; descriptorIndex < nativeDescriptors.length; descriptorIndex += 1) {
          const nativeDescriptor = nativeDescriptors[descriptorIndex]
          if (nativeDescriptor === undefined) {
            throw contractError('protocol.malformed', 'gatt', 'web-gatt.discovery-descriptor')
          }
          const descriptorUuid = canonicalUuid(nativeDescriptor.uuid)
          const descriptorPath = {
            ...path,
            descriptorUuid,
            descriptorOccurrence: opaqueId(
              String(descriptorIndex + 1),
              'descriptor-occurrence',
              `${String(path.characteristicOccurrence)}:${String(descriptorUuid)}`
            )
          }
          descriptors.push({ path: descriptorPath })
          descriptorBoundaries.set(descriptorKey(descriptorPath), nativeDescriptor)
        }
      }
    }
    return new WebGattDatabase(
      this.host,
      record,
      databasePath,
      services,
      characteristics,
      descriptors,
      characteristicBoundaries,
      descriptorBoundaries
    )
  }

  private async readCharacteristic(
    database: WebGattDatabase,
    path: CharacteristicPath<string, string, string, string, string, 'current'>,
    options: PublicOperationOptions
  ): Promise<OwnedBytes> {
    const characteristic = this.requireCharacteristic(database, path, 'web-gatt.read')
    if (!characteristic.properties.read) {
      throw contractError('gatt.property-not-supported', 'gatt', 'web-gatt.read')
    }
    const value = await this.host.runAbortable(
      database.record,
      options,
      () => characteristic.readValue(),
      'gatt.read-failed',
      'gatt',
      'web-gatt.read'
    )
    return ownBytes(value, MAXIMUM_VALUE_BYTES)
  }

  private async writeCharacteristic(
    database: WebGattDatabase,
    path: CharacteristicPath<string, string, string, string, string, 'current'>,
    value: Readonly<Uint8Array>,
    options: WritePolicy
  ): Promise<void> {
    const characteristic = this.requireCharacteristic(database, path, 'web-gatt.write')
    const copied = ownBytes(value, MAXIMUM_VALUE_BYTES)
    if (options.mode === 'with-response') {
      if (!characteristic.properties.write) {
        throw contractError('gatt.property-not-supported', 'gatt', 'web-gatt.write-with-response')
      }
      await this.host.runAbortable(
        database.record,
        options,
        () => characteristic.writeValueWithResponse(new Uint8Array(copied)),
        'gatt.write-failed',
        'gatt',
        'web-gatt.write-with-response'
      )
      return
    }
    if (!characteristic.properties.writeWithoutResponse) {
      throw contractError('gatt.property-not-supported', 'gatt', 'web-gatt.write-without-response')
    }
    await this.host.runAbortable(
      database.record,
      options,
      () => characteristic.writeValueWithoutResponse(new Uint8Array(copied)),
      'gatt.write-failed',
      'gatt',
      'web-gatt.write-without-response'
    )
  }

  private async readDescriptorValue(
    database: WebGattDatabase,
    path: DescriptorPath<string, string, string, string, string, string, 'current'>,
    options: PublicOperationOptions
  ): Promise<OwnedBytes> {
    const descriptor = this.requireDescriptor(database, path, 'web-gatt.read-descriptor')
    const value = await this.host.runAbortable(
      database.record,
      options,
      () => descriptor.readValue(),
      'gatt.read-failed',
      'gatt',
      'web-gatt.read-descriptor'
    )
    return ownBytes(value, MAXIMUM_VALUE_BYTES)
  }

  private async writeDescriptorValue(
    database: WebGattDatabase,
    path: DescriptorPath<string, string, string, string, string, string, 'current'>,
    value: Readonly<Uint8Array>,
    options: WritePolicy
  ): Promise<void> {
    const descriptor = this.requireDescriptor(database, path, 'web-gatt.write-descriptor')
    const copied = ownBytes(value, MAXIMUM_VALUE_BYTES)
    await this.host.runAbortable(
      database.record,
      options,
      () => descriptor.writeValue(new Uint8Array(copied)),
      'gatt.write-failed',
      'gatt',
      'web-gatt.write-descriptor'
    )
  }

  private async enableSubscription(
    database: WebGattDatabase,
    path: CharacteristicPath<string, string, string, string, string, 'current'>,
    options: SubscriptionOptions,
    correlation: OperationOptions<string, string>['correlation']
  ): Promise<WebManagedSubscription> {
    const characteristic = this.requireCharacteristic(database, path, 'web-gatt.subscribe')
    if (!characteristic.properties.notify && !characteristic.properties.indicate) {
      throw contractError('gatt.property-not-supported', 'gatt', 'web-gatt.subscribe')
    }
    const stream = new CoreBoundedStream<NotificationValue>(options.delivery, options.delivery.overflowPolicy)
    const subscriptionId = this.host.identifiers().subscriptionId(`web-subscription-${this.nextSubscription}`)
    this.nextSubscription += 1
    const managedState: { current: WebManagedSubscription | null } = { current: null }
    const listener = (value: Uint8Array): void => {
      const current = managedState.current
      if (current === null) {
        return
      }
      if ((current.state !== 'enabling' && current.state !== 'ready') || !database.record.valid) {
        return
      }
      const copied = ownBytes(value, MAXIMUM_VALUE_BYTES)
      const result = stream.emit(
        { value: copied, indication: characteristic.properties.indicate && !characteristic.properties.notify },
        copied.byteLength
      )
      if (result.terminated) {
        current.terminationCleanup = this.removeManagedSubscription(current)
      }
    }
    const managed: WebManagedSubscription = {
      subscriptionId,
      path,
      database,
      characteristic,
      listener,
      stream,
      terminal: terminalRecord(correlation),
      state: 'enabling',
      startupSettled: false,
      cleanupFailureReported: false,
      removeResult: null,
      terminationCleanup: null
    }
    managedState.current = managed
    this.subscriptions.set(String(subscriptionId), managed)
    characteristic.addNotificationListener(listener)
    const nativeStart = Promise.resolve().then(() => characteristic.startNotifications())
    nativeStart.then(
      () => {
        managed.startupSettled = true
        if (managed.state === 'stopping') {
          managed.terminationCleanup = this.removeManagedSubscription(managed)
        }
      },
      error => {
        managed.startupSettled = true
        if (managed.state === 'stopping') {
          console.error('[WebBluetoothGattRuntime.enableSubscription] Late notification start rejected:', error)
          this.finishStoppedSubscription(managed)
          return
        }
        if (managed.state === 'enabling') {
          console.error('[WebBluetoothGattRuntime.enableSubscription] Notification start rejected:', error)
          this.beginLogicalSubscriptionStop(managed, 'owner-released')
          this.finishStoppedSubscription(managed)
        }
      }
    )
    try {
      await this.host.runAbortable(
        database.record,
        options,
        () => nativeStart,
        'gatt.subscribe-failed',
        'gatt',
        'web-gatt.subscribe'
      )
    } catch (error) {
      this.beginLogicalSubscriptionStop(managed, 'owner-released')
      throw error
    }
    managed.startupSettled = true
    if (managed.state !== 'enabling') {
      const cleanup = await (managed.terminationCleanup ?? this.removeManagedSubscription(managed))
      if (cleanup.state === 'release-failed') {
        throw contractError('gatt.subscribe-failed', 'gatt', 'web-gatt.subscribe-overflow-cleanup')
      }
      throw contractError('stream.overflow', 'stream', 'web-gatt.subscribe-startup-overflow')
    }
    managed.state = 'ready'
    return managed
  }

  private removeManagedSubscription(managed: WebManagedSubscription): Promise<CleanupRecord> {
    if (managed.removeResult === null) {
      const removal = this.stopManagedSubscription(managed)
      managed.removeResult = removal.then(
        result => {
          if (result.state === 'release-failed') {
            managed.removeResult = null
          }
          return result
        },
        error => {
          managed.removeResult = null
          throw error
        }
      )
    }
    return managed.removeResult
  }

  private async stopManagedSubscription(managed: WebManagedSubscription): Promise<CleanupRecord> {
    if (managed.state === 'stopped') {
      return RELEASED
    }
    this.beginLogicalSubscriptionStop(managed, 'owner-released')
    if (!managed.startupSettled) {
      return webCleanupFailure('subscription', 'web-gatt.notification-start-pending')
    }
    managed.state = 'stopping'
    try {
      await managed.characteristic.stopNotifications()
      this.finishStoppedSubscription(managed)
      return RELEASED
    } catch (error) {
      managed.state = 'cleanup-failed'
      managed.cleanupFailureReported = false
      console.error('[WebBluetoothGattRuntime.stopManagedSubscription] Notification stop rejected:', error)
      return webCleanupFailure('subscription', 'web-gatt.unsubscribe')
    }
  }

  private beginLogicalSubscriptionStop(
    managed: WebManagedSubscription,
    reason: 'connection-lost' | 'owner-released'
  ): void {
    if (managed.state === 'stopped' || managed.state === 'stopping' || managed.state === 'cleanup-failed') {
      return
    }
    managed.state = 'stopping'
    managed.characteristic.removeNotificationListener(managed.listener)
    managed.stream.closeWithReason(reason)
  }

  private finishStoppedSubscription(managed: WebManagedSubscription): void {
    managed.state = 'stopped'
    this.subscriptions.delete(String(managed.subscriptionId))
  }

  private async stopDatabaseSubscriptions(database: WebGattDatabase): Promise<CleanupRecord> {
    const failures: CleanupFailure[] = []
    for (const subscription of [...this.subscriptions.values()]) {
      if (subscription.database === database) {
        const cleanup = await this.removeManagedSubscription(subscription)
        failures.push(...cleanup.failures)
      }
    }
    return failures.length === 0 ? RELEASED : { state: 'release-failed', failures }
  }

  private async readResult(
    path: CharacteristicPath<string, string, string, string, string, 'current'>,
    request: ReadRequest<string, string>
  ): Promise<ReadResult<string, string>> {
    const database = this.host.requireDatabase(path, 'web-gatt.read')
    return {
      value: await this.readCharacteristic(database, path, request.operation),
      terminal: terminalRecord(request.operation.correlation)
    }
  }

  private async writeResult(
    path: CharacteristicPath<string, string, string, string, string, 'current'>,
    request: WriteRequest<string, string>
  ): Promise<WriteResult<string, string>> {
    const database = this.host.requireDatabase(path, 'web-gatt.write')
    await this.writeCharacteristic(database, path, request.bytes, {
      signal: request.operation.signal,
      deadline: request.operation.deadline,
      mode: request.mode
    })
    return terminalWriteReceipt(request.operation.correlation, 'confirmed')
  }

  private async readDescriptorResult(
    path: DescriptorPath<string, string, string, string, string, string, 'current'>,
    request: ReadRequest<string, string>
  ): Promise<ReadResult<string, string>> {
    const database = this.host.requireDatabase(path, 'web-gatt.read-descriptor')
    return {
      value: await this.readDescriptorValue(database, path, request.operation),
      terminal: terminalRecord(request.operation.correlation)
    }
  }

  private async writeDescriptorResult(
    path: DescriptorPath<string, string, string, string, string, string, 'current'>,
    request: WriteRequest<string, string>
  ): Promise<WriteResult<string, string>> {
    const database = this.host.requireDatabase(path, 'web-gatt.write-descriptor')
    await this.writeDescriptorValue(database, path, request.bytes, {
      signal: request.operation.signal,
      deadline: request.operation.deadline,
      mode: request.mode
    })
    return terminalWriteReceipt(request.operation.correlation, 'confirmed')
  }

  private async subscribeResult(
    path: CharacteristicPath<string, string, string, string, string, 'current'>,
    request: SubscribeRequest<string, string>
  ): Promise<BackendSubscription<string, string, string, string, string>> {
    const database = this.host.requireDatabase(path, 'web-gatt.subscribe')
    return new WebBackendSubscription(
      await this.enableSubscription(database, path, request.options, request.operation.correlation)
    )
  }

  private async unsubscribeResult(
    subscription: BackendSubscription<string, string, string, string, string>,
    operation: OperationOptions<string, string>
  ): Promise<OperationTerminalRecord<string, string>> {
    if (!(subscription instanceof WebBackendSubscription)) {
      throw contractError('ownership.denied', 'gatt', 'web-gatt.unsubscribe.subscription')
    }
    const managed = this.subscriptions.get(String(subscription.subscriptionId))
    if (
      managed === undefined ||
      !subscription.isManagedBy(managed) ||
      characteristicKey(managed.path) !== characteristicKey(subscription.path)
    ) {
      throw contractError('gatt.stale-handle', 'gatt', 'web-gatt.unsubscribe')
    }
    const cleanup = await this.removeManagedSubscription(managed)
    if (cleanup.state === 'release-failed') {
      throw contractError('gatt.subscribe-failed', 'gatt', 'web-gatt.unsubscribe')
    }
    return terminalRecord(operation.correlation)
  }

  private requireCharacteristic(
    database: WebGattDatabase,
    path: CharacteristicPath<string, string, string, string, string>,
    operation: string
  ): WebBluetoothCharacteristicBoundary {
    database.assertPath(path, operation)
    if (!database.record.grantedServices.has(String(path.serviceUuid))) {
      throw contractError('chooser.optional-service-not-granted', 'chooser', operation)
    }
    const characteristic = database.characteristicBoundaries.get(characteristicKey(path))
    if (characteristic === undefined) {
      throw this.host.staleGattError(operation)
    }
    return characteristic
  }

  private requireDescriptor(
    database: WebGattDatabase,
    path: DescriptorPath<string, string, string, string, string, string>,
    operation: string
  ): WebBluetoothDescriptorBoundary {
    this.requireCharacteristic(database, path, operation)
    const descriptor = database.descriptorBoundaries.get(descriptorKey(path))
    if (descriptor === undefined) {
      throw this.host.staleGattError(operation)
    }
    return descriptor
  }

  private dispatch<Result>(
    operation: OperationOptions<string, string>,
    start: (operation: OperationOptions<string, string>) => Promise<Result>
  ): BackendOperationDispatch<string, Result> {
    const handle = this.host.identifiers().backendOperationHandle(`web-operation-${this.nextOperation}`)
    this.nextOperation += 1
    const settlement = createOperationSettlementCoordinator<string, Result>(handle)
    const controller = new AbortController()
    let terminal = false
    let acknowledgement: CancellationAcknowledgement<string> | null = null
    const abortFromCaller = () => {
      controller.abort()
    }
    if (operation.signal?.aborted === true) {
      controller.abort()
    } else {
      operation.signal?.addEventListener('abort', abortFromCaller, { once: true })
    }
    const completion = start({ ...operation, signal: controller.signal }).then(
      result => {
        terminal = true
        operation.signal?.removeEventListener('abort', abortFromCaller)
        return settlement.complete(result)
      },
      error => {
        terminal = true
        operation.signal?.removeEventListener('abort', abortFromCaller)
        throw error
      }
    )
    return createBackendOperationDispatch(handle, completion, async () => {
      if (acknowledgement !== null) {
        return acknowledgement
      }
      if (terminal) {
        acknowledgement = settlement.acknowledgeCancellation('already-terminal')
        return acknowledgement
      }
      controller.abort()
      acknowledgement = settlement.acknowledgeCancellation('cancellation-requested')
      return acknowledgement
    })
  }

  private operationCorrelation(label: string) {
    const correlation = this.host.identifiers().operationCorrelation(`${label}-${this.nextOperation}`)
    this.nextOperation += 1
    return correlation
  }
}

function terminalRecord(
  correlation: OperationOptions<string, string>['correlation']
): OperationTerminalRecord<string, string> {
  return { correlation, outcome: 'succeeded', cause: null }
}

function terminalWriteReceipt(
  correlation: OperationOptions<string, string>['correlation'],
  commitState: WriteReceipt<string, string>['commitState']
): WriteReceipt<string, string> {
  return { terminal: terminalRecord(correlation), commitState }
}
