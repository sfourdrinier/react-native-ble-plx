// src/manager/manager-ownership-authority.ts

import { assertAttachedBackend } from '../backend-contract/backend'
import type { AttachedBackend, OwnerMode } from '../backend-contract/backend'
import { contractError } from '../backend-contract/errors'
import type { CleanupFailure, CleanupRecord } from '../backend-contract/errors'
import { attachmentRecordsEqual, type AttachmentRecord, type BackendIdentity } from '../backend-contract/identity'
import type { ManagerId } from '../backend-contract/primitives'
import { isConstructedBleManagerOwnershipParticipant } from './ble-manager'

const authorityIssuanceToken = Symbol('manager-ownership-authority-issuance')
const authoritiesByReceipt = new WeakMap<object, object>()
const issuedRoleTransitionCapabilities = new WeakSet<object>()

export class OwnershipRoleTransitionCapability {
  private readonly capabilityMarker = true

  constructor(issuanceToken: symbol) {
    if (issuanceToken !== authorityIssuanceToken || !this.capabilityMarker) {
      throw contractError('ownership.denied', 'core', 'manager-ownership-authority.role-capability')
    }
    issuedRoleTransitionCapabilities.add(this)
    Object.freeze(this)
  }
}

export function assertOwnershipRoleTransitionCapability(capability: OwnershipRoleTransitionCapability): void {
  if (!issuedRoleTransitionCapabilities.has(capability)) {
    throw contractError('ownership.denied', 'core', 'manager-ownership-authority.role-capability')
  }
}

/**
 * Opaque, authority-issued proof for a single ownership hand-off. Its private
 * member prevents structural construction in TypeScript; the authority's
 * private WeakMap remains the runtime source of authenticity.
 */
export class OwnershipTransferGrant<Attachment extends string> {
  private readonly structuralProof = 'authority-issued-transfer-grant'
  private readonly attachmentBrand: Attachment | null = null

  hasOpaqueGrantShape(): boolean {
    return this.structuralProof === 'authority-issued-transfer-grant' && this.attachmentBrand === null
  }
}

interface IssuedTransferGrant<Attachment extends string> {
  readonly attachment: AttachmentRecord<Attachment>
  readonly sourceManagerId: ManagerId<Attachment, string>
  readonly destinationManagerId: ManagerId<Attachment, string>
  readonly transferEpoch: number
}

/** A manager admitted to the host-owned authority for one attached backend. */
export interface ManagerOwnershipParticipant<Attachment extends string, Identity extends BackendIdentity<Attachment>> {
  readonly managerId: ManagerId<Attachment, string>
  readonly ownerMode: OwnerMode
  readonly attachedBackend: AttachedBackend<Attachment, Identity>
  revokeForOwnerDestroy(): Promise<CleanupRecord>
  acceptsOwnershipTransfer(): boolean
  becomeOwnershipTransferDestination(capability: OwnershipRoleTransitionCapability): void
  relinquishOwnershipTransferSource(capability: OwnershipRoleTransitionCapability): void
}

/**
 * Host-owned authority for one complete backend attachment tuple. It admits
 * managers only when they bind to this exact backend and issues one-shot,
 * non-forgeable transfer grants instead of trusting caller-built records.
 */
export class ManagerOwnershipAuthority<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment> = BackendIdentity<Attachment>
> {
  private readonly participants = new Map<string, ManagerOwnershipParticipant<Attachment, Identity>>()
  private readonly issuedGrants = new WeakMap<OwnershipTransferGrant<Attachment>, IssuedTransferGrant<Attachment>>()
  private readonly consumedGrants = new WeakSet<OwnershipTransferGrant<Attachment>>()
  private readonly authorityAttachment: AttachmentRecord<Attachment>
  private readonly roleTransitionCapability: OwnershipRoleTransitionCapability
  private ownerManagerId: ManagerId<Attachment, string> | null = null
  private nextTransferEpoch: number | null = 1

  constructor(
    readonly attachedBackend: AttachedBackend<Attachment, Identity>,
    issuanceToken: symbol
  ) {
    if (issuanceToken !== authorityIssuanceToken || authoritiesByReceipt.has(attachedBackend)) {
      throw contractError('ownership.denied', 'core', 'manager-ownership-authority.issuance')
    }
    assertAttachedBackend(attachedBackend)
    this.authorityAttachment = snapshotAttachmentRecord(attachedBackend.attachment.attachment)
    this.roleTransitionCapability = new OwnershipRoleTransitionCapability(authorityIssuanceToken)
    authoritiesByReceipt.set(attachedBackend, this)
  }

  get attachment(): AttachmentRecord<Attachment> {
    return this.authorityAttachment
  }

  get attachmentId() {
    return this.attachment.attachmentId
  }

  register(participant: ManagerOwnershipParticipant<Attachment, Identity>): void {
    if (!isConstructedBleManagerOwnershipParticipant(participant)) {
      throw contractError('ownership.denied', 'core', 'manager-ownership-authority.participant-authentication')
    }
    this.assertParticipantAttachment(participant)
    const key = String(participant.managerId)
    if (this.participants.has(key)) {
      throw contractError('ownership.denied', 'core', 'manager-ownership-authority.duplicate-manager')
    }
    if (participant.ownerMode === 'owning') {
      if (this.ownerManagerId !== null) {
        throw contractError('ownership.denied', 'core', 'manager-ownership-authority.owner-exists')
      }
      this.ownerManagerId = participant.managerId
    } else if (this.ownerManagerId === null) {
      throw contractError('ownership.denied', 'core', 'manager-ownership-authority.borrower-without-owner')
    }
    this.participants.set(key, participant)
  }

  unregister(managerId: ManagerId<Attachment, string>): void {
    const participant = this.participants.get(String(managerId))
    if (participant === undefined) {
      return
    }
    this.participants.delete(String(managerId))
    if (participant.ownerMode === 'owning' && this.ownerManagerId === managerId) {
      this.ownerManagerId = null
    }
  }

  async revokeBorrowers(ownerManagerId: ManagerId<Attachment, string>): Promise<CleanupRecord> {
    if (this.ownerManagerId !== ownerManagerId) {
      throw contractError('ownership.denied', 'core', 'manager-ownership-authority.revoke')
    }
    const failures: CleanupFailure[] = []
    for (const participant of [...this.participants.values()]) {
      if (participant.ownerMode !== 'borrowing') {
        continue
      }
      const cleanup = await this.captureRevocation(participant)
      failures.push(...cleanup.failures)
      if (cleanup.state === 'released') {
        this.participants.delete(String(participant.managerId))
      }
    }
    return failures.length === 0 ? { state: 'released', failures: [] } : { state: 'release-failed', failures }
  }

  /** Issues a grant whose complete tuple and participants are fixed at issuance. */
  issueTransferGrant(
    sourceManagerId: ManagerId<Attachment, string>,
    destinationManagerId: ManagerId<Attachment, string>
  ): OwnershipTransferGrant<Attachment> {
    this.requireTransferParticipants(sourceManagerId, destinationManagerId)
    const transferEpoch = this.claimTransferEpoch()
    const grant = new OwnershipTransferGrant<Attachment>()
    this.issuedGrants.set(grant, {
      attachment: this.attachment,
      sourceManagerId,
      destinationManagerId,
      transferEpoch
    })
    return grant
  }

  /** Checks a grant before the source starts asynchronous resource release. */
  verifyTransferGrant(sourceManagerId: ManagerId<Attachment, string>, grant: OwnershipTransferGrant<Attachment>): void {
    this.requireTransferGrant(sourceManagerId, grant)
  }

  /** Consumes the one-shot grant before synchronously changing either owner role. */
  consumeTransferGrant(
    sourceManagerId: ManagerId<Attachment, string>,
    grant: OwnershipTransferGrant<Attachment>
  ): void {
    const issued = this.requireTransferGrant(sourceManagerId, grant)
    const { source, destination } = this.requireTransferParticipants(
      issued.sourceManagerId,
      issued.destinationManagerId
    )
    this.issuedGrants.delete(grant)
    this.consumedGrants.add(grant)
    destination.becomeOwnershipTransferDestination(this.roleTransitionCapability)
    source.relinquishOwnershipTransferSource(this.roleTransitionCapability)
    this.ownerManagerId = issued.destinationManagerId
    this.participants.delete(String(issued.sourceManagerId))
  }

  private async captureRevocation(
    participant: ManagerOwnershipParticipant<Attachment, Identity>
  ): Promise<CleanupRecord> {
    try {
      return await participant.revokeForOwnerDestroy()
    } catch (error) {
      console.error('[ManagerOwnershipAuthority.captureRevocation] Borrower resource release rejected:', error)
      return {
        state: 'release-failed',
        failures: [
          {
            resourceKind: 'manager',
            error: contractError('platform.failure', 'cleanup', 'manager-ownership-authority.revoke').normalized
          }
        ]
      }
    }
  }

  private claimTransferEpoch(): number {
    if (this.nextTransferEpoch === null) {
      throw contractError('lifecycle.invalid-state', 'core', 'manager-ownership-authority.transfer-epoch-exhausted')
    }
    const transferEpoch = this.nextTransferEpoch
    this.nextTransferEpoch = transferEpoch === Number.MAX_SAFE_INTEGER ? null : transferEpoch + 1
    return transferEpoch
  }

  private assertCurrentAttachment(): void {
    assertAttachedBackend(this.attachedBackend)
    if (!attachmentRecordsEqual(this.attachedBackend.attachment.attachment, this.authorityAttachment)) {
      throw contractError('protocol.violation', 'core', 'manager-ownership-authority.authority-attachment')
    }
  }

  private assertParticipantAttachment(participant: ManagerOwnershipParticipant<Attachment, Identity>): void {
    this.assertCurrentAttachment()
    assertAttachedBackend(participant.attachedBackend)
    const participantAttachment = participant.attachedBackend.attachment.attachment
    if (
      !attachmentRecordsEqual(participantAttachment, this.attachment) ||
      !attachmentRecordsEqual(
        participant.attachedBackend.backend.identity.attachment,
        this.attachedBackend.backend.identity.attachment
      )
    ) {
      throw contractError('protocol.violation', 'core', 'manager-ownership-authority.participant-attachment')
    }
  }

  private requireTransferGrant(
    sourceManagerId: ManagerId<Attachment, string>,
    grant: OwnershipTransferGrant<Attachment>
  ): IssuedTransferGrant<Attachment> {
    if (!(grant instanceof OwnershipTransferGrant) || !grant.hasOpaqueGrantShape()) {
      throw contractError('ownership.denied', 'core', 'manager-ownership-authority.transfer-grant')
    }
    if (this.consumedGrants.has(grant)) {
      throw contractError('ownership.denied', 'core', 'manager-ownership-authority.transfer-grant-replayed')
    }
    const issued = this.issuedGrants.get(grant)
    if (issued === undefined) {
      throw contractError('ownership.denied', 'core', 'manager-ownership-authority.transfer-grant')
    }
    this.assertCurrentAttachment()
    if (!attachmentRecordsEqual(issued.attachment, this.attachment)) {
      throw contractError('protocol.violation', 'core', 'manager-ownership-authority.transfer-grant-attachment')
    }
    if (issued.sourceManagerId !== sourceManagerId) {
      throw contractError('ownership.denied', 'core', 'manager-ownership-authority.transfer-source')
    }
    this.requireTransferParticipants(issued.sourceManagerId, issued.destinationManagerId)
    return issued
  }

  private requireTransferParticipants(
    sourceManagerId: ManagerId<Attachment, string>,
    destinationManagerId: ManagerId<Attachment, string>
  ): {
    readonly source: ManagerOwnershipParticipant<Attachment, Identity>
    readonly destination: ManagerOwnershipParticipant<Attachment, Identity>
  } {
    this.assertCurrentAttachment()
    if (this.ownerManagerId !== sourceManagerId) {
      throw contractError('ownership.denied', 'core', 'manager-ownership-authority.transfer-source')
    }
    if (sourceManagerId === destinationManagerId) {
      throw contractError('argument.invalid', 'core', 'manager-ownership-authority.transfer-self')
    }
    const source = this.participants.get(String(sourceManagerId))
    const destination = this.participants.get(String(destinationManagerId))
    if (
      source === undefined ||
      source.ownerMode !== 'owning' ||
      destination === undefined ||
      destination.ownerMode !== 'borrowing'
    ) {
      throw contractError('ownership.denied', 'core', 'manager-ownership-authority.transfer-participants')
    }
    this.assertParticipantAttachment(source)
    this.assertParticipantAttachment(destination)
    if (!destination.acceptsOwnershipTransfer()) {
      throw contractError('lifecycle.invalid-state', 'core', 'manager-ownership-authority.transfer-destination')
    }
    return { source, destination }
  }
}

export function issueManagerOwnershipAuthority<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  attachedBackend: AttachedBackend<Attachment, Identity>
): ManagerOwnershipAuthority<Attachment, Identity> {
  return new ManagerOwnershipAuthority(attachedBackend, authorityIssuanceToken)
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
