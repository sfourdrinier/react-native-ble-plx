// src/backend-contract/electron.ts

import { contractError } from './errors'
import type { CleanupRecord } from './errors'
import { attachmentRecordsEqual, type AttachmentRecord } from './identity'
import type {
  AttachmentId,
  ByteLimit,
  Capacity,
  ClientId,
  GenerationId,
  IpcOperationCorrelation,
  IpcVersionAxes,
  NegotiatedVersion,
  OpaqueId,
  OwnedBytes,
  SerializableRecord
} from './primitives'
import { byteLimit, opaqueId, ownBytes } from './primitives'
import { snapshotSerializableRecord, utf8ByteLength } from './serializable'
import type { BoundedAsyncStream } from './streams'

/** Two overlapping bootstraps support React StrictMode handoff without permitting unbounded amplification. */
export const ELECTRON_MAX_ACTIVE_RENDERER_LEASES_PER_IDENTITY = 2

export interface RendererIdentity<Attachment extends string, Renderer extends string> {
  readonly clientId: ClientId<Attachment, Renderer>
  readonly windowScope: string
  readonly sessionScope: string
}

/** Main-issued lifetime identity for one renderer bootstrap, independent of authenticated sender identity. */
export interface RendererLeaseIdentity {
  readonly leaseId: OpaqueId<'renderer-lease'>
  readonly generation: GenerationId<'renderer-lease-generation', string>
}

/** Main-process authentication facts derived from Electron's sender, never renderer input. */
export interface TrustedIpcSender<Attachment extends string, Renderer extends string> {
  readonly authenticatedClientId: ClientId<Attachment, Renderer>
  readonly authenticatedWindowScope: string
  readonly authenticatedSessionScope: string
}

/** Fixed limits owned by the main process for one attached Electron backend. */
export interface IpcQuota {
  readonly maximumMessageBytes: ByteLimit
  readonly maximumOutstandingOperations: Capacity
  readonly maximumRetainedBytes: ByteLimit
}

/**
 * Untrusted renderer request. Attachment and versions are checked against the
 * main-process authority; renderer code cannot select quotas or other limits.
 */
export interface IpcEnvelope<Attachment extends string, Renderer extends string, Operation extends string> {
  readonly versions: IpcVersionAxes
  readonly attachment: AttachmentRecord<Attachment>
  readonly attachmentId: AttachmentId<Attachment>
  readonly renderer: RendererIdentity<Attachment, Renderer>
  readonly rendererLease: RendererLeaseIdentity
  readonly correlation: IpcOperationCorrelation<Attachment, Operation>
  readonly dispatchEpoch: GenerationId<'ipc-dispatch-epoch', `${Attachment}:${Operation}`>
  readonly command: string
  readonly payload: SerializableRecord
  readonly binaryPayload: OwnedBytes | null
  readonly quota?: never
}

export interface RendererSnapshot<Attachment extends string, Renderer extends string> {
  readonly attachment: AttachmentRecord<Attachment>
  readonly attachmentId: AttachmentId<Attachment>
  readonly renderer: RendererIdentity<Attachment, Renderer>
  readonly rebindRequired: true
  readonly activeLeaseCount: number
  readonly activeLeases: readonly string[]
  readonly attachmentGeneration: GenerationId<'backend-generation', Attachment>
  readonly restorable: false
}

/** Immutable main-process configuration for exactly one attached backend generation. */
export interface ElectronMainArbiterAuthority<Attachment extends string> {
  readonly attachment: AttachmentRecord<Attachment>
  readonly versions: IpcVersionAxes
  readonly quota: IpcQuota
}

/** Routing hooks receive requests only after all authority checks have completed. */
export interface ElectronMainArbiterHandlers<Attachment extends string> {
  route<Renderer extends string, Operation extends string>(
    envelope: IpcEnvelope<Attachment, Renderer, Operation>
  ): Promise<SerializableRecord>
  release<Renderer extends string>(
    identity: RendererIdentity<Attachment, Renderer>,
    lease: RendererLeaseIdentity
  ): Promise<CleanupRecord>
}

export interface ElectronMainArbiter<Attachment extends string> {
  registerRenderer<Renderer extends string>(identity: RendererIdentity<Attachment, Renderer>): RendererLeaseIdentity
  route<Renderer extends string, Operation extends string>(
    sender: TrustedIpcSender<Attachment, Renderer>,
    envelope: IpcEnvelope<Attachment, Renderer, Operation>
  ): Promise<SerializableRecord>
  releaseRenderer<Renderer extends string>(
    sender: TrustedIpcSender<Attachment, Renderer>,
    lease: RendererLeaseIdentity
  ): Promise<CleanupRecord>
}

interface RendererAccounting<Attachment extends string> {
  readonly identity: RendererIdentity<Attachment, string>
  readonly lease: RendererLeaseIdentity
  /**
   * Bounded terminal replay ledger. In-flight entries are never evicted, while
   * settled entries remain long enough to reject a replay before LRU eviction.
   */
  readonly replayLedger: Map<string, ReplayLedgerEntry>
  lifecycle: 'active' | 'releasing'
  outstandingOperations: number
  releaseResult: Promise<CleanupRecord> | null
  retainedBytes: number
}

interface ReplayLedgerEntry {
  readonly byteLength: number
  state: 'in-flight' | 'terminal'
}

interface PreparedEnvelope<Attachment extends string, Renderer extends string, Operation extends string> {
  readonly envelope: IpcEnvelope<Attachment, Renderer, Operation>
  readonly totalBytes: number
  readonly replayKey: string
  readonly replayKeyBytes: number
}

/**
 * Main-process IPC authority. It owns the current full attachment tuple,
 * negotiated version axes, and hard quotas rather than trusting renderer data.
 */
export class ElectronMainArbiterContext<Attachment extends string> implements ElectronMainArbiter<Attachment> {
  private static readonly maximumTerminalReplayEntries = 128
  private readonly renderers = new Map<string, RendererAccounting<Attachment>>()
  private readonly authority: ElectronMainArbiterAuthority<Attachment>
  private readonly handlers: ElectronMainArbiterHandlers<Attachment>
  private nextRendererLease = 1

  constructor(authority: ElectronMainArbiterAuthority<Attachment>, handlers: ElectronMainArbiterHandlers<Attachment>) {
    this.authority = snapshotArbiterAuthority(authority)
    this.handlers = handlers
  }

  registerRenderer<Renderer extends string>(identity: RendererIdentity<Attachment, Renderer>): RendererLeaseIdentity {
    let matchingLeaseCount = 0
    for (const accounting of this.renderers.values()) {
      if (rendererIdentitiesEqual(accounting.identity, identity)) {
        matchingLeaseCount += 1
      }
    }
    if (matchingLeaseCount >= ELECTRON_MAX_ACTIVE_RENDERER_LEASES_PER_IDENTITY) {
      throw contractError('stream.quota', 'ipc', 'electron-main-arbiter.renderer-leases')
    }
    const ordinal = this.nextRendererLease
    this.nextRendererLease += 1
    const scope = `${String(this.authority.attachment.attachmentId)}:${String(identity.clientId)}`
    const lease = Object.freeze({
      leaseId: opaqueId(`renderer-lease-${ordinal}`, 'renderer-lease', scope),
      generation: opaqueId(`renderer-lease-generation-${ordinal}`, 'renderer-lease-generation', scope)
    })
    this.renderers.set(String(lease.leaseId), {
      identity: snapshotRendererIdentity(identity),
      lease,
      replayLedger: new Map<string, ReplayLedgerEntry>(),
      lifecycle: 'active',
      outstandingOperations: 0,
      releaseResult: null,
      retainedBytes: 0
    })
    return lease
  }

  async route<Renderer extends string, Operation extends string>(
    sender: TrustedIpcSender<Attachment, Renderer>,
    envelope: IpcEnvelope<Attachment, Renderer, Operation>
  ): Promise<SerializableRecord> {
    assertRendererLeaseShape(envelope.rendererLease)
    this.assertRendererDoesNotSupplyAuthority(envelope)
    this.assertSender(sender, envelope.renderer)
    const accounting = this.requireAccounting(envelope.rendererLease)
    this.assertRegisteredRenderer(accounting, envelope.renderer, envelope.rendererLease)
    this.assertRendererActive(accounting)
    this.assertAttachment(envelope)
    this.assertVersions(envelope)
    const prepared = this.prepareEnvelope(envelope)
    // A cancellation must remain admissible when normal work has filled the
    // operation quota; it still receives full replay and byte accounting.
    const reservesOperationSlot = prepared.envelope.command !== 'operation.cancel'
    this.reserveOperation(accounting, prepared, reservesOperationSlot)
    try {
      return await this.handlers.route(prepared.envelope)
    } finally {
      if (reservesOperationSlot) {
        accounting.outstandingOperations -= 1
      }
      accounting.retainedBytes -= prepared.totalBytes
      this.markReplayTerminal(accounting, prepared.replayKey)
      this.trimTerminalReplayLedger(accounting, 0, 0)
    }
  }

  async releaseRenderer<Renderer extends string>(
    sender: TrustedIpcSender<Attachment, Renderer>,
    lease: RendererLeaseIdentity
  ): Promise<CleanupRecord> {
    assertRendererLeaseShape(lease)
    const accounting = this.renderers.get(String(lease.leaseId))
    if (accounting === undefined) {
      return { state: 'released', failures: [] }
    }
    assertRendererLeaseMatches(accounting.lease, lease)
    this.assertSender(sender, accounting.identity)
    if (accounting.lifecycle === 'releasing') {
      if (accounting.releaseResult === null) {
        throw contractError('protocol.violation', 'ipc', 'electron-main-arbiter.release-accounting')
      }
      return accounting.releaseResult
    }
    accounting.lifecycle = 'releasing'
    const releaseResult = Promise.resolve()
      .then(() => this.handlers.release(accounting.identity, accounting.lease))
      .then(
        cleanup => {
          if (cleanup.state === 'released') {
            this.renderers.delete(String(accounting.lease.leaseId))
          } else {
            accounting.lifecycle = 'active'
            accounting.releaseResult = null
          }
          return cleanup
        },
        error => {
          console.error('[ElectronMainArbiterContext.releaseRenderer] Renderer release rejected:', error)
          accounting.lifecycle = 'active'
          accounting.releaseResult = null
          throw error
        }
      )
    accounting.releaseResult = releaseResult
    return releaseResult
  }

  private assertRendererDoesNotSupplyAuthority<Renderer extends string, Operation extends string>(
    envelope: IpcEnvelope<Attachment, Renderer, Operation>
  ): void {
    if ('quota' in envelope) {
      throw contractError('protocol.violation', 'ipc', 'electron-main-arbiter.renderer-authority')
    }
  }

  private assertSender<Renderer extends string>(
    sender: TrustedIpcSender<Attachment, Renderer>,
    renderer: RendererIdentity<Attachment, Renderer>
  ): void {
    if (
      sender.authenticatedClientId !== renderer.clientId ||
      sender.authenticatedWindowScope !== renderer.windowScope ||
      sender.authenticatedSessionScope !== renderer.sessionScope
    ) {
      throw contractError('ownership.denied', 'ipc', 'electron-main-arbiter.sender')
    }
  }

  private assertRegisteredRenderer<Renderer extends string>(
    accounting: RendererAccounting<Attachment>,
    identity: RendererIdentity<Attachment, Renderer>,
    lease: RendererLeaseIdentity
  ): void {
    if (!rendererIdentitiesEqual(accounting.identity, identity)) {
      throw contractError('ownership.denied', 'ipc', 'electron-main-arbiter.renderer-registration')
    }
    assertRendererLeaseMatches(accounting.lease, lease)
  }

  private assertRendererActive(accounting: RendererAccounting<Attachment>): void {
    if (accounting.lifecycle !== 'active') {
      throw contractError('lifecycle.invalid-state', 'ipc', 'electron-main-arbiter.renderer-releasing')
    }
  }

  private assertAttachment<Renderer extends string, Operation extends string>(
    envelope: IpcEnvelope<Attachment, Renderer, Operation>
  ): void {
    if (
      envelope.attachmentId !== envelope.attachment.attachmentId ||
      envelope.attachmentId !== this.authority.attachment.attachmentId ||
      !attachmentRecordsEqual(envelope.attachment, this.authority.attachment)
    ) {
      throw contractError('protocol.violation', 'ipc', 'electron-main-arbiter.attachment')
    }
  }

  private assertVersions<Renderer extends string, Operation extends string>(
    envelope: IpcEnvelope<Attachment, Renderer, Operation>
  ): void {
    if (!ipcVersionsEqual(envelope.versions, this.authority.versions)) {
      throw contractError('protocol.incompatible', 'ipc', 'electron-main-arbiter.versions')
    }
  }

  private prepareEnvelope<Renderer extends string, Operation extends string>(
    envelope: IpcEnvelope<Attachment, Renderer, Operation>
  ): PreparedEnvelope<Attachment, Renderer, Operation> {
    const payload = snapshotSerializableRecord(envelope.payload)
    const binaryPayload =
      envelope.binaryPayload === null
        ? null
        : ownBytes(envelope.binaryPayload, byteLimit(envelope.binaryPayload.byteLength))
    const totalBytes = payload.byteLength + (binaryPayload?.byteLength ?? 0) + envelopeMetadataByteLength(envelope)
    if (totalBytes > this.authority.quota.maximumMessageBytes) {
      throw contractError('bytes.too-large', 'ipc', 'electron-main-arbiter.payload-size')
    }
    const replayKey = operationReplayKey(envelope)
    return {
      envelope: Object.freeze({
        ...envelope,
        attachment: this.authority.attachment,
        versions: this.authority.versions,
        renderer: snapshotRendererIdentity(envelope.renderer),
        rendererLease: snapshotRendererLease(envelope.rendererLease),
        payload: payload.value,
        binaryPayload
      }),
      totalBytes,
      replayKey,
      replayKeyBytes: utf8ByteLength(replayKey)
    }
  }

  private requireAccounting(lease: RendererLeaseIdentity): RendererAccounting<Attachment> {
    const accounting = this.renderers.get(String(lease.leaseId))
    if (accounting === undefined) {
      throw contractError('ownership.denied', 'ipc', 'electron-main-arbiter.renderer-registration')
    }
    return accounting
  }

  private reserveOperation<Renderer extends string, Operation extends string>(
    accounting: RendererAccounting<Attachment>,
    prepared: PreparedEnvelope<Attachment, Renderer, Operation>,
    reservesOperationSlot: boolean
  ): void {
    if (accounting.replayLedger.has(prepared.replayKey)) {
      throw contractError('protocol.violation', 'ipc', 'electron-main-arbiter.replay')
    }
    if (
      reservesOperationSlot &&
      accounting.outstandingOperations >= this.authority.quota.maximumOutstandingOperations
    ) {
      throw contractError('stream.quota', 'ipc', 'electron-main-arbiter.outstanding-operations')
    }
    this.trimTerminalReplayLedger(accounting, prepared.totalBytes + prepared.replayKeyBytes, 1)
    const retainedAfterReservation = accounting.retainedBytes + prepared.totalBytes + prepared.replayKeyBytes
    if (retainedAfterReservation > this.authority.quota.maximumRetainedBytes) {
      throw contractError('stream.quota', 'ipc', 'electron-main-arbiter.retained-bytes')
    }
    accounting.replayLedger.set(prepared.replayKey, {
      byteLength: prepared.replayKeyBytes,
      state: 'in-flight'
    })
    if (reservesOperationSlot) {
      accounting.outstandingOperations += 1
    }
    accounting.retainedBytes = retainedAfterReservation
  }

  private markReplayTerminal(accounting: RendererAccounting<Attachment>, replayKey: string): void {
    const entry = accounting.replayLedger.get(replayKey)
    if (entry === undefined) {
      throw contractError('lifecycle.invariant-violation', 'ipc', 'electron-main-arbiter.replay-ledger')
    }
    entry.state = 'terminal'
  }

  /**
   * Retains settled replay keys only while their exact byte accounting fits the
   * configured renderer budget and the bounded LRU window. A Map's insertion
   * order gives us deterministic eviction without timers or delayed cleanup.
   */
  private trimTerminalReplayLedger(
    accounting: RendererAccounting<Attachment>,
    incomingBytes: number,
    incomingEntryCount: number
  ): void {
    while (
      accounting.replayLedger.size + incomingEntryCount > ElectronMainArbiterContext.maximumTerminalReplayEntries ||
      accounting.retainedBytes + incomingBytes > this.authority.quota.maximumRetainedBytes
    ) {
      const oldestTerminal = this.oldestTerminalReplayKey(accounting)
      if (oldestTerminal === null) {
        return
      }
      const entry = accounting.replayLedger.get(oldestTerminal)
      if (entry === undefined) {
        throw contractError('lifecycle.invariant-violation', 'ipc', 'electron-main-arbiter.replay-ledger')
      }
      accounting.replayLedger.delete(oldestTerminal)
      accounting.retainedBytes -= entry.byteLength
    }
  }

  private oldestTerminalReplayKey(accounting: RendererAccounting<Attachment>): string | null {
    for (const [key, entry] of accounting.replayLedger) {
      if (entry.state === 'terminal') {
        return key
      }
    }
    return null
  }
}

export interface ElectronRendererBoundary<Attachment extends string, Renderer extends string> {
  readonly identity: RendererIdentity<Attachment, Renderer>
  readonly events: BoundedAsyncStream<SerializableRecord>
  snapshot(): Promise<RendererSnapshot<Attachment, Renderer>>
}

function rendererIdentitiesEqual<Attachment extends string, Left extends string, Right extends string>(
  left: RendererIdentity<Attachment, Left>,
  right: RendererIdentity<Attachment, Right>
): boolean {
  return (
    left.clientId === right.clientId &&
    left.windowScope === right.windowScope &&
    left.sessionScope === right.sessionScope
  )
}

function snapshotRendererIdentity<Attachment extends string, Renderer extends string>(
  identity: RendererIdentity<Attachment, Renderer>
): RendererIdentity<Attachment, Renderer> {
  return Object.freeze({
    clientId: identity.clientId,
    windowScope: identity.windowScope,
    sessionScope: identity.sessionScope
  })
}

function operationReplayKey<Attachment extends string, Renderer extends string, Operation extends string>(
  envelope: IpcEnvelope<Attachment, Renderer, Operation>
): string {
  return `${String(envelope.rendererLease.leaseId)}\u0000${String(envelope.rendererLease.generation)}\u0000${String(
    envelope.correlation
  )}\u0000${String(envelope.dispatchEpoch)}`
}

function envelopeMetadataByteLength<Attachment extends string, Renderer extends string, Operation extends string>(
  envelope: IpcEnvelope<Attachment, Renderer, Operation>
): number {
  const strings = [
    envelope.command,
    String(envelope.attachmentId),
    String(envelope.attachment.backendInstanceId),
    String(envelope.attachment.backendGeneration),
    String(envelope.attachment.adapter.adapterId),
    String(envelope.attachment.adapter.adapterGeneration),
    String(envelope.renderer.clientId),
    envelope.renderer.windowScope,
    envelope.renderer.sessionScope,
    String(envelope.rendererLease.leaseId),
    String(envelope.rendererLease.generation),
    String(envelope.correlation),
    String(envelope.dispatchEpoch)
  ]
  let byteLength = 0
  for (const value of strings) {
    byteLength += utf8ByteLength(value)
  }
  return byteLength + ipcVersionsByteLength(envelope.versions)
}

function assertRendererLeaseMatches(actual: RendererLeaseIdentity, expected: RendererLeaseIdentity): void {
  if (actual.leaseId !== expected.leaseId || actual.generation !== expected.generation) {
    throw contractError('ownership.denied', 'ipc', 'electron-main-arbiter.renderer-lease')
  }
}

function assertRendererLeaseShape(lease: RendererLeaseIdentity): void {
  if (
    typeof lease !== 'object' ||
    lease === null ||
    typeof lease.leaseId !== 'string' ||
    lease.leaseId.length === 0 ||
    typeof lease.generation !== 'string' ||
    lease.generation.length === 0
  ) {
    throw contractError('protocol.malformed', 'ipc', 'electron-main-arbiter.renderer-lease')
  }
}

function snapshotRendererLease(lease: RendererLeaseIdentity): RendererLeaseIdentity {
  return Object.freeze({
    leaseId: lease.leaseId,
    generation: lease.generation
  })
}

function ipcVersionsByteLength(versions: IpcVersionAxes): number {
  return (
    negotiatedVersionByteLength(versions.backendContract) +
    negotiatedVersionByteLength(versions.capabilitySchema) +
    negotiatedVersionByteLength(versions.eventSchema) +
    negotiatedVersionByteLength(versions.traceFormat) +
    negotiatedVersionByteLength(versions.ipcProtocol)
  )
}

function negotiatedVersionByteLength<Axis extends string>(version: NegotiatedVersion<Axis>): number {
  return (
    utf8ByteLength(version.axis) +
    utf8ByteLength(String(version.selected.value)) +
    utf8ByteLength(String(version.localRange.minimum.value)) +
    utf8ByteLength(String(version.localRange.maximum.value)) +
    utf8ByteLength(String(version.remoteRange.minimum.value)) +
    utf8ByteLength(String(version.remoteRange.maximum.value))
  )
}

function ipcVersionsEqual(left: IpcVersionAxes, right: IpcVersionAxes): boolean {
  return (
    negotiatedVersionsEqual(left.backendContract, right.backendContract) &&
    negotiatedVersionsEqual(left.capabilitySchema, right.capabilitySchema) &&
    negotiatedVersionsEqual(left.eventSchema, right.eventSchema) &&
    negotiatedVersionsEqual(left.traceFormat, right.traceFormat) &&
    negotiatedVersionsEqual(left.ipcProtocol, right.ipcProtocol)
  )
}

function negotiatedVersionsEqual<Axis extends string>(
  left: NegotiatedVersion<Axis>,
  right: NegotiatedVersion<Axis>
): boolean {
  return (
    left.axis === right.axis &&
    left.selected.axis === right.selected.axis &&
    left.selected.value === right.selected.value &&
    left.localRange.axis === right.localRange.axis &&
    left.localRange.minimum.axis === right.localRange.minimum.axis &&
    left.localRange.minimum.value === right.localRange.minimum.value &&
    left.localRange.maximum.axis === right.localRange.maximum.axis &&
    left.localRange.maximum.value === right.localRange.maximum.value &&
    left.remoteRange.axis === right.remoteRange.axis &&
    left.remoteRange.minimum.axis === right.remoteRange.minimum.axis &&
    left.remoteRange.minimum.value === right.remoteRange.minimum.value &&
    left.remoteRange.maximum.axis === right.remoteRange.maximum.axis &&
    left.remoteRange.maximum.value === right.remoteRange.maximum.value
  )
}

function snapshotArbiterAuthority<Attachment extends string>(
  authority: ElectronMainArbiterAuthority<Attachment>
): ElectronMainArbiterAuthority<Attachment> {
  return Object.freeze({
    attachment: snapshotAttachmentRecord(authority.attachment),
    versions: snapshotIpcVersionAxes(authority.versions),
    quota: Object.freeze({
      maximumMessageBytes: authority.quota.maximumMessageBytes,
      maximumOutstandingOperations: authority.quota.maximumOutstandingOperations,
      maximumRetainedBytes: authority.quota.maximumRetainedBytes
    })
  })
}

function snapshotAttachmentRecord<Attachment extends string>(
  attachment: AttachmentRecord<Attachment>
): AttachmentRecord<Attachment> {
  return Object.freeze({
    attachmentId: attachment.attachmentId,
    backendInstanceId: attachment.backendInstanceId,
    backendGeneration: attachment.backendGeneration,
    adapter: Object.freeze({
      adapterId: attachment.adapter.adapterId,
      displayName: attachment.adapter.displayName,
      state: Object.freeze({
        availability: attachment.adapter.state.availability,
        authorization: attachment.adapter.state.authorization,
        power: attachment.adapter.state.power,
        backendGeneration: attachment.adapter.state.backendGeneration,
        updatedAt: attachment.adapter.state.updatedAt,
        safeReason: attachment.adapter.state.safeReason
      }),
      adapterGeneration: attachment.adapter.adapterGeneration,
      limitations: Object.freeze([...attachment.adapter.limitations])
    })
  })
}

function snapshotIpcVersionAxes(versions: IpcVersionAxes): IpcVersionAxes {
  return Object.freeze({
    backendContract: snapshotNegotiatedVersion(versions.backendContract),
    capabilitySchema: snapshotNegotiatedVersion(versions.capabilitySchema),
    eventSchema: snapshotNegotiatedVersion(versions.eventSchema),
    traceFormat: snapshotNegotiatedVersion(versions.traceFormat),
    ipcProtocol: snapshotNegotiatedVersion(versions.ipcProtocol)
  })
}

function snapshotNegotiatedVersion<Axis extends string>(version: NegotiatedVersion<Axis>): NegotiatedVersion<Axis> {
  return Object.freeze({
    axis: version.axis,
    selected: Object.freeze({ axis: version.selected.axis, value: version.selected.value }),
    localRange: Object.freeze({
      axis: version.localRange.axis,
      minimum: Object.freeze({ axis: version.localRange.minimum.axis, value: version.localRange.minimum.value }),
      maximum: Object.freeze({ axis: version.localRange.maximum.axis, value: version.localRange.maximum.value })
    }),
    remoteRange: Object.freeze({
      axis: version.remoteRange.axis,
      minimum: Object.freeze({ axis: version.remoteRange.minimum.axis, value: version.remoteRange.minimum.value }),
      maximum: Object.freeze({ axis: version.remoteRange.maximum.axis, value: version.remoteRange.maximum.value })
    })
  })
}
