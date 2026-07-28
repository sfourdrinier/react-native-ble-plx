// src/tck/runner-public-scenario-support.ts

import type { ScanOptions } from '../backend-contract/advertisement'
import type { BleCentralBackend } from '../backend-contract/backend'
import { BackendContractError, type CleanupRecord } from '../backend-contract/errors'
import type { BackendIdentity } from '../backend-contract/identity'
import {
  byteLimit,
  capacity,
  createAttachmentBoundIdFactory,
  ownBytes,
  type SerializableRecord
} from '../backend-contract/primitives'
import { createBleManager, DEFAULT_BLE_MANAGER_OPTIONS } from '../manager/ble-manager'
import type { BackendTckFixture, TckFact, TckScenarioDefinition } from './contracts'
import { TckAssertionError } from './contracts'
import type { PublicAuthority, PublicManager } from './runner-public-scenarios'

export function identitySeed<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  manager: PublicManager<Attachment, Identity>
) {
  const attachment = manager.attachedBackend.attachment.attachment
  return {
    attachmentId: attachment.attachmentId,
    backendInstanceId: attachment.backendInstanceId,
    backendGeneration: attachment.backendGeneration,
    adapterId: attachment.adapter.adapterId,
    adapterGeneration: attachment.adapter.adapterGeneration
  }
}

export function createBorrowingManager<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(
  owner: PublicManager<Attachment, Identity>,
  authority: PublicAuthority<Attachment, Identity>,
  fixture: BackendTckFixture<Attachment, Identity, Backend>,
  definition: TckScenarioDefinition,
  role: string
): Promise<PublicManager<Attachment, Identity>> {
  const ids = createAttachmentBoundIdFactory(identitySeed(owner))
  return createBleManager(
    {
      attachedBackend: owner.attachedBackend,
      clientId: ids.clientId(`tck-${definition.id}-${role}-client`),
      managerId: ids.managerId(`tck-${definition.id}-${role}-manager`),
      ownerMode: 'borrowing'
    },
    authority,
    { ...DEFAULT_BLE_MANAGER_OPTIONS, now: () => fixture.controller.now() }
  )
}

export async function connectToDeterministicPeer<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(
  manager: PublicManager<Attachment, Identity>,
  fixture: BackendTckFixture<Attachment, Identity, Backend>,
  definition: TckScenarioDefinition
) {
  const scan = await fixture.controller.settle(manager.scan(scanOptions(false)))
  const observation = scan.observations[Symbol.asyncIterator]().next()
  await fixture.controller.perform('queue-advertisement', emptyInput)
  await fixture.controller.flush()
  const observed = await fixture.controller.settle(observation)
  if (observed.done || observed.value.kind !== 'value') {
    throw new TckAssertionError(definition.id, 'connection setup did not observe a peer')
  }
  const peerId = observed.value.value.peerId
  const cleanup = await fixture.controller.settle(scan.stop())
  if (cleanup.state !== 'released' || cleanup.failures.length !== 0) {
    throw new TckAssertionError(definition.id, 'connection setup scan cleanup failed')
  }
  return fixture.controller.settle(manager.connect(peerId, operationOptions))
}

export async function connectAndDiscover<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(
  manager: PublicManager<Attachment, Identity>,
  fixture: BackendTckFixture<Attachment, Identity, Backend>,
  definition: TckScenarioDefinition
) {
  const connection = await connectToDeterministicPeer(manager, fixture, definition)
  const database = await fixture.controller.settle(connection.discover(operationOptions))
  const snapshot = await database.snapshot()
  return { connection, database, snapshot }
}

export function scanOptions<Attachment extends string>(allowSharing: boolean): ScanOptions<Attachment, string> {
  return {
    filter: { serviceUuids: [], localNamePrefix: null },
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

interface NotificationPath {
  readonly serviceUuid: string
  readonly serviceOccurrence: string | number
  readonly characteristicUuid: string
  readonly characteristicOccurrence: string | number
}

export function notificationInput(path: NotificationPath, value: Uint8Array): SerializableRecord {
  return Object.freeze({
    serviceUuid: String(path.serviceUuid),
    serviceOccurrence: Number(path.serviceOccurrence),
    characteristicUuid: String(path.characteristicUuid),
    characteristicOccurrence: Number(path.characteristicOccurrence),
    value: ownBytes(value, byteLimit(value.byteLength))
  })
}

export function isValueItem<Value extends { readonly kind: string }>(item: IteratorResult<Value>): boolean {
  return !item.done && item.value.kind === 'value'
}

export async function rejectsWithCode<Value>(promise: Promise<Value>, code: string): Promise<boolean> {
  return promise.then(
    () => false,
    error => error instanceof BackendContractError && error.normalized.code === code
  )
}

export function assertCleanupReleased(
  definition: TckScenarioDefinition,
  cleanup: CleanupRecord,
  resource: string
): void {
  if (cleanup.state !== 'released' || cleanup.failures.length !== 0) {
    throw new TckAssertionError(
      definition.id,
      `${resource} cleanup returned ${cleanup.state} with failures: ${
        cleanup.failures.map(failure => failure.error.code).join(', ') || 'none'
      }`
    )
  }
}

export function fact(id: TckFact['id'], holds: boolean, detail: SerializableRecord): TckFact {
  return Object.freeze({ id, holds, detail: Object.freeze(detail) })
}

export const emptyInput: SerializableRecord = Object.freeze({})
export const operationOptions = Object.freeze({ signal: null, deadline: null })
