// src/core/resource-ledger.ts

import { contractError } from '../backend-contract/errors'
import { resourceCount } from '../backend-contract/primitives'
import type { ResourceCounters } from '../backend-contract/backend'
import type { ResourceCount } from '../backend-contract/primitives'

type ResourceCounterName = keyof ResourceCounters

/**
 * Maintains the non-negative resource counters owned by one core attachment.
 * The owner is responsible for changing a counter before publishing the
 * matching resource and before releasing that resource's ownership.
 */
export class ResourceLedger {
  private retainedOperationBytes = 0
  private retainedStreamBytes = 0
  private readonly counts: { [Name in ResourceCounterName]: number } = {
    activeScanControllers: 0,
    scanConsumers: 0,
    chooserSessions: 0,
    connectionLeases: 0,
    physicalLinks: 0,
    databaseSnapshots: 0,
    physicalCccdEnablements: 0,
    subscriptionConsumers: 0,
    queuedOperations: 0,
    dispatchedOperations: 0,
    retainedByteBuffers: 0,
    restorationRecords: 0,
    orphanedIpcOwners: 0
  }

  increment(name: ResourceCounterName): ResourceCount {
    const next = this.counts[name] + 1
    this.counts[name] = next
    return resourceCount(next)
  }

  decrement(name: ResourceCounterName): ResourceCount {
    const current = this.counts[name]
    if (current === 0) {
      throw contractError('lifecycle.invariant-violation', 'core', `resource-ledger.decrement.${name}`)
    }
    const next = current - 1
    this.counts[name] = next
    return resourceCount(next)
  }

  current(name: ResourceCounterName): ResourceCount {
    return resourceCount(this.counts[name])
  }

  set(name: ResourceCounterName, value: number): ResourceCount {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw contractError('argument.invalid', 'core', `resource-ledger.set.${name}`)
    }
    this.counts[name] = value
    return resourceCount(value)
  }

  setRetainedStreamBytes(value: number): ResourceCount {
    this.assertRetainedBytes(value, 'stream')
    this.retainedStreamBytes = value
    return this.syncRetainedBytes()
  }

  retainOperationBytes(value: number): ResourceCount {
    this.assertRetainedBytes(value, 'operation-retain')
    this.retainedOperationBytes += value
    return this.syncRetainedBytes()
  }

  releaseOperationBytes(value: number): ResourceCount {
    this.assertRetainedBytes(value, 'operation-release')
    if (value > this.retainedOperationBytes) {
      throw contractError('lifecycle.invariant-violation', 'core', 'resource-ledger.operation-byte-underflow')
    }
    this.retainedOperationBytes -= value
    return this.syncRetainedBytes()
  }

  snapshot(): ResourceCounters {
    return {
      activeScanControllers: resourceCount(this.counts.activeScanControllers),
      scanConsumers: resourceCount(this.counts.scanConsumers),
      chooserSessions: resourceCount(this.counts.chooserSessions),
      connectionLeases: resourceCount(this.counts.connectionLeases),
      physicalLinks: resourceCount(this.counts.physicalLinks),
      databaseSnapshots: resourceCount(this.counts.databaseSnapshots),
      physicalCccdEnablements: resourceCount(this.counts.physicalCccdEnablements),
      subscriptionConsumers: resourceCount(this.counts.subscriptionConsumers),
      queuedOperations: resourceCount(this.counts.queuedOperations),
      dispatchedOperations: resourceCount(this.counts.dispatchedOperations),
      retainedByteBuffers: resourceCount(this.counts.retainedByteBuffers),
      restorationRecords: resourceCount(this.counts.restorationRecords),
      orphanedIpcOwners: resourceCount(this.counts.orphanedIpcOwners)
    }
  }

  isZero(): boolean {
    return Object.values(this.counts).every(count => count === 0)
  }

  private syncRetainedBytes(): ResourceCount {
    const retained = this.retainedStreamBytes + this.retainedOperationBytes
    this.counts.retainedByteBuffers = retained
    return resourceCount(retained)
  }

  private assertRetainedBytes(value: number, operation: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw contractError('argument.invalid', 'core', `resource-ledger.retained-bytes.${operation}`)
    }
  }
}
