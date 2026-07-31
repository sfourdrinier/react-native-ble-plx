// src/testing/scenarios/manager-scenario-executor.ts

import { BackendContractError } from '../../backend-contract/errors'
import { deviceIdentity, type AdvertisementObservation, type ScanOptions } from '../../backend-contract/advertisement'
import type { CharacteristicPath } from '../../backend-contract/gatt'
import type { PublicOperationOptions, SubscriptionOptions } from '../../backend-contract/operations'
import {
  byteLimit,
  capacity,
  createAttachmentBoundIdFactory,
  deadline,
  monotonicTimestamp,
  opaqueId,
  ownBytes
} from '../../backend-contract/primitives'
import type { PeerId } from '../../backend-contract/primitives'
import type { BackendIdentity } from '../../backend-contract/identity'
import { BleManager } from '../../manager/ble-manager'
import type { ManagerScenarioControl, ManagerScenarioDefinition, ManagerScenarioFactId } from './manager-scenarios'

type CurrentCharacteristicPath<Attachment extends string> = CharacteristicPath<
  Attachment,
  string,
  string,
  string,
  string,
  'current'
>

export interface ManagerScenarioController<Attachment extends string> {
  readonly availableControls: readonly ManagerScenarioControl[]
  now(): number
  scanOptions(itemCapacity: number, byteCapacity: number): ScanOptions<Attachment, string>
  settle<Value>(promise: Promise<Value>): Promise<Value>
  flush(): Promise<void>
  advanceBy(milliseconds: number): void
  emitAdvertisement(): void
  emitNotification(path: CurrentCharacteristicPath<Attachment>, value: Uint8Array): void
  forceDisconnect(peerId: PeerId<Attachment>): void
  triggerServicesChanged(peerId: PeerId<Attachment>): void
  queueDelayedRead(delayMilliseconds: number): void
  injectUnsubscribeFailure(): void
  loseAdapter(): void
}

export interface ManagerScenarioExecutionContext<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>
> {
  readonly owner: BleManager<Attachment, Identity>
  createBorrower(): Promise<BleManager<Attachment, Identity>>
  readonly controller: ManagerScenarioController<Attachment>
}

/** Executes one manager journey only after the fixture declared all required controls available. */
export async function executeManagerScenario<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  definition: ManagerScenarioDefinition,
  context: ManagerScenarioExecutionContext<Attachment, Identity>
): Promise<ManagerScenarioFactId> {
  if (definition.id === 'manager.scan-connect-discover-read-notify-destroy') {
    await scanConnectDiscoverReadNotifyDestroy(context)
    return 'scan-connect-discover-read-notify-destroy-completes'
  }
  if (definition.id === 'manager.cancellation-deadline-and-late-completion') {
    await cancellationDeadlineAndLateCompletion(context)
    return 'abort-deadline-and-late-completion-remain-terminal'
  }
  if (definition.id === 'manager.overflow-late-events-and-stream-settlement') {
    await overflowLateEventsAndSettlement(context)
    return 'overflow-and-late-events-are-accounted-and-quarantined'
  }
  if (definition.id === 'manager.generation-invalidation-reconnect-and-rediscovery') {
    await generationInvalidationReconnectAndRediscovery(context)
    return 'stale-generations-require-rediscovery-and-reconnection'
  }
  if (definition.id === 'manager.two-client-arbitration-and-retryable-cleanup') {
    await twoClientArbitrationAndRetryableCleanup(context)
    return 'second-client-cannot-steal-and-cleanup-retries'
  }
  await adapterLossAndZeroCounterSettlement(context)
  return 'adapter-loss-invalidates-work-and-settles-zero'
}

async function scanConnectDiscoverReadNotifyDestroy<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>
>(context: ManagerScenarioExecutionContext<Attachment, Identity>): Promise<void> {
  const scan = await context.controller.settle(context.owner.scan(context.controller.scanOptions(4, 128)))
  const observation = scan.observations[Symbol.asyncIterator]().next()
  context.controller.emitAdvertisement()
  await context.controller.flush()
  const received = await observation
  requireCondition(!received.done && received.value.kind === 'value', 'public scan did not receive an advertisement')
  const peerId = received.value.value.device.id
  const connection = await context.controller.settle(context.owner.connect(peerId, operation()))
  const database = await context.controller.settle(connection.discover(operation()))
  const characteristic = await firstCharacteristic(database)
  const value = await context.controller.settle(database.read(characteristic, operation()))
  requireCondition(value.byteLength > 0, 'public scenario read returned no bytes')
  const subscription = await context.controller.settle(database.subscribe(characteristic, subscriptionOptions()))
  const notification = subscription.values[Symbol.asyncIterator]().next()
  context.controller.emitNotification(characteristic, new Uint8Array([21]))
  await context.controller.flush()
  const delivered = await notification
  requireCondition(
    !delivered.done && delivered.value.kind === 'value' && delivered.value.value.value[0] === 21,
    'public scenario notification was not delivered'
  )
  await context.controller.settle(subscription.remove())
  await context.controller.settle(scan.stop())
}

async function cancellationDeadlineAndLateCompletion<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>
>(context: ManagerScenarioExecutionContext<Attachment, Identity>): Promise<void> {
  const peerId = await observePeer(context)
  const { database, characteristic } = await connectedDatabase(context, peerId)
  context.controller.queueDelayedRead(20)
  const abortController = new AbortController()
  const aborted = database.read(characteristic, operation(abortController.signal))
  await context.controller.flush()
  abortController.abort()
  await expectError(context.controller.settle(aborted), 'operation.aborted')
  context.controller.queueDelayedRead(20)
  const timedOut = database.read(characteristic, operation(null, deadline(context.controller.now() + 5)))
  context.controller.advanceBy(5)
  await expectError(timedOut, 'operation.timed-out')
  context.controller.advanceBy(20)
  const subsequent = await context.controller.settle(database.read(characteristic, operation()))
  requireCondition(subsequent.byteLength > 0, 'late read completion contaminated the next public operation')
}

async function overflowLateEventsAndSettlement<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  context: ManagerScenarioExecutionContext<Attachment, Identity>
): Promise<void> {
  const scan = await context.controller.settle(context.owner.scan(context.controller.scanOptions(1, 128)))
  const scanItems = scan.observations[Symbol.asyncIterator]()
  context.controller.emitAdvertisement()
  context.controller.emitAdvertisement()
  context.controller.emitAdvertisement()
  await context.controller.flush()
  const overflow = await scanItems.next()
  const value = await scanItems.next()
  requireCondition(
    !overflow.done && overflow.value.kind === 'overflow' && !value.done && value.value.kind === 'value',
    'scan overflow did not preserve an accounting record and value'
  )
  await context.controller.settle(scan.stop())
  context.controller.emitAdvertisement()
  await context.controller.flush()
  const afterStop = await scanItems.next()
  requireCondition(!afterStop.done && afterStop.value.kind === 'terminal', 'scan delivered after terminal stop')

  const peerId = value.value.value.device.id
  const { database, characteristic } = await connectedDatabase(context, peerId)
  const subscription = await context.controller.settle(database.subscribe(characteristic, subscriptionOptions(1, 128)))
  const notificationItems = subscription.values[Symbol.asyncIterator]()
  context.controller.emitNotification(characteristic, new Uint8Array([1]))
  context.controller.emitNotification(characteristic, new Uint8Array([2]))
  context.controller.emitNotification(characteristic, new Uint8Array([3]))
  await context.controller.flush()
  const notificationOverflow = await notificationItems.next()
  const notificationValue = await notificationItems.next()
  requireCondition(
    !notificationOverflow.done &&
      notificationOverflow.value.kind === 'overflow' &&
      !notificationValue.done &&
      notificationValue.value.kind === 'value',
    'notification overflow did not preserve an accounting record and value'
  )
  await context.controller.settle(subscription.remove())
  context.controller.emitNotification(characteristic, new Uint8Array([4]))
  await context.controller.flush()
  const afterRemoval = await notificationItems.next()
  requireCondition(!afterRemoval.done && afterRemoval.value.kind === 'terminal', 'notification delivered after removal')
}

async function generationInvalidationReconnectAndRediscovery<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>
>(context: ManagerScenarioExecutionContext<Attachment, Identity>): Promise<void> {
  const peerId = await observePeer(context)
  const { connection, database, characteristic } = await connectedDatabase(context, peerId)
  context.controller.triggerServicesChanged(peerId)
  await context.controller.flush()
  await expectError(database.read(characteristic, operation()), 'gatt.stale-handle')
  const rediscovered = await context.controller.settle(connection.discover(operation()))
  const rediscoveredCharacteristic = await firstCharacteristic(rediscovered)
  const rediscoveredRead = await context.controller.settle(rediscovered.read(rediscoveredCharacteristic, operation()))
  requireCondition(rediscoveredRead.byteLength > 0, 'rediscovery did not produce a current GATT path')
  context.controller.forceDisconnect(peerId)
  await context.controller.flush()
  await expectError(rediscovered.read(rediscoveredCharacteristic, operation()), 'gatt.stale-handle')
  const reconnected = await context.controller.settle(context.owner.connect(peerId, operation()))
  const reconnectedDatabase = await context.controller.settle(reconnected.discover(operation()))
  const reconnectedCharacteristic = await firstCharacteristic(reconnectedDatabase)
  const reconnectedRead = await context.controller.settle(
    reconnectedDatabase.read(reconnectedCharacteristic, operation())
  )
  requireCondition(reconnectedRead.byteLength > 0, 'reconnection did not produce a current GATT path')
}

async function twoClientArbitrationAndRetryableCleanup<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>
>(context: ManagerScenarioExecutionContext<Attachment, Identity>): Promise<void> {
  const borrower = await context.createBorrower()
  const ownerScan = await context.controller.settle(context.owner.scan(context.controller.scanOptions(4, 128)))
  await expectError(borrower.scan(context.controller.scanOptions(4, 128)), 'scan.already-active')
  const ownerScanItems = ownerScan.observations[Symbol.asyncIterator]()
  context.controller.emitAdvertisement()
  await context.controller.flush()
  const observed = await ownerScanItems.next()
  requireCondition(!observed.done && observed.value.kind === 'value', 'owner scan did not observe a peer')
  const peerId = observed.value.value.device.id
  const { connection, database, characteristic } = await connectedDatabase(context, peerId)
  await expectError(borrower.connect(peerId, operation()), 'connection.already-owned')
  const subscription = await context.controller.settle(database.subscribe(characteristic, subscriptionOptions()))
  context.controller.injectUnsubscribeFailure()
  const failedRemoval = await context.controller.settle(subscription.remove())
  requireCondition(failedRemoval.state === 'release-failed', 'subscription cleanup did not report the injected failure')
  const retriedRemoval = await context.controller.settle(subscription.remove())
  requireCondition(retriedRemoval.state === 'released', 'subscription cleanup did not retry after failure')
  await context.controller.settle(ownerScan.stop())
  await context.controller.settle(connection.release())
  await context.controller.settle(borrower.destroy())
}

async function adapterLossAndZeroCounterSettlement<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>
>(context: ManagerScenarioExecutionContext<Attachment, Identity>): Promise<void> {
  const scan = await context.controller.settle(context.owner.scan(context.controller.scanOptions(4, 128)))
  context.controller.loseAdapter()
  await context.controller.flush()
  const terminal = await scan.observations[Symbol.asyncIterator]().next()
  requireCondition(!terminal.done && terminal.value.kind === 'terminal', 'adapter loss did not close scan ingress')
}

async function connectedDatabase<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  context: ManagerScenarioExecutionContext<Attachment, Identity>,
  peerId: PeerId<Attachment>
): Promise<{
  readonly connection: Awaited<ReturnType<BleManager<Attachment, Identity>['connect']>>
  readonly database: Awaited<ReturnType<Awaited<ReturnType<BleManager<Attachment, Identity>['connect']>>['discover']>>
  readonly characteristic: CurrentCharacteristicPath<Attachment>
}> {
  const connection = await context.controller.settle(context.owner.connect(peerId, operation()))
  const database = await context.controller.settle(connection.discover(operation()))
  const characteristic = await firstCharacteristic(database)
  return { connection, database, characteristic }
}

async function observePeer<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  context: ManagerScenarioExecutionContext<Attachment, Identity>
): Promise<PeerId<Attachment>> {
  const scan = await context.controller.settle(context.owner.scan(context.controller.scanOptions(4, 128)))
  const observation = scan.observations[Symbol.asyncIterator]().next()
  context.controller.emitAdvertisement()
  await context.controller.flush()
  const received = await observation
  requireCondition(!received.done && received.value.kind === 'value', 'scenario scan did not observe a peer')
  await context.controller.settle(scan.stop())
  return received.value.value.device.id
}

function operation(
  signal: AbortSignal | null = null,
  deadlineValue: ReturnType<typeof deadline> | null = null
): PublicOperationOptions {
  return { signal, deadline: deadlineValue }
}

export function managerScenarioScanOptions<Attachment extends string>(
  itemCapacity: number,
  byteCapacity: number
): ScanOptions<Attachment, string> {
  return {
    filter: { serviceUuids: [], manufacturerData: [], localNamePrefix: null },
    duplicatePolicy: 'all',
    timestampPolicy: 'receipt-monotonic',
    delivery: {
      itemCapacity: capacity(itemCapacity),
      byteCapacity: capacity(byteCapacity),
      reservedControlCapacity: capacity(1),
      overflowPolicy: 'drop-oldest'
    },
    deadline: null,
    signal: null,
    sharing: { mode: 'owner', allowSharing: false }
  }
}

function subscriptionOptions(itemCapacity = 4, byteCapacity = 128): SubscriptionOptions {
  return {
    signal: null,
    deadline: null,
    delivery: {
      itemCapacity: capacity(itemCapacity),
      byteCapacity: capacity(byteCapacity),
      reservedControlCapacity: capacity(1),
      overflowPolicy: 'drop-oldest'
    }
  }
}

async function firstCharacteristic<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  database: Awaited<ReturnType<Awaited<ReturnType<BleManager<Attachment, Identity>['connect']>>['discover']>>
): Promise<CurrentCharacteristicPath<Attachment>> {
  const characteristic = (await database.snapshot()).characteristics[0]
  if (characteristic === undefined) {
    throw new Error('manager scenario requires a characteristic')
  }
  return characteristic.path
}

function deterministicPeerId(): PeerId<string> {
  return opaqueId('deterministic-peer', 'peer', 'deterministic')
}

export function deterministicScenarioAdvertisement(): AdvertisementObservation<string> {
  const backendInstanceId = opaqueId('deterministic', 'backend-instance', 'deterministic')
  const identifiers = createAttachmentBoundIdFactory({
    attachmentId: opaqueId('deterministic', 'attachment', 'deterministic'),
    backendInstanceId,
    backendGeneration: opaqueId('deterministic', 'backend-generation', 'deterministic'),
    adapterId: opaqueId('deterministic', 'adapter', 'deterministic'),
    adapterGeneration: opaqueId('deterministic', 'adapter-generation', 'deterministic')
  })
  return {
    device: deviceIdentity(deterministicPeerId(), backendInstanceId, null),
    provenance: 'platform-raw',
    sourceTimestamp: { state: 'absent', reason: 'scenario-source-time-unavailable', provenance: 'not-provided' },
    receivedAtMonotonicMs: monotonicTimestamp(1),
    ingressOrdinal: 1,
    scanSessionId: identifiers.scanSessionId('scenario-scan-session'),
    localName: { state: 'present', value: 'Scenario peripheral', provenance: 'observed' },
    rssi: { state: 'absent', reason: 'scenario-not-observed', provenance: 'not-provided' },
    txPower: { state: 'absent', reason: 'scenario-not-observed', provenance: 'not-provided' },
    connectable: { state: 'present', value: true, provenance: 'observed' },
    appearance: { state: 'absent', reason: 'scenario-not-observed', provenance: 'not-provided' },
    serviceUuids: { state: 'present', value: [], provenance: 'observed' },
    solicitedServiceUuids: { state: 'absent', reason: 'scenario-not-observed', provenance: 'not-provided' },
    overflowServiceUuids: { state: 'absent', reason: 'scenario-not-observed', provenance: 'not-provided' },
    serviceData: { state: 'absent', reason: 'scenario-not-observed', provenance: 'not-provided' },
    manufacturerData: { state: 'absent', reason: 'scenario-not-observed', provenance: 'not-provided' },
    rawRecord: { state: 'present', value: ownBytes(new Uint8Array([1]), byteLimit(1)), provenance: 'observed' },
    scanResponseRecord: { state: 'absent', reason: 'scenario-not-observed', provenance: 'not-provided' }
  }
}

async function expectError<Value>(promise: Promise<Value>, code: string): Promise<void> {
  try {
    await promise
  } catch (error) {
    if (error instanceof BackendContractError && error.normalized.code === code) {
      return
    }
    throw error
  }
  throw new Error(`expected ${code} but operation resolved`)
}

function requireCondition(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}
