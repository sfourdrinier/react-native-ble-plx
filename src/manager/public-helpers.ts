// src/manager/public-helpers.ts

import type { AdvertisementObservation, ScanOptions } from '../backend-contract/advertisement'
import { contractError, type CleanupRecord } from '../backend-contract/errors'
import type { BackendIdentity } from '../backend-contract/identity'
import type { CharacteristicPath, NotificationValue } from '../backend-contract/gatt'
import type { PublicOperationOptions, SubscriptionOptions } from '../backend-contract/operations'
import type { OwnedBytes, PeerId } from '../backend-contract/primitives'
import type { BoundedAsyncStream, StreamItem, StreamTerminalNotice } from '../backend-contract/streams'
import { BleManager, Connection, DiscoveredGattDatabase } from './ble-manager'

type CurrentCharacteristicPath<Attachment extends string> = CharacteristicPath<
  Attachment,
  string,
  string,
  string,
  string,
  'current'
>

interface Successful<Value> {
  readonly state: 'succeeded'
  readonly value: Value
}

interface Failed {
  readonly state: 'failed'
  readonly error: unknown
}

type OperationOutcome<Value> = Successful<Value> | Failed

interface DeadlineHandle {
  cancel(): void
}

interface DeadlineClock {
  monotonicNow(): number
  scheduleDeadline(deadline: number, action: () => void): DeadlineHandle
}

/** The exact public scan request and observation predicate used by find and scanUntil. */
export interface ScanUntilOptions<Attachment extends string> {
  readonly scan: ScanOptions<Attachment, string>
  readonly matches: (observation: AdvertisementObservation<Attachment>) => boolean
}

/** A discovered, generation-bound GATT database that remains owned by its returned connection. */
export interface ConnectedGattDatabase<Attachment extends string, Identity extends BackendIdentity<Attachment>> {
  readonly connection: Connection<Attachment, Identity>
  readonly database: DiscoveredGattDatabase<Attachment, Identity>
  readonly snapshot: Awaited<ReturnType<DiscoveredGattDatabase<Attachment, Identity>['snapshot']>>
}

/** Bounded collection configuration for collectNotifications. */
export interface CollectNotificationsOptions {
  readonly subscription: SubscriptionOptions
  readonly maximumValues: number
}

/**
 * Scans until a caller-owned predicate accepts an observation. The exact scan
 * request, including active AbortSignal and deadline behavior, is forwarded
 * unchanged to the public manager.
 */
export async function scanUntil<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  manager: BleManager<Attachment, Identity>,
  options: ScanUntilOptions<Attachment>
): Promise<AdvertisementObservation<Attachment>> {
  const session = await manager.scan(options.scan)
  return settleWithCleanup(
    () => withStreamIterator(session.observations, iterator => nextMatchingObservation(iterator, options, manager)),
    () => session.stop(),
    'helpers.scan-until.stop'
  )
}

/** Alias for scanUntil that keeps the public vocabulary compact. */
export function find<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  manager: BleManager<Attachment, Identity>,
  options: ScanUntilOptions<Attachment>
): Promise<AdvertisementObservation<Attachment>> {
  return scanUntil(manager, options)
}

/** Connects and discovers through the public handles, releasing a partial connection if discovery fails. */
export async function connectAndDiscover<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  manager: BleManager<Attachment, Identity>,
  peerId: PeerId<Attachment>,
  options: PublicOperationOptions
): Promise<ConnectedGattDatabase<Attachment, Identity>> {
  const connection = await manager.connect(peerId, options)
  return settleWithCleanup(
    async () => {
      const database = await connection.discover(options)
      const snapshot = await database.snapshot()
      return Object.freeze({ connection, database, snapshot })
    },
    () => connection.release(),
    'helpers.connect-and-discover.release',
    false
  )
}

/** Resolves the first notification value and removes the subscription before returning. */
export async function firstNotification<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  database: DiscoveredGattDatabase<Attachment, Identity>,
  path: CurrentCharacteristicPath<Attachment>,
  options: SubscriptionOptions
): Promise<OwnedBytes> {
  const subscription = await database.subscribe(path, options)
  return settleWithCleanup(
    () =>
      withStreamIterator(subscription.values, async iterator =>
        notificationValue(
          await nextStreamItem(iterator, options, 'helpers.first-notification', database),
          options,
          database
        )
      ),
    () => subscription.remove(),
    'helpers.first-notification.remove'
  )
}

/** Collects no more than maximumValues notification payloads, then removes the subscription. */
export async function collectNotifications<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  database: DiscoveredGattDatabase<Attachment, Identity>,
  path: CurrentCharacteristicPath<Attachment>,
  options: CollectNotificationsOptions
): Promise<readonly OwnedBytes[]> {
  assertCollectionBound(options.maximumValues)
  const subscription = await database.subscribe(path, options.subscription)
  return settleWithCleanup(
    () => withStreamIterator(subscription.values, iterator => collectSubscriptionValues(iterator, options, database)),
    () => subscription.remove(),
    'helpers.collect-notifications.remove'
  )
}

/** Runs an operation with one connection lease and deterministically releases that lease on every exit. */
export async function withConnection<Attachment extends string, Identity extends BackendIdentity<Attachment>, Value>(
  manager: BleManager<Attachment, Identity>,
  peerId: PeerId<Attachment>,
  options: PublicOperationOptions,
  operation: (connection: Connection<Attachment, Identity>) => Promise<Value>
): Promise<Value> {
  const connection = await manager.connect(peerId, options)
  return settleWithCleanup(
    () => operation(connection),
    () => connection.release(),
    'helpers.with-connection.release'
  )
}

async function nextMatchingObservation<Attachment extends string>(
  iterator: AsyncIterator<StreamItem<AdvertisementObservation<Attachment>>>,
  options: ScanUntilOptions<Attachment>,
  clock: DeadlineClock
): Promise<AdvertisementObservation<Attachment>> {
  while (true) {
    const item = await nextStreamItem(iterator, options.scan, 'helpers.scan-until', clock)
    if (item.kind === 'value' && options.matches(item.value)) {
      return item.value
    }
    if (item.kind === 'terminal') {
      throw streamTerminalError(item, options.scan, 'helpers.scan-until', clock)
    }
    if (item.kind === 'overflow') {
      throw contractError('stream.overflow', 'stream', 'helpers.scan-until.overflow')
    }
  }
}

async function collectSubscriptionValues(
  iterator: AsyncIterator<StreamItem<NotificationValue>>,
  options: CollectNotificationsOptions,
  clock: DeadlineClock
): Promise<readonly OwnedBytes[]> {
  const values: OwnedBytes[] = []
  for (let index = 0; index < options.maximumValues; index += 1) {
    const item = await nextStreamItem(iterator, options.subscription, 'helpers.collect-notifications', clock)
    values.push(notificationValue(item, options.subscription, clock))
  }
  return Object.freeze(values)
}

async function nextStreamItem<Value>(
  iterator: AsyncIterator<StreamItem<Value>>,
  options: PublicOperationOptions,
  operation: string,
  clock: DeadlineClock
): Promise<StreamItem<Value>> {
  if (options.signal?.aborted === true) {
    throw contractError('operation.aborted', 'stream', operation)
  }
  if (options.deadline !== null && options.deadline <= clock.monotonicNow()) {
    throw contractError('operation.timed-out', 'stream', operation)
  }
  return waitForStreamItem(iterator.next(), options, operation, clock)
}

function waitForStreamItem<Value>(
  next: Promise<IteratorResult<StreamItem<Value>>>,
  options: PublicOperationOptions,
  operation: string,
  clock: DeadlineClock
): Promise<StreamItem<Value>> {
  return new Promise((resolve, reject) => {
    let settled = false
    let deadlineHandle: DeadlineHandle | null = null
    const signal = options.signal
    const releaseWait = (): boolean => {
      if (settled) {
        return false
      }
      settled = true
      if (signal !== null) {
        signal.removeEventListener('abort', onAbort)
      }
      if (deadlineHandle !== null) {
        deadlineHandle.cancel()
        deadlineHandle = null
      }
      return true
    }
    const onAbort = () => {
      if (releaseWait()) {
        reject(contractError('operation.aborted', 'stream', operation))
      }
    }
    if (signal !== null) {
      signal.addEventListener('abort', onAbort, { once: true })
    }
    if (options.deadline !== null) {
      deadlineHandle = clock.scheduleDeadline(options.deadline, () => {
        if (releaseWait()) {
          reject(contractError('operation.timed-out', 'stream', operation))
        }
      })
    }
    next
      .then(result => {
        if (signal?.aborted === true || (options.deadline !== null && options.deadline <= clock.monotonicNow())) {
          if (releaseWait()) {
            reject(
              contractError(signal?.aborted === true ? 'operation.aborted' : 'operation.timed-out', 'stream', operation)
            )
          }
          return
        }
        if (releaseWait()) {
          resolve(requireStreamItem(result, operation))
        }
      })
      .catch(error => {
        if (releaseWait()) {
          reject(error)
        }
      })
  })
}

function requireStreamItem<Value>(result: IteratorResult<StreamItem<Value>>, operation: string): StreamItem<Value> {
  if (!result.done) {
    return result.value
  }
  throw contractError('stream.closed', 'stream', operation)
}

async function withStreamIterator<Value, Result>(
  stream: BoundedAsyncStream<Value>,
  operation: (iterator: AsyncIterator<StreamItem<Value>>) => Promise<Result>
): Promise<Result> {
  const iterator = stream[Symbol.asyncIterator]()
  const outcome = await capture(() => operation(iterator))
  const iteratorCleanup = await capture(() => closeIterator(iterator))
  if (outcome.state === 'failed' && iteratorCleanup.state === 'failed') {
    throw new AggregateError(
      [outcome.error, iteratorCleanup.error],
      'helpers.stream-iterator: operation and iterator cleanup failed'
    )
  }
  if (outcome.state === 'failed') {
    throw outcome.error
  }
  if (iteratorCleanup.state === 'failed') {
    throw iteratorCleanup.error
  }
  return outcome.value
}

async function closeIterator<Value>(iterator: AsyncIterator<Value>): Promise<void> {
  if (iterator.return !== undefined) {
    await iterator.return()
  }
}

function notificationValue(
  item: StreamItem<NotificationValue>,
  options: PublicOperationOptions,
  clock: DeadlineClock
): OwnedBytes {
  if (item.kind === 'value') {
    return item.value.value
  }
  if (item.kind === 'terminal') {
    throw streamTerminalError(item, options, 'helpers.notification', clock)
  }
  throw contractError('stream.overflow', 'stream', 'helpers.notification.overflow')
}

function streamTerminalError(
  terminal: StreamTerminalNotice,
  options: PublicOperationOptions | null,
  operation: string,
  clock: DeadlineClock
) {
  if (terminal.reason === 'overflow') {
    return contractError('stream.overflow', 'stream', operation)
  }
  if (terminal.reason === 'connection-lost') {
    return contractError('connection.lost', 'connection', operation)
  }
  if (terminal.reason === 'operation-aborted' || options?.signal?.aborted === true) {
    return contractError('operation.aborted', 'stream', operation)
  }
  if (
    terminal.reason === 'operation-timed-out' ||
    (options?.deadline !== null && options?.deadline !== undefined && options.deadline <= clock.monotonicNow())
  ) {
    return contractError('operation.timed-out', 'stream', operation)
  }
  if (terminal.reason === 'owner-released') {
    return contractError('lifecycle.destroyed', 'stream', operation)
  }
  return contractError('stream.closed', 'stream', operation)
}

function assertCollectionBound(maximumValues: number): void {
  if (!Number.isSafeInteger(maximumValues) || maximumValues < 1) {
    throw contractError('argument.invalid', 'stream', 'helpers.collect-notifications.maximum-values')
  }
}

async function settleWithCleanup<Value>(
  operation: () => Promise<Value>,
  cleanup: () => Promise<CleanupRecord>,
  cleanupOperation: string,
  releaseOnSuccess = true
): Promise<Value> {
  const outcome = await capture(operation)
  if (outcome.state === 'succeeded' && !releaseOnSuccess) {
    return outcome.value
  }
  const cleanupOutcome = await captureCleanup(cleanup, cleanupOperation)
  if (outcome.state === 'failed' && cleanupOutcome !== null) {
    throw new AggregateError([outcome.error, cleanupOutcome], `${cleanupOperation}: operation and cleanup failed`)
  }
  if (outcome.state === 'failed') {
    throw outcome.error
  }
  if (cleanupOutcome !== null) {
    throw cleanupOutcome
  }
  return outcome.value
}

async function capture<Value>(operation: () => Promise<Value>): Promise<OperationOutcome<Value>> {
  try {
    return { state: 'succeeded', value: await operation() }
  } catch (error) {
    return { state: 'failed', error }
  }
}

async function captureCleanup(cleanup: () => Promise<CleanupRecord>, operation: string): Promise<Error | null> {
  try {
    const record = await cleanup()
    if (record.state === 'released' && record.failures.length === 0) {
      return null
    }
    return contractError('platform.failure', 'cleanup', operation)
  } catch (error) {
    if (error instanceof Error) {
      return error
    }
    return contractError('platform.failure', 'cleanup', operation)
  }
}
