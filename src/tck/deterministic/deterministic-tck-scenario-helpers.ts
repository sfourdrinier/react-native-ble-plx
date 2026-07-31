// src/tck/deterministic/deterministic-tck-scenario-helpers.ts

import { BackendContractError } from '../../backend-contract/errors'
import type { ConnectionLease } from '../../backend-contract/backend'
import type { CharacteristicPath, GattDatabase } from '../../backend-contract/gatt'
import { capacity, opaqueId, type ClientId, type SerializableRecord } from '../../backend-contract/primitives'
import type { OwnerScanOptions } from '../../backend-contract/advertisement'
import type { StreamItem } from '../../backend-contract/streams'
import type { DeterministicBackendFixture } from '../../testing/deterministic/deterministic-test-backend'
import type { VirtualCharacteristicAddress } from '../../testing/deterministic/virtual-peripheral'
import type { TckFactId } from '../contracts'

export interface FactObservation {
  readonly id: TckFactId
  readonly holds: boolean
  readonly detail: SerializableRecord
}

export function fact(id: TckFactId, holds: boolean, detail: SerializableRecord): FactObservation {
  return { id, holds, detail }
}

export function scanOptions(allowSharing: boolean): OwnerScanOptions<string, string> {
  return {
    filter: { serviceUuids: [], manufacturerData: [], localNamePrefix: null },
    duplicatePolicy: 'all',
    timestampPolicy: 'receipt-monotonic',
    delivery: {
      itemCapacity: capacity(4),
      byteCapacity: capacity(128),
      reservedControlCapacity: capacity(1),
      overflowPolicy: 'drop-oldest'
    },
    deadline: null,
    signal: null,
    sharing: { mode: 'owner', allowSharing }
  }
}

export function noOperationOptions() {
  return { signal: null, deadline: null }
}

export function peerId() {
  return opaqueId('deterministic-peer', 'peer', 'deterministic')
}

export function clientId(value: string): ClientId<string, string> {
  return opaqueId(value, 'client', `deterministic:${value}`)
}

export async function rejectsWithCode<Value>(promise: Promise<Value>, code: string): Promise<boolean> {
  const observation = await observeExpectedRejection(promise, code)
  return observation.matched
}

export interface ExpectedRejectionObservation {
  readonly resolved: boolean
  readonly matched: boolean
}

export async function observeExpectedRejection<Value>(
  promise: Promise<Value>,
  code: string
): Promise<ExpectedRejectionObservation> {
  return promise.then(
    () => ({ resolved: true, matched: false }),
    error => ({
      resolved: false,
      matched: error instanceof BackendContractError && error.normalized.code === code
    })
  )
}

export async function receivesValue(stream: AsyncIterable<{ readonly kind: string }>): Promise<boolean> {
  const iterator = stream[Symbol.asyncIterator]()
  const item = await iterator.next()
  return !item.done && item.value.kind === 'value'
}

export async function receivesTerminal(stream: AsyncIterable<{ readonly kind: string }>): Promise<boolean> {
  const iterator = stream[Symbol.asyncIterator]()
  const item = await iterator.next()
  return !item.done && item.value.kind === 'terminal'
}

export async function connectAndDiscover(fixture: DeterministicBackendFixture, client: string) {
  const connectionPromise = fixture.backend.connections.connect(peerId(), clientId(client), noOperationOptions())
  fixture.controller.clock.runUntilIdle()
  const lease = await connectionPromise
  const discoveryPromise = fixture.backend.gatt.discover(lease.connection, noOperationOptions())
  fixture.controller.clock.runUntilIdle()
  const database = await discoveryPromise
  const snapshot = await database.snapshot()
  return { lease, database, snapshot }
}

export async function releaseConnection(
  fixture: DeterministicBackendFixture,
  lease: ConnectionLease<string, string, string>
): Promise<void> {
  const release = lease.release()
  fixture.controller.clock.runUntilIdle()
  await release
}

export async function drainVirtualClock(fixture: DeterministicBackendFixture): Promise<void> {
  fixture.controller.clock.runUntilIdle()
  await Promise.resolve()
  fixture.controller.clock.runUntilIdle()
  await Promise.resolve()
  fixture.controller.clock.runUntilIdle()
}

export function characteristicAddress(
  path: CharacteristicPath<string, string, string, string, string, 'current'>
): VirtualCharacteristicAddress {
  return {
    serviceUuid: path.serviceUuid,
    serviceOccurrence: Number(path.serviceOccurrence),
    characteristicUuid: path.characteristicUuid,
    characteristicOccurrence: Number(path.characteristicOccurrence)
  }
}

export function subscriptionOptions(
  overflowPolicy: 'drop-oldest' | 'error',
  itemCapacity: number,
  byteCapacity: number
) {
  return {
    signal: null,
    deadline: null,
    delivery: {
      itemCapacity: capacity(itemCapacity),
      byteCapacity: capacity(byteCapacity),
      reservedControlCapacity: capacity(1),
      overflowPolicy
    }
  }
}

export async function nextValue<Value>(stream: AsyncIterable<StreamItem<Value>>): Promise<Value | null> {
  const item = await nextStreamItem(stream)
  if (item === null || item.kind !== 'value') {
    return null
  }
  return item.value
}

export async function nextStreamItem<Value>(
  stream: AsyncIterable<StreamItem<Value>>
): Promise<StreamItem<Value> | null> {
  const iterator = stream[Symbol.asyncIterator]()
  const item = await iterator.next()
  return item.done ? null : item.value
}

export function pathsMatchDatabaseGeneration(
  snapshot: Awaited<ReturnType<GattDatabase<string, string, string>['snapshot']>>
): boolean {
  const expectedAttachment = String(snapshot.path.attachment.backendInstanceId)
  const expectedDatabase = String(snapshot.path.databaseGeneration)
  for (const service of snapshot.services) {
    if (
      String(service.path.attachment.backendInstanceId) !== expectedAttachment ||
      String(service.path.databaseGeneration) !== expectedDatabase
    ) {
      return false
    }
  }
  for (const characteristic of snapshot.characteristics) {
    if (
      String(characteristic.path.attachment.backendInstanceId) !== expectedAttachment ||
      String(characteristic.path.databaseGeneration) !== expectedDatabase ||
      characteristic.path.validity !== 'current'
    ) {
      return false
    }
  }
  for (const descriptor of snapshot.descriptors) {
    if (
      String(descriptor.path.attachment.backendInstanceId) !== expectedAttachment ||
      String(descriptor.path.databaseGeneration) !== expectedDatabase ||
      descriptor.path.validity !== 'current'
    ) {
      return false
    }
  }
  return true
}

export function traceDispatchCount(fixture: DeterministicBackendFixture): number {
  return fixture.controller.traceSnapshot().filter(entry => entry.kind === 'operation' && entry.event === 'dispatched')
    .length
}
