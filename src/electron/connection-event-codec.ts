// src/electron/connection-event-codec.ts

import { contractError } from '../backend-contract/errors'
import type { SerializableRecord, SerializableValue } from '../backend-contract/primitives'
import type {
  ElectronAdapterStateV1,
  ElectronAttachmentRecordV1,
  ElectronConnectionEventsSubscribeResponseV1,
  ElectronConnectionLifecycleEventV1
} from './protocol'
import { ELECTRON_CONNECTION_LIFECYCLE_EVENT_SCHEMA_VERSION } from './protocol'

export interface ElectronConnectionEventCleanupReceipt {
  readonly state: 'released' | 'release-failed'
  readonly failureCount: number
}

export type DecodedConnectionEventStreamItem =
  | { readonly kind: 'value'; readonly value: ElectronConnectionLifecycleEventV1 }
  | {
      readonly kind: 'overflow'
      readonly policy: 'latest' | 'drop-oldest' | 'drop-newest' | 'error'
      readonly droppedItems: number
      readonly droppedBytes: number
      readonly replacedItems: number
    }
  | {
      readonly kind: 'terminal'
      readonly reason:
        | 'closed'
        | 'overflow'
        | 'source-failed'
        | 'owner-released'
        | 'connection-lost'
        | 'operation-aborted'
        | 'operation-timed-out'
      readonly droppedItems: number
      readonly droppedBytes: number
      readonly replacedItems: number
    }

export function decodeConnectionEventsSubscribeResponse(
  payload: SerializableRecord
): ElectronConnectionEventsSubscribeResponseV1 {
  const handle = requiredRendererString(payload, 'handle', 'electron-renderer.connection-events-subscribe')
  const connectionId = requiredRendererString(payload, 'connectionId', 'electron-renderer.connection-events-subscribe')
  const connectionGeneration = requiredRendererString(
    payload,
    'connectionGeneration',
    'electron-renderer.connection-events-subscribe'
  )
  if (payload.eventSchemaVersion !== ELECTRON_CONNECTION_LIFECYCLE_EVENT_SCHEMA_VERSION) {
    throw contractError('protocol.incompatible', 'ipc', 'electron-renderer.connection-events-schema')
  }
  return Object.freeze({
    handle,
    connectionId,
    connectionGeneration,
    eventSchemaVersion: ELECTRON_CONNECTION_LIFECYCLE_EVENT_SCHEMA_VERSION
  })
}

export function decodeConnectionEventCleanupReceipt(
  payload: SerializableRecord
): ElectronConnectionEventCleanupReceipt {
  if (payload.state !== 'released' && payload.state !== 'release-failed') {
    throw contractError('protocol.malformed', 'ipc', 'electron-renderer.connection-events-cleanup-state')
  }
  if (!isNonNegativeSafeInteger(payload.failureCount)) {
    throw contractError('protocol.malformed', 'ipc', 'electron-renderer.connection-events-cleanup-failures')
  }
  return Object.freeze({ state: payload.state, failureCount: payload.failureCount })
}

export function decodeConnectionEventStreamItem(item: SerializableRecord): DecodedConnectionEventStreamItem {
  if (item.kind === 'value') {
    return Object.freeze({ kind: 'value', value: decodeConnectionLifecycleEvent(item.value) })
  }
  if (item.kind === 'overflow') {
    if (
      !isOverflowPolicy(item.policy) ||
      !isNonNegativeSafeInteger(item.droppedItems) ||
      !isNonNegativeSafeInteger(item.droppedBytes) ||
      !isNonNegativeSafeInteger(item.replacedItems)
    ) {
      throw contractError('protocol.malformed', 'ipc', 'electron-renderer.connection-events-overflow')
    }
    return Object.freeze({
      kind: 'overflow',
      policy: item.policy,
      droppedItems: item.droppedItems,
      droppedBytes: item.droppedBytes,
      replacedItems: item.replacedItems
    })
  }
  if (item.kind === 'terminal') {
    if (
      !isStreamTerminalReason(item.reason) ||
      !isNonNegativeSafeInteger(item.droppedItems) ||
      !isNonNegativeSafeInteger(item.droppedBytes) ||
      !isNonNegativeSafeInteger(item.replacedItems)
    ) {
      throw contractError('protocol.malformed', 'ipc', 'electron-renderer.connection-events-terminal')
    }
    return Object.freeze({
      kind: 'terminal',
      reason: item.reason,
      droppedItems: item.droppedItems,
      droppedBytes: item.droppedBytes,
      replacedItems: item.replacedItems
    })
  }
  throw contractError('protocol.malformed', 'ipc', 'electron-renderer.connection-events-item')
}

function decodeConnectionLifecycleEvent(value: SerializableValue | undefined): ElectronConnectionLifecycleEventV1 {
  const event = serializableRecord(value)
  if (
    event === null ||
    event.kind !== 'connection-lifecycle' ||
    event.schemaVersion !== ELECTRON_CONNECTION_LIFECYCLE_EVENT_SCHEMA_VERSION ||
    !isConnectionState(event.previous) ||
    !isConnectionState(event.current) ||
    !isConnectionLifecycleCause(event.cause) ||
    !isNonNegativeSafeInteger(event.sequence) ||
    event.sequence < 1 ||
    (event.backendIngressOrdinal !== null && !isNonNegativeSafeInteger(event.backendIngressOrdinal))
  ) {
    throw contractError('protocol.malformed', 'ipc', 'electron-renderer.connection-lifecycle-event')
  }
  const attachment = decodeElectronAttachment(event.attachment)
  const attachmentId = requiredRendererString(event, 'attachmentId', 'electron-renderer.connection-lifecycle-event')
  if (attachment.attachmentId !== attachmentId) {
    throw contractError('protocol.violation', 'ipc', 'electron-renderer.connection-lifecycle-attachment')
  }
  return Object.freeze({
    kind: 'connection-lifecycle',
    schemaVersion: ELECTRON_CONNECTION_LIFECYCLE_EVENT_SCHEMA_VERSION,
    attachment,
    attachmentId,
    peerId: requiredRendererString(event, 'peerId', 'electron-renderer.connection-lifecycle-event'),
    connectionId: requiredRendererString(event, 'connectionId', 'electron-renderer.connection-lifecycle-event'),
    connectionGeneration: requiredRendererString(
      event,
      'connectionGeneration',
      'electron-renderer.connection-lifecycle-event'
    ),
    ownerLeaseId: requiredRendererString(event, 'ownerLeaseId', 'electron-renderer.connection-lifecycle-event'),
    sequence: event.sequence,
    backendIngressOrdinal: event.backendIngressOrdinal,
    previous: event.previous,
    current: event.current,
    cause: event.cause
  })
}

function decodeElectronAttachment(value: SerializableValue | undefined): ElectronAttachmentRecordV1 {
  const attachment = serializableRecord(value)
  if (attachment === null) {
    throw contractError('protocol.malformed', 'ipc', 'electron-renderer.connection-lifecycle-attachment')
  }
  const adapter = serializableRecord(attachment.adapter)
  if (adapter === null) {
    throw contractError('protocol.malformed', 'ipc', 'electron-renderer.connection-lifecycle-adapter')
  }
  const state = serializableRecord(adapter.state)
  if (
    state === null ||
    !isAdapterAvailability(state.availability) ||
    !isAdapterAuthorization(state.authorization) ||
    !isAdapterPower(state.power) ||
    typeof state.backendGeneration !== 'string' ||
    state.backendGeneration.length === 0 ||
    !isFiniteNumber(state.updatedAt) ||
    !isNullableString(state.safeReason)
  ) {
    throw contractError('protocol.malformed', 'ipc', 'electron-renderer.connection-lifecycle-adapter-state')
  }
  const limitations = stringArray(adapter.limitations, 'electron-renderer.connection-lifecycle-adapter-limitations')
  return Object.freeze({
    attachmentId: requiredRendererString(
      attachment,
      'attachmentId',
      'electron-renderer.connection-lifecycle-attachment'
    ),
    backendInstanceId: requiredRendererString(
      attachment,
      'backendInstanceId',
      'electron-renderer.connection-lifecycle-attachment'
    ),
    backendGeneration: requiredRendererString(
      attachment,
      'backendGeneration',
      'electron-renderer.connection-lifecycle-attachment'
    ),
    adapter: Object.freeze({
      adapterId: requiredRendererString(adapter, 'adapterId', 'electron-renderer.connection-lifecycle-adapter'),
      displayName: nullableRendererString(adapter, 'displayName', 'electron-renderer.connection-lifecycle-adapter'),
      state: Object.freeze({
        availability: state.availability,
        authorization: state.authorization,
        power: state.power,
        backendGeneration: state.backendGeneration,
        updatedAt: state.updatedAt,
        safeReason: state.safeReason
      }),
      adapterGeneration: requiredRendererString(
        adapter,
        'adapterGeneration',
        'electron-renderer.connection-lifecycle-adapter'
      ),
      limitations
    })
  })
}

function serializableRecord(value: SerializableValue | undefined): SerializableRecord | null {
  return isSerializableRecord(value) ? value : null
}

function isSerializableRecord(value: SerializableValue | undefined): value is SerializableRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Uint8Array)
}

function requiredRendererString(record: SerializableRecord, key: string, operation: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw contractError('protocol.malformed', 'ipc', operation)
  }
  return value
}

function nullableRendererString(record: SerializableRecord, key: string, operation: string): string | null {
  const value = record[key]
  if (value === null) {
    return null
  }
  if (typeof value !== 'string') {
    throw contractError('protocol.malformed', 'ipc', operation)
  }
  return value
}

function stringArray(value: SerializableValue | undefined, operation: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw contractError('protocol.malformed', 'ipc', operation)
  }
  const strings: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') {
      throw contractError('protocol.malformed', 'ipc', operation)
    }
    strings.push(item)
  }
  return Object.freeze(strings)
}

function isNonNegativeSafeInteger(value: SerializableValue | undefined): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isFiniteNumber(value: SerializableValue | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNullableString(value: SerializableValue | undefined): value is string | null {
  return value === null || typeof value === 'string'
}

function isConnectionState(
  value: SerializableValue | undefined
): value is ElectronConnectionLifecycleEventV1['current'] {
  return (
    value === 'connecting' ||
    value === 'connected' ||
    value === 'disconnecting' ||
    value === 'disconnected' ||
    value === 'lost'
  )
}

function isConnectionLifecycleCause(
  value: SerializableValue | undefined
): value is ElectronConnectionLifecycleEventV1['cause'] {
  return (
    value === 'connected' ||
    value === 'backend-transition' ||
    value === 'requested-disconnect' ||
    value === 'peer-link-loss' ||
    value === 'adapter-loss' ||
    value === 'backend-restart' ||
    value === 'released' ||
    value === 'manager-destroyed' ||
    value === 'backend-failure'
  )
}

function isOverflowPolicy(
  value: SerializableValue | undefined
): value is 'latest' | 'drop-oldest' | 'drop-newest' | 'error' {
  return value === 'latest' || value === 'drop-oldest' || value === 'drop-newest' || value === 'error'
}

function isStreamTerminalReason(
  value: SerializableValue | undefined
): value is Extract<DecodedConnectionEventStreamItem, { readonly kind: 'terminal' }>['reason'] {
  return (
    value === 'closed' ||
    value === 'overflow' ||
    value === 'source-failed' ||
    value === 'owner-released' ||
    value === 'connection-lost' ||
    value === 'operation-aborted' ||
    value === 'operation-timed-out'
  )
}

function isAdapterAvailability(value: SerializableValue | undefined): value is ElectronAdapterStateV1['availability'] {
  return value === 'available' || value === 'unavailable' || value === 'unsupported' || value === 'unknown'
}

function isAdapterAuthorization(
  value: SerializableValue | undefined
): value is ElectronAdapterStateV1['authorization'] {
  return (
    value === 'granted' ||
    value === 'denied' ||
    value === 'restricted' ||
    value === 'not-determined' ||
    value === 'unavailable'
  )
}

function isAdapterPower(value: SerializableValue | undefined): value is ElectronAdapterStateV1['power'] {
  return value === 'on' || value === 'off' || value === 'resetting' || value === 'unsupported' || value === 'unknown'
}
