// src/testing/deterministic/deterministic-test-backend-lifecycle-helpers.ts

import { BackendContractError, contractError } from '../../backend-contract/errors'
import type { CleanupRecord } from '../../backend-contract/errors'
import type { ResourceCounters } from '../../backend-contract/backend'
import { resourceCount } from '../../backend-contract/primitives'
import type { CharacteristicPath, ConnectionPath, DatabasePath, DescriptorPath } from '../../backend-contract/gatt'
import type { AttachmentRecord } from '../../backend-contract/identity'
import type { HostNeutralBackendIdentity } from '../../backend-contract/identity'
import { negotiateCoreVersions, version, versionRange } from '../../backend-contract/primitives'
import type { AttachmentBoundIdFactory } from '../../backend-contract/primitives'
import type {
  ConnectionRecord,
  DeterministicGattDatabase,
  DeterministicConnectionLease,
  PhysicalSubscription
} from './deterministic-test-backend-handles'
import type { DeterministicBoundedStream } from './deterministic-stream'
import type { ScanGroup } from './deterministic-backend-base'
import type { ScanConsumer } from './deterministic-backend-base'
import type { DeterministicOperationRuntimeSnapshot } from './deterministic-operation-runtime'
import { DeterministicScanLease } from './deterministic-test-backend-handles'
import { databaseKey } from './deterministic-test-backend-handles'
import type { DeterministicTestBackend } from './deterministic-test-backend'
import type { OwnerScanOptions } from '../../backend-contract/advertisement'
import type { SubscriptionOptions } from '../../backend-contract/operations'
import { databasePathsEqual } from '../../core/gatt-path-equality'

export function connectionPathForRecord(
  record: ConnectionRecord,
  attachment: AttachmentRecord<string>
): ConnectionPath<string, string> {
  if (record.ownerLeaseId === null) {
    throw contractError('lifecycle.invariant-violation', 'connection', 'connection.loss-owner-lease')
  }
  return {
    attachment,
    attachmentId: attachment.attachmentId,
    peerId: record.peerId,
    connectionId: record.connectionId,
    ownerLeaseId: record.ownerLeaseId,
    connectionGeneration: record.generation
  }
}

export function assertRecordCurrent(record: ConnectionRecord, operation: string): void {
  if (!record.active) {
    throw contractError('operation.disconnected', 'connection', operation)
  }
}

export function removeConnectionLease(
  record: ConnectionRecord,
  lease: DeterministicConnectionLease<string, string>
): void {
  record.leases.delete(lease)
  if (record.ownerLeaseId !== lease.leaseId) {
    return
  }
  const nextLease = record.leases.values().next().value
  record.ownerLeaseId = nextLease === undefined ? null : nextLease.leaseId
}

export function matchesDatabasePath(
  candidate:
    | CharacteristicPath<string, string, string, string, string>
    | DescriptorPath<string, string, string, string, string, string>,
  database: DatabasePath<string, string, string>
): boolean {
  return databasePathsEqual(candidate, database)
}

export function requireCurrentDeterministicDatabase(
  path:
    | CharacteristicPath<string, string, string, string, string>
    | DescriptorPath<string, string, string, string, string, string>,
  databases: ReadonlyMap<string, DeterministicGattDatabase>,
  attachment: AttachmentRecord<string>,
  operation: string
): DeterministicGattDatabase {
  if (
    path.validity !== 'current' ||
    String(path.attachment.backendInstanceId) !== String(attachment.backendInstanceId)
  ) {
    throw contractError('gatt.stale-handle', 'gatt', operation)
  }
  const database = databases.get(databaseKey(path))
  if (database === undefined || !database.isCurrent() || !matchesDatabasePath(path, database.path)) {
    throw contractError('gatt.stale-handle', 'gatt', operation)
  }
  return database
}

export function eventRetainedBytes(
  streams: ReadonlySet<DeterministicBoundedStream<import('../../backend-contract/backend').BackendEvent<string>>>
): number {
  let retained = 0
  for (const stream of streams) {
    retained += stream.retainedBytes()
  }
  return retained
}

export async function captureDeterministicCleanup(
  cleanup: Promise<CleanupRecord>,
  resourceKind: string,
  operation: string,
  recordFailure: (operation: string, cause: import('../../backend-contract/errors').BleErrorCode) => void
): Promise<CleanupRecord> {
  try {
    return await cleanup
  } catch (error) {
    const normalized =
      error instanceof BackendContractError
        ? error.normalized
        : contractError('platform.failure', 'cleanup', `deterministic.${operation}`).normalized
    recordFailure(operation, normalized.code)
    return { state: 'release-failed', failures: [{ resourceKind, error: normalized }] }
  }
}

export function countersAreZero(counters: ResourceCounters): boolean {
  return Object.values(counters).every(value => Number(value) === 0)
}

export function invalidateDeterministicConnections(
  connections: ReadonlyMap<string, ConnectionRecord>,
  invalidate: (record: ConnectionRecord) => void
): void {
  for (const record of [...connections.values()]) {
    invalidate(record)
  }
}

export function retainedSubscriptionReservationBytes(
  physicalSubscriptions: ReadonlyMap<string, PhysicalSubscription>
): number {
  let retained = 0
  for (const physical of physicalSubscriptions.values()) {
    for (const subscription of physical.consumers) {
      retained += subscription.stream.reservedBytes()
    }
  }
  return retained
}

export function deterministicResourceCounters(input: {
  readonly scanGroup: ScanGroup | null
  readonly connections: ReadonlyMap<string, ConnectionRecord>
  readonly physicalSubscriptions: ReadonlyMap<string, PhysicalSubscription>
  readonly operation: DeterministicOperationRuntimeSnapshot
  readonly eventStreams: ReadonlySet<
    DeterministicBoundedStream<import('../../backend-contract/backend').BackendEvent<string>>
  >
  readonly retainedOperationBytes: number
}): ResourceCounters {
  let scanConsumers = 0
  let scanBytes = 0
  if (input.scanGroup !== null) {
    scanConsumers = input.scanGroup.consumers.size
    for (const consumer of input.scanGroup.consumers.values()) {
      scanBytes += consumer.stream.retainedBytes()
    }
  }
  let connectionLeases = 0
  let databaseSnapshots = 0
  for (const record of input.connections.values()) {
    connectionLeases += record.leases.size
    databaseSnapshots += record.databases.size
  }
  let subscriptionConsumers = 0
  let subscriptionBytes = 0
  let physicalCccdEnablements = 0
  for (const physical of input.physicalSubscriptions.values()) {
    if (physical.state === 'ready') {
      physicalCccdEnablements += 1
    }
    subscriptionConsumers += physical.consumers.size
    for (const subscription of physical.consumers) {
      subscriptionBytes += subscription.stream.retainedBytes()
    }
  }
  return {
    activeScanControllers: resourceCount(input.scanGroup === null ? 0 : 1),
    scanConsumers: resourceCount(scanConsumers),
    chooserSessions: resourceCount(0),
    connectionLeases: resourceCount(connectionLeases),
    physicalLinks: resourceCount(input.connections.size),
    databaseSnapshots: resourceCount(databaseSnapshots),
    physicalCccdEnablements: resourceCount(physicalCccdEnablements),
    subscriptionConsumers: resourceCount(subscriptionConsumers),
    queuedOperations: resourceCount(input.operation.queued),
    dispatchedOperations: resourceCount(input.operation.dispatched),
    retainedByteBuffers: resourceCount(
      scanBytes + subscriptionBytes + eventRetainedBytes(input.eventStreams) + input.retainedOperationBytes
    ),
    restorationRecords: resourceCount(0),
    orphanedIpcOwners: resourceCount(0)
  }
}

export function createDeterministicScanConsumer<Lease extends string>(input: {
  readonly backend: DeterministicTestBackend
  readonly options: OwnerScanOptions<string, Lease>
  readonly stream: DeterministicBoundedStream<
    import('../../backend-contract/advertisement').AdvertisementObservation<string>
  >
  readonly identifiers: AttachmentBoundIdFactory<string>
  readonly nextScanLease: number
}): {
  readonly consumer: ScanConsumer
  readonly lease: DeterministicScanLease<Lease>
  readonly followingScanLease: number
} {
  const id = `scan-lease-${input.nextScanLease}`
  const leaseId = input.identifiers.leaseId(id)
  const scanSessionId = input.identifiers.scanSessionId(`scan-session-${input.nextScanLease}`)
  const shareToken = input.options.sharing.allowSharing
    ? input.identifiers.scanShareToken(`scan-share-${input.nextScanLease}`)
    : null
  const consumer: ScanConsumer = {
    id,
    scanSessionId,
    leaseId,
    shareToken,
    options: input.options,
    stream: input.stream,
    observedPayloads: new Map(),
    stopped: null,
    activeAbortListener: null,
    activeDeadlineTask: null
  }
  return {
    consumer,
    lease: new DeterministicScanLease(input.backend, consumer),
    followingScanLease: input.nextScanLease + 1
  }
}

export function deterministicBackendIdentity(attachment: AttachmentRecord<string>): HostNeutralBackendIdentity<string> {
  const compatibility = {
    backendContract: versionRange(version('backend-contract', 1), version('backend-contract', 1)),
    capabilitySchema: versionRange(version('capability-schema', 1), version('capability-schema', 1)),
    eventSchema: versionRange(version('event-schema', 1), version('event-schema', 1)),
    traceFormat: versionRange(version('trace-format', 1), version('trace-format', 1))
  }
  return {
    registeredBackendId: 'unified-ble:deterministic-test',
    registeredPlatformId: 'unified-ble:test',
    attachment,
    versions: negotiateCoreVersions(compatibility, compatibility),
    runtime: { hostKind: 'test', implementationVersion: '4.0.0-alpha.5', diagnostics: {} }
  }
}

export function backendSubscriptionCompletionOptions(options: SubscriptionOptions): SubscriptionOptions {
  return { ...options, signal: null, deadline: null }
}

export function broadcastDatabaseChanged(
  attachment: AttachmentRecord<string>,
  database: DatabasePath<string, string, string>,
  ingressOrdinal: number,
  broadcast: (event: import('../../backend-contract/backend').BackendEvent<string>) => void
): number {
  broadcast({
    attachment,
    attachmentId: attachment.attachmentId,
    kind: 'database-changed',
    database,
    ingressOrdinal
  })
  return ingressOrdinal + 1
}
