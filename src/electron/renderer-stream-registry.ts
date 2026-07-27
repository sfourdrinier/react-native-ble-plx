// src/electron/renderer-stream-registry.ts

import { BackendContractError, contractError, type CleanupFailure, type CleanupRecord } from '../backend-contract/errors'
import { byteLimit, ownBytes, type SerializableRecord } from '../backend-contract/primitives'
import { snapshotSerializableRecord } from '../backend-contract/serializable'
import type { StreamItem } from '../backend-contract/streams'
import type { HostNeutralBackendIdentity } from '../backend-contract/identity'
import type { ScanSession, Subscription } from '../manager/ble-manager'
import type { ElectronBleIpcEvent } from './protocol'

export type ElectronEventDelivery = 'delivered' | 'terminalized'

export interface ManagedScan {
  readonly scan: ScanSession<string>
  pump: Promise<void>
  terminalPublished: boolean
}

export interface ManagedSubscription {
  readonly databaseHandle: string
  readonly subscription: Subscription<string, HostNeutralBackendIdentity<string>>
  pump: Promise<void>
  terminalPublished: boolean
}

export interface RendererStreamResources {
  readonly scans: Map<string, ManagedScan>
  readonly subscriptions: Map<string, ManagedSubscription>
}

export interface ElectronRendererStreamRegistryOptions {
  readonly maximumMessageBytes: number
  readonly publish: (rendererClientId: string, event: ElectronBleIpcEvent) => Promise<ElectronEventDelivery>
  readonly createEvent: (streamId: string, item: SerializableRecord) => ElectronBleIpcEvent
}

/**
 * Owns the source side of renderer stream forwarding. A terminal caused by an
 * IPC limit, a source failure, or a frozen renderer always attempts to stop
 * the native producer before the terminal record is emitted.
 */
export class ElectronRendererStreamRegistry {
  constructor(private readonly options: ElectronRendererStreamRegistryOptions) {}

  registerScan(
    resources: RendererStreamResources,
    rendererClientId: string,
    handle: string,
    scan: ScanSession<string>
  ): ManagedScan {
    const resource: ManagedScan = {
      scan,
      pump: Promise.resolve(),
      terminalPublished: false
    }
    resources.scans.set(handle, resource)
    resource.pump = this.forwardStream(rendererClientId, handle, scan.observations, reason =>
      this.terminalizeScan(resources, rendererClientId, handle, resource, reason)
    )
    return resource
  }

  registerSubscription(
    resources: RendererStreamResources,
    rendererClientId: string,
    handle: string,
    databaseHandle: string,
    subscription: Subscription<string, HostNeutralBackendIdentity<string>>
  ): ManagedSubscription {
    const resource: ManagedSubscription = {
      databaseHandle,
      subscription,
      pump: Promise.resolve(),
      terminalPublished: false
    }
    resources.subscriptions.set(handle, resource)
    resource.pump = this.forwardStream(rendererClientId, handle, subscription.values, reason =>
      this.terminalizeSubscription(resources, rendererClientId, handle, resource, reason)
    )
    return resource
  }

  async stopScan(
    resources: RendererStreamResources,
    handle: string,
    resource: ManagedScan,
    awaitPump: boolean
  ): Promise<CleanupRecord> {
    const failures: CleanupFailure[] = []
    if (!(await this.cleanupResource('scan', () => resource.scan.stop(), failures))) {
      return { state: 'release-failed', failures }
    }
    if (awaitPump) {
      await resource.pump
    }
    resources.scans.delete(handle)
    return { state: 'released', failures: [] }
  }

  async removeSubscription(
    resources: RendererStreamResources,
    handle: string,
    resource: ManagedSubscription,
    awaitPump: boolean
  ): Promise<CleanupRecord> {
    const failures: CleanupFailure[] = []
    if (!(await this.cleanupResource('subscription', () => resource.subscription.remove(), failures))) {
      return { state: 'release-failed', failures }
    }
    if (awaitPump) {
      await resource.pump
    }
    resources.subscriptions.delete(handle)
    return { state: 'released', failures: [] }
  }

  async terminate(
    resources: RendererStreamResources,
    rendererClientId: string,
    streamId: string,
    reason: 'renderer-backpressure' | 'renderer-unavailable'
  ): Promise<boolean> {
    const scan = resources.scans.get(streamId)
    if (scan !== undefined) {
      await this.terminalizeScan(resources, rendererClientId, streamId, scan, reason)
      return true
    }
    const subscription = resources.subscriptions.get(streamId)
    if (subscription !== undefined) {
      await this.terminalizeSubscription(resources, rendererClientId, streamId, subscription, reason)
      return true
    }
    return false
  }

  private async forwardStream<Value>(
    rendererClientId: string,
    streamId: string,
    stream: AsyncIterable<StreamItem<Value>>,
    terminalize: (reason: 'ipc-message-too-large' | 'source-failed') => Promise<void>
  ): Promise<void> {
    try {
      for await (const item of stream) {
        const itemRecord = streamItemRecord(item)
        const event = this.options.createEvent(streamId, itemRecord)
        if (
          snapshotSerializableRecord({
            eventId: event.eventId,
            streamId: event.streamId,
            item: event.item
          }).byteLength > this.options.maximumMessageBytes
        ) {
          console.error('[ElectronRendererStreamRegistry] Stream item exceeded the configured IPC message limit:', {
            streamId
          })
          await terminalize('ipc-message-too-large')
          return
        }
        const delivery = await this.options.publish(rendererClientId, event)
        if (delivery === 'terminalized') {
          return
        }
      }
    } catch (error) {
      console.error('[ElectronRendererStreamRegistry] Stream forwarding failed:', { streamId, error })
      await terminalize('source-failed')
    }
  }

  private async terminalizeScan(
    resources: RendererStreamResources,
    rendererClientId: string,
    handle: string,
    resource: ManagedScan,
    reason: 'ipc-message-too-large' | 'source-failed' | 'renderer-backpressure' | 'renderer-unavailable'
  ): Promise<void> {
    if (resource.terminalPublished) {
      return
    }
    resource.terminalPublished = true
    const cleanup = await this.stopScan(resources, handle, resource, false)
    if (cleanup.state === 'release-failed') {
      console.error('[ElectronRendererStreamRegistry] Failed to stop scan while terminalizing stream:', {
        handle,
        reason,
        cleanup
      })
    }
    await this.publishTerminal(rendererClientId, handle, reason)
  }

  private async terminalizeSubscription(
    resources: RendererStreamResources,
    rendererClientId: string,
    handle: string,
    resource: ManagedSubscription,
    reason: 'ipc-message-too-large' | 'source-failed' | 'renderer-backpressure' | 'renderer-unavailable'
  ): Promise<void> {
    if (resource.terminalPublished) {
      return
    }
    resource.terminalPublished = true
    const cleanup = await this.removeSubscription(resources, handle, resource, false)
    if (cleanup.state === 'release-failed') {
      console.error('[ElectronRendererStreamRegistry] Failed to remove subscription while terminalizing stream:', {
        handle,
        reason,
        cleanup
      })
    }
    await this.publishTerminal(rendererClientId, handle, reason)
  }

  private async publishTerminal(
    rendererClientId: string,
    streamId: string,
    reason: 'ipc-message-too-large' | 'source-failed' | 'renderer-backpressure' | 'renderer-unavailable'
  ): Promise<void> {
    try {
      await this.options.publish(
        rendererClientId,
        this.options.createEvent(streamId, Object.freeze({ kind: 'terminal', reason }))
      )
    } catch (error) {
      console.error('[ElectronRendererStreamRegistry] Terminal event delivery failed after source cleanup:', {
        streamId,
        reason,
        error
      })
    }
  }

  private async cleanupResource(
    resourceKind: string,
    cleanup: () => Promise<CleanupRecord>,
    failures: CleanupFailure[]
  ): Promise<boolean> {
    try {
      const result = await cleanup()
      failures.push(...result.failures)
      return result.state === 'released'
    } catch (error) {
      console.error('[ElectronRendererStreamRegistry] Resource cleanup failed:', { resourceKind, error })
      failures.push({
        resourceKind,
        error: normalizedCleanupError(error)
      })
      return false
    }
  }
}

function streamItemRecord<Value>(item: StreamItem<Value>): SerializableRecord {
  if (item.kind === 'value') {
    return Object.freeze({ kind: 'value', value: snapshotStreamValue(item.value) })
  }
  if (item.kind === 'overflow') {
    return Object.freeze({
      kind: 'overflow',
      policy: item.policy,
      droppedItems: Number(item.droppedItems),
      droppedBytes: Number(item.droppedBytes),
      replacedItems: Number(item.replacedItems)
    })
  }
  return Object.freeze({
    kind: 'terminal',
    reason: item.reason,
    droppedItems: Number(item.droppedItems),
    droppedBytes: Number(item.droppedBytes),
    replacedItems: Number(item.replacedItems)
  })
}

function snapshotStreamValue(value: unknown): SerializableRecord {
  if (isNotificationValue(value)) {
    return Object.freeze({
      value: ownBytes(value.value, byteLimit(value.value.byteLength)),
      indication: value.indication === true
    })
  }
  if (isAdvertisementValue(value)) {
    return snapshotAdvertisement(value)
  }
  throw contractError('protocol.malformed', 'ipc', 'electron-renderer-stream-registry.stream-value')
}

function isNotificationValue(value: unknown): value is { readonly value: Uint8Array; readonly indication?: boolean } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'value' in value &&
    value.value instanceof Uint8Array &&
    (!('indication' in value) || typeof value.indication === 'boolean')
  )
}

function isAdvertisementValue(value: unknown): value is {
  readonly peerId: string
  readonly observedAt: number
  readonly source: 'platform-raw' | 'platform-derived' | 'core-merged'
  readonly ingressOrdinal: number
  readonly localName: AdvertisementField<string>
  readonly rssi: AdvertisementField<number>
  readonly serviceUuids: AdvertisementField<readonly string[]>
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'peerId' in value &&
    typeof value.peerId === 'string' &&
    'observedAt' in value &&
    typeof value.observedAt === 'number' &&
    'source' in value &&
    (value.source === 'platform-raw' || value.source === 'platform-derived' || value.source === 'core-merged') &&
    'ingressOrdinal' in value &&
    typeof value.ingressOrdinal === 'number' &&
    'localName' in value &&
    isAdvertisementField(value.localName) &&
    'rssi' in value &&
    isAdvertisementField(value.rssi) &&
    'serviceUuids' in value &&
    isAdvertisementField(value.serviceUuids)
  )
}

interface AdvertisementField<Value> {
  readonly state: 'present' | 'absent' | 'unavailable'
  readonly provenance: string
  readonly reason?: string
  readonly value?: Value
}

function isAdvertisementField(value: unknown): value is AdvertisementField<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'state' in value &&
    (value.state === 'present' || value.state === 'absent' || value.state === 'unavailable') &&
    'provenance' in value &&
    typeof value.provenance === 'string'
  )
}

function snapshotAdvertisement(value: {
  readonly peerId: string
  readonly observedAt: number
  readonly source: 'platform-raw' | 'platform-derived' | 'core-merged'
  readonly ingressOrdinal: number
  readonly localName: AdvertisementField<string>
  readonly rssi: AdvertisementField<number>
  readonly serviceUuids: AdvertisementField<readonly string[]>
}): SerializableRecord {
  return Object.freeze({
    peerId: value.peerId,
    observedAt: value.observedAt,
    source: value.source,
    ingressOrdinal: value.ingressOrdinal,
    localName: snapshotField(value.localName, fieldValue => fieldValue),
    rssi: snapshotField(value.rssi, fieldValue => fieldValue),
    serviceUuids: snapshotField(value.serviceUuids, fieldValue => Object.freeze(fieldValue))
  })
}

function snapshotField<Value>(
  field: AdvertisementField<Value>,
  snapshot: (value: Value) => SerializableRecord | string | number | readonly string[]
): SerializableRecord {
  if (field.state === 'present') {
    if (field.value === undefined) {
      throw contractError('protocol.malformed', 'ipc', 'electron-renderer-stream-registry.advertisement-field')
    }
    return Object.freeze({ state: field.state, provenance: field.provenance, value: snapshot(field.value) })
  }
  return Object.freeze({ state: field.state, reason: field.reason ?? 'unavailable', provenance: field.provenance })
}

function normalizedCleanupError(error: unknown) {
  if (error instanceof BackendContractError) {
    return error.normalized
  }
  return contractError('platform.failure', 'cleanup', 'electron-renderer-stream-registry.cleanup').normalized
}
