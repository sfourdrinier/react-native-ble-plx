// src/backends/winrt/winrt-backend-helpers.ts

import type { BackendEvent } from '../../backend-contract/backend'
import type { ResourceCounters } from '../../backend-contract/backend'
import { contractError, type CleanupRecord } from '../../backend-contract/errors'
import type { PublicOperationOptions } from '../../backend-contract/operations'
import { CoreBoundedStream } from '../../core/bounded-stream'
import { resourceCount } from '../../backend-contract/primitives'
import { releasedCleanup } from './winrt-handles'

export function combineWinRtCleanup(left: CleanupRecord, right: CleanupRecord): CleanupRecord {
  if (left.state === 'released' && right.state === 'released') {
    return releasedCleanup
  }
  return Object.freeze({ state: 'release-failed', failures: Object.freeze([...left.failures, ...right.failures]) })
}

export function broadcastWinRtEvent(
  streams: ReadonlySet<CoreBoundedStream<BackendEvent<string>>>,
  event: BackendEvent<string>
): void {
  for (const stream of streams) {
    stream.emit(event, 128, event.kind)
  }
}

export function winRtPlatformError(
  code: 'scan.start-failed' | 'connection.failed' | 'gatt.read-failed' | 'gatt.write-failed' | 'gatt.subscribe-failed',
  domain: 'scan' | 'connection' | 'gatt',
  operation: string,
  error: unknown
): Error {
  if (error instanceof Error && 'normalized' in error) {
    return error
  }
  return contractError(code, domain, operation, {
    domain: 'winrt',
    code: 'native-error',
    safeMessage: error instanceof Error ? error.message : 'WinRT boundary rejected with a non-Error value',
    metadata: Object.freeze({})
  })
}

export function assertWinRtOperationAdmission(
  options: PublicOperationOptions,
  now: () => number,
  operation: string
): void {
  if (options.signal?.aborted === true) {
    throw contractError('operation.aborted', 'core', operation)
  }
  if (options.deadline !== null && options.deadline <= now()) {
    throw contractError('operation.timed-out', 'core', operation)
  }
}

interface WinRtCounterConnection {
  readonly lease: object | null
  readonly state: 'connecting' | 'connected' | 'disconnecting' | 'disconnected' | 'lost'
  readonly database: object | null
}

interface WinRtCounterSubscription {
  readonly consumers: ReadonlySet<{ readonly stream: { retainedPayloadBytes(): number } }>
}

export function winRtResourceCounters(
  scanControllers: number,
  scanConsumers: number,
  connections: Iterable<WinRtCounterConnection>,
  subscriptions: Iterable<WinRtCounterSubscription>,
  dispatchedOperations: number
): ResourceCounters {
  let connectionLeases = 0
  let physicalLinks = 0
  let databaseSnapshots = 0
  let physicalCccdEnablements = 0
  let subscriptionConsumers = 0
  let retainedByteBuffers = 0
  for (const connection of connections) {
    connectionLeases += connection.lease === null ? 0 : 1
    physicalLinks += connection.state === 'disconnected' || connection.state === 'lost' ? 0 : 1
    databaseSnapshots += connection.database === null ? 0 : 1
  }
  for (const subscription of subscriptions) {
    physicalCccdEnablements += 1
    subscriptionConsumers += subscription.consumers.size
    for (const consumer of subscription.consumers) {
      retainedByteBuffers += consumer.stream.retainedPayloadBytes()
    }
  }
  return Object.freeze({
    activeScanControllers: resourceCount(scanControllers),
    scanConsumers: resourceCount(scanConsumers),
    chooserSessions: resourceCount(0),
    connectionLeases: resourceCount(connectionLeases),
    physicalLinks: resourceCount(physicalLinks),
    databaseSnapshots: resourceCount(databaseSnapshots),
    physicalCccdEnablements: resourceCount(physicalCccdEnablements),
    subscriptionConsumers: resourceCount(subscriptionConsumers),
    queuedOperations: resourceCount(0),
    dispatchedOperations: resourceCount(dispatchedOperations),
    retainedByteBuffers: resourceCount(retainedByteBuffers),
    restorationRecords: resourceCount(0),
    orphanedIpcOwners: resourceCount(0)
  })
}
