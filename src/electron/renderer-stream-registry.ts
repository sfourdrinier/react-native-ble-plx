// src/electron/renderer-stream-registry.ts

import {
  BackendContractError,
  contractError,
  type CleanupFailure,
  type CleanupRecord
} from '../backend-contract/errors'
import { byteLimit, ownBytes, type SerializableRecord } from '../backend-contract/primitives'
import { snapshotSerializableRecord } from '../backend-contract/serializable'
import type { StreamItem } from '../backend-contract/streams'
import type { HostNeutralBackendIdentity } from '../backend-contract/identity'
import type { RendererLeaseIdentity } from '../backend-contract/electron'
import type { ScanSession, Subscription } from '../manager/ble-manager'
import type { ElectronBleIpcEvent } from './protocol'
import { assertAdvertisementObservation, snapshotAdvertisementObservation } from './advertisement-observation'
import type { AdvertisementObservation } from '../backend-contract/advertisement'

/**
 * `terminalized` means main has terminalized the exact stream or made the
 * exact renderer lease release-required because delivery was impossible.
 */
export type ElectronEventDelivery = 'delivered' | 'terminalized'
const cleanupRetryDelayMilliseconds = 100

export interface ManagedScan {
  readonly scan: ScanSession<string>
  pump: Promise<void>
  cleanupRequested: boolean
  retryHandle: ReturnType<typeof setTimeout> | null
  terminalPublished: boolean
}

export interface ManagedSubscription {
  readonly databaseHandle: string
  readonly subscription: Subscription<string, HostNeutralBackendIdentity<string>>
  pump: Promise<void>
  cleanupRequested: boolean
  retryHandle: ReturnType<typeof setTimeout> | null
  terminalPublished: boolean
}

export interface RendererStreamResources {
  readonly scans: Map<string, ManagedScan>
  readonly subscriptions: Map<string, ManagedSubscription>
}

export interface ElectronRendererStreamRegistryOptions {
  readonly maximumMessageBytes: number
  readonly publish: (rendererLeaseId: string, event: ElectronBleIpcEvent) => Promise<ElectronEventDelivery>
  readonly createEvent: (
    rendererLease: RendererLeaseIdentity,
    streamId: string,
    item: SerializableRecord
  ) => ElectronBleIpcEvent
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
    rendererLease: RendererLeaseIdentity,
    handle: string,
    scan: ScanSession<string>
  ): ManagedScan {
    const resource: ManagedScan = {
      scan,
      pump: Promise.resolve(),
      cleanupRequested: false,
      retryHandle: null,
      terminalPublished: false
    }
    resources.scans.set(handle, resource)
    resource.pump = this.forwardStream(
      rendererLease,
      handle,
      scan.observations,
      reason => this.terminalizeScan(resources, rendererLease, handle, resource, reason),
      () => this.completeTerminalScan(resources, rendererLease, handle, resource),
      () => resource.cleanupRequested
    )
    return resource
  }

  registerSubscription(
    resources: RendererStreamResources,
    rendererLease: RendererLeaseIdentity,
    handle: string,
    databaseHandle: string,
    subscription: Subscription<string, HostNeutralBackendIdentity<string>>
  ): ManagedSubscription {
    const resource: ManagedSubscription = {
      databaseHandle,
      subscription,
      pump: Promise.resolve(),
      cleanupRequested: false,
      retryHandle: null,
      terminalPublished: false
    }
    resources.subscriptions.set(handle, resource)
    resource.pump = this.forwardStream(
      rendererLease,
      handle,
      subscription.values,
      reason => this.terminalizeSubscription(resources, rendererLease, handle, resource, reason),
      () => this.completeTerminalSubscription(resources, rendererLease, handle, resource),
      () => resource.cleanupRequested
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
    resource.cleanupRequested = true
    if (!(await this.cleanupResource('scan', () => resource.scan.stop(), failures))) {
      resource.cleanupRequested = false
      return { state: 'release-failed', failures }
    }
    this.clearRetry(resource)
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
    resource.cleanupRequested = true
    if (!(await this.cleanupResource('subscription', () => resource.subscription.remove(), failures))) {
      resource.cleanupRequested = false
      return { state: 'release-failed', failures }
    }
    this.clearRetry(resource)
    if (awaitPump) {
      await resource.pump
    }
    resources.subscriptions.delete(handle)
    return { state: 'released', failures: [] }
  }

  async terminate(
    resources: RendererStreamResources,
    rendererLease: RendererLeaseIdentity,
    streamId: string,
    reason: 'renderer-backpressure' | 'renderer-unavailable'
  ): Promise<boolean> {
    const scan = resources.scans.get(streamId)
    if (scan !== undefined) {
      await this.terminalizeScan(resources, rendererLease, streamId, scan, reason)
      return true
    }
    const subscription = resources.subscriptions.get(streamId)
    if (subscription !== undefined) {
      await this.terminalizeSubscription(resources, rendererLease, streamId, subscription, reason)
      return true
    }
    return false
  }

  private async forwardStream<Value>(
    rendererLease: RendererLeaseIdentity,
    streamId: string,
    stream: AsyncIterable<StreamItem<Value>>,
    terminalize: (reason: 'ipc-message-too-large' | 'source-failed') => Promise<void>,
    completeTerminal: () => Promise<void>,
    cleanupRequested: () => boolean
  ): Promise<void> {
    try {
      for await (const item of stream) {
        const itemRecord = streamItemRecord(item)
        const event = this.options.createEvent(rendererLease, streamId, itemRecord)
        if (
          snapshotSerializableRecord({
            rendererLease: Object.freeze({
              leaseId: String(event.rendererLease.leaseId),
              generation: String(event.rendererLease.generation)
            }),
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
        const delivery = await this.options.publish(String(rendererLease.leaseId), event)
        if (delivery !== 'delivered') {
          return
        }
        if (item.kind === 'terminal') {
          await completeTerminal()
          return
        }
      }
      if (cleanupRequested()) {
        return
      }
      console.error('[ElectronRendererStreamRegistry] Stream ended without a terminal item:', { streamId })
      await terminalize('source-failed')
    } catch (error) {
      console.error('[ElectronRendererStreamRegistry] Stream forwarding failed:', { streamId, error })
      await terminalize('source-failed')
    }
  }

  private async completeTerminalScan(
    resources: RendererStreamResources,
    rendererLease: RendererLeaseIdentity,
    handle: string,
    resource: ManagedScan
  ): Promise<void> {
    if (resource.terminalPublished || resource.cleanupRequested) {
      return
    }
    resource.terminalPublished = true
    const cleanup = await this.stopScan(resources, handle, resource, false)
    if (cleanup.state === 'release-failed') {
      console.error('[ElectronRendererStreamRegistry] Failed to stop scan after source terminal:', {
        handle,
        cleanup
      })
      resource.terminalPublished = false
      this.scheduleScanRetry(resources, rendererLease, handle, resource, null)
    }
  }

  private async completeTerminalSubscription(
    resources: RendererStreamResources,
    rendererLease: RendererLeaseIdentity,
    handle: string,
    resource: ManagedSubscription
  ): Promise<void> {
    if (resource.terminalPublished || resource.cleanupRequested) {
      return
    }
    resource.terminalPublished = true
    const cleanup = await this.removeSubscription(resources, handle, resource, false)
    if (cleanup.state === 'release-failed') {
      console.error('[ElectronRendererStreamRegistry] Failed to remove subscription after source terminal:', {
        handle,
        cleanup
      })
      resource.terminalPublished = false
      this.scheduleSubscriptionRetry(resources, rendererLease, handle, resource, null)
    }
  }

  private async terminalizeScan(
    resources: RendererStreamResources,
    rendererLease: RendererLeaseIdentity,
    handle: string,
    resource: ManagedScan,
    reason: 'ipc-message-too-large' | 'source-failed' | 'renderer-backpressure' | 'renderer-unavailable'
  ): Promise<void> {
    if (resource.terminalPublished || resource.cleanupRequested) {
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
      resource.terminalPublished = false
      this.scheduleScanRetry(resources, rendererLease, handle, resource, reason)
      return
    }
    await this.publishTerminal(rendererLease, handle, reason)
  }

  private async terminalizeSubscription(
    resources: RendererStreamResources,
    rendererLease: RendererLeaseIdentity,
    handle: string,
    resource: ManagedSubscription,
    reason: 'ipc-message-too-large' | 'source-failed' | 'renderer-backpressure' | 'renderer-unavailable'
  ): Promise<void> {
    if (resource.terminalPublished || resource.cleanupRequested) {
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
      resource.terminalPublished = false
      this.scheduleSubscriptionRetry(resources, rendererLease, handle, resource, reason)
      return
    }
    await this.publishTerminal(rendererLease, handle, reason)
  }

  private scheduleScanRetry(
    resources: RendererStreamResources,
    rendererLease: RendererLeaseIdentity,
    handle: string,
    resource: ManagedScan,
    reason: 'ipc-message-too-large' | 'source-failed' | 'renderer-backpressure' | 'renderer-unavailable' | null
  ): void {
    if (resource.retryHandle !== null || !resources.scans.has(handle)) {
      return
    }
    resource.retryHandle = setTimeout(() => {
      resource.retryHandle = null
      const retry =
        reason === null
          ? this.completeTerminalScan(resources, rendererLease, handle, resource)
          : this.terminalizeScan(resources, rendererLease, handle, resource, reason)
      retry.catch(error => {
        console.error('[ElectronRendererStreamRegistry] Scheduled scan cleanup retry rejected:', { handle, error })
        this.scheduleScanRetry(resources, rendererLease, handle, resource, reason)
      })
    }, cleanupRetryDelayMilliseconds)
  }

  private scheduleSubscriptionRetry(
    resources: RendererStreamResources,
    rendererLease: RendererLeaseIdentity,
    handle: string,
    resource: ManagedSubscription,
    reason: 'ipc-message-too-large' | 'source-failed' | 'renderer-backpressure' | 'renderer-unavailable' | null
  ): void {
    if (resource.retryHandle !== null || !resources.subscriptions.has(handle)) {
      return
    }
    resource.retryHandle = setTimeout(() => {
      resource.retryHandle = null
      const retry =
        reason === null
          ? this.completeTerminalSubscription(resources, rendererLease, handle, resource)
          : this.terminalizeSubscription(resources, rendererLease, handle, resource, reason)
      retry.catch(error => {
        console.error('[ElectronRendererStreamRegistry] Scheduled subscription cleanup retry rejected:', {
          handle,
          error
        })
        this.scheduleSubscriptionRetry(resources, rendererLease, handle, resource, reason)
      })
    }, cleanupRetryDelayMilliseconds)
  }

  private clearRetry(resource: ManagedScan | ManagedSubscription): void {
    if (resource.retryHandle !== null) {
      clearTimeout(resource.retryHandle)
      resource.retryHandle = null
    }
  }

  private async publishTerminal(
    rendererLease: RendererLeaseIdentity,
    streamId: string,
    reason: 'ipc-message-too-large' | 'source-failed' | 'renderer-backpressure' | 'renderer-unavailable'
  ): Promise<void> {
    try {
      const delivery = await this.options.publish(
        String(rendererLease.leaseId),
        this.options.createEvent(rendererLease, streamId, Object.freeze({ kind: 'terminal', reason }))
      )
      if (delivery === 'terminalized') {
        console.error(
          '[ElectronRendererStreamRegistry] Terminal event could not be delivered; exact renderer lease cleanup was required:',
          { streamId, reason, rendererLeaseId: String(rendererLease.leaseId) }
        )
      }
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
    return snapshotAdvertisementObservation(value)
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

function isAdvertisementValue(value: unknown): value is AdvertisementObservation<string> {
  try {
    assertAdvertisementObservation(value)
    return true
  } catch (error) {
    if (error instanceof BackendContractError) {
      return false
    }
    throw error
  }
}

function normalizedCleanupError(error: unknown) {
  if (error instanceof BackendContractError) {
    return error.normalized
  }
  return contractError('platform.failure', 'cleanup', 'electron-renderer-stream-registry.cleanup').normalized
}
