// src/tck/deterministic/deterministic-tck-manager-ownership.ts

import type { AttachedBackend } from '../../backend-contract/backend'
import { BackendContractError } from '../../backend-contract/errors'
import type { HostNeutralBackendIdentity } from '../../backend-contract/identity'
import {
  opaqueId,
  version,
  versionRange,
  type BackendCompatibilityOffer,
  type PeerId,
  type SerializableRecord
} from '../../backend-contract/primitives'
import {
  attachBleBackend,
  BleManager,
  createManagerOwnershipAuthority,
  DEFAULT_BLE_MANAGER_OPTIONS
} from '../../manager/ble-manager'
import { ManagerOwnershipAuthority, type OwnershipTransferGrant } from '../../manager/manager-ownership-authority'
import {
  createDeterministicTestBackend,
  type DeterministicBackendFixture
} from '../../testing/deterministic/deterministic-test-backend'
import type { TckFact } from '../contracts'

type DeterministicAttachedBackend = AttachedBackend<string, HostNeutralBackendIdentity<string>>
type DeterministicManager = BleManager<string, HostNeutralBackendIdentity<string>>
type DeterministicAuthority = ManagerOwnershipAuthority<string>
type OwnerScopedProof = SerializableRecord & {
  readonly ownerConnectionRetained: boolean
  readonly borrowerDenied: boolean
  readonly borrowerReleased: boolean
  readonly ownerRemainedReady: boolean
  readonly ownerOperationRetained: boolean
  readonly ownerContinued: boolean
}
type TransferProof = SerializableRecord & {
  readonly borrowerTransferDenied: boolean
  readonly forgedGrantRejected: boolean
  readonly replayRejected: boolean
  readonly transferred: boolean
}
type RevocationProof = SerializableRecord & { readonly borrowerRevokedBeforeBorrowerDestroy: boolean }

const compatibility: BackendCompatibilityOffer = {
  backendContract: versionRange(version('backend-contract', 1), version('backend-contract', 1)),
  capabilitySchema: versionRange(version('capability-schema', 1), version('capability-schema', 1)),
  eventSchema: versionRange(version('event-schema', 1), version('event-schema', 1)),
  traceFormat: versionRange(version('trace-format', 1), version('trace-format', 1))
}

/** Proves logical manager ownership against G2's authority, never the raw backend fixture. */
export async function deterministicManagerOwnershipFacts(): Promise<readonly TckFact[]> {
  const sharing = await proveOwnerScopedBorrowing()
  const transfer = await proveAuthenticatedTransfer()
  const revocation = await proveSettledBorrowerRevocation()
  return [
    fact('connection-leases-are-owner-scoped', sharing.ownerConnectionRetained && sharing.borrowerDenied, sharing),
    fact(
      'connection-borrowing-cannot-destroy-or-cancel-owner-work',
      sharing.borrowerReleased &&
        sharing.ownerConnectionRetained &&
        sharing.ownerRemainedReady &&
        sharing.ownerOperationRetained &&
        sharing.ownerContinued,
      sharing
    ),
    fact(
      'connection-transfer-and-revocation-are-authenticated',
      transfer.borrowerTransferDenied &&
        transfer.forgedGrantRejected &&
        transfer.replayRejected &&
        transfer.transferred &&
        revocation.borrowerRevokedBeforeBorrowerDestroy,
      { ...transfer, ...revocation }
    )
  ]
}

async function proveOwnerScopedBorrowing(): Promise<OwnerScopedProof> {
  const context = await createManagerContext()
  const owner = await createOwningManager(context.attachedBackend, context.authority, 1)
  const borrower = await createBorrowingManager(context.attachedBackend, context.authority, 2)
  try {
    const firstConnection = await settle(context.fixture, owner.connect(peerId(), operationOptions()))
    const borrowerDenied = await settlesWithCode(
      context.fixture,
      borrower.connect(peerId(), operationOptions()),
      'connection.already-owned'
    )
    const borrowerCleanup = await settle(context.fixture, borrower.destroy())
    const ownerRemainedReady = owner.state === 'ready'
    const ownerConnectionRetained = Number(context.fixture.backend.resourceCounters().connectionLeases) === 1
    const discovered = await settle(context.fixture, firstConnection.discover(operationOptions()))
    const ownerOperationRetained = (await discovered.snapshot()).characteristics.length > 0
    await settle(context.fixture, firstConnection.release())
    const continuedConnection = await settle(context.fixture, owner.connect(peerId(), operationOptions()))
    const continuedCleanup = await settle(context.fixture, continuedConnection.release())
    const ownerCleanup = await settle(context.fixture, owner.destroy())
    return {
      ownerConnectionRetained,
      borrowerDenied,
      borrowerReleased: borrowerCleanup.state === 'released',
      ownerRemainedReady,
      ownerOperationRetained,
      ownerContinued: continuedCleanup.state === 'released' && ownerCleanup.state === 'released'
    }
  } finally {
    await settle(context.fixture, context.fixture.backend.destroy())
  }
}

async function proveAuthenticatedTransfer(): Promise<TransferProof> {
  const context = await createManagerContext()
  const owner = await createOwningManager(context.attachedBackend, context.authority, 3)
  const borrower = await createBorrowingManager(context.attachedBackend, context.authority, 4)
  try {
    const authorityGrant = context.authority.issueTransferGrant(owner.managerId, borrower.managerId)
    const borrowerTransferDenied = await settlesWithCode(
      context.fixture,
      borrower.transferOwnership(authorityGrant),
      'ownership.denied'
    )
    const foreignGrant = await createForeignAuthorityGrant()
    let forgedGrantRejected = false
    try {
      forgedGrantRejected = await settlesWithCode(
        context.fixture,
        owner.transferOwnership(foreignGrant.grant),
        'ownership.denied'
      )
    } finally {
      await foreignGrant.release()
    }
    const ownerCleanup = await settle(context.fixture, owner.transferOwnership(authorityGrant))
    const replayRejected = await settlesWithCode(
      context.fixture,
      owner.transferOwnership(authorityGrant),
      'ownership.denied'
    )
    const transferred =
      ownerCleanup.state === 'released' && owner.state === 'destroyed' && borrower.ownerMode === 'owning'
    await settle(context.fixture, borrower.destroy())
    return { borrowerTransferDenied, forgedGrantRejected, replayRejected, transferred }
  } finally {
    await settle(context.fixture, context.fixture.backend.destroy())
  }
}

async function createForeignAuthorityGrant(): Promise<{
  readonly grant: OwnershipTransferGrant<string>
  release(): Promise<void>
}> {
  const context = await createManagerContext()
  const owner = await createOwningManager(context.attachedBackend, context.authority, 7)
  const borrower = await createBorrowingManager(context.attachedBackend, context.authority, 8)
  const grant = context.authority.issueTransferGrant(owner.managerId, borrower.managerId)
  return {
    grant,
    release: async () => {
      await settle(context.fixture, owner.destroy())
      await settle(context.fixture, context.fixture.backend.destroy())
    }
  }
}

async function proveSettledBorrowerRevocation(): Promise<RevocationProof> {
  const context = await createManagerContext()
  const owner = await createOwningManager(context.attachedBackend, context.authority, 5)
  const borrower = await createBorrowingManager(context.attachedBackend, context.authority, 6)
  try {
    const ownerCleanup = await settle(context.fixture, owner.destroy())
    const borrowerRevokedBeforeBorrowerDestroy = ownerCleanup.state === 'released' && borrower.state === 'destroyed'
    const borrowerCleanup = await settle(context.fixture, borrower.destroy())
    return {
      borrowerRevokedBeforeBorrowerDestroy: borrowerRevokedBeforeBorrowerDestroy && borrowerCleanup.state === 'released'
    }
  } finally {
    await settle(context.fixture, context.fixture.backend.destroy())
  }
}

async function createManagerContext(): Promise<{
  readonly fixture: DeterministicBackendFixture
  readonly attachedBackend: DeterministicAttachedBackend
  readonly authority: DeterministicAuthority
}> {
  const fixture = createDeterministicTestBackend()
  const attachedBackend = await attachBleBackend(fixture.backend, compatibility)
  return { fixture, attachedBackend, authority: createManagerOwnershipAuthority(attachedBackend) }
}

function createOwningManager(
  attachedBackend: DeterministicAttachedBackend,
  authority: DeterministicAuthority,
  ordinal: number
): Promise<DeterministicManager> {
  return BleManager.create(
    {
      attachedBackend,
      clientId: opaqueId(`owner-client-${ordinal}`, 'client', `deterministic:${ordinal}`),
      managerId: opaqueId(`owner-manager-${ordinal}`, 'manager', `deterministic:${ordinal}`),
      ownerMode: 'owning'
    },
    authority,
    DEFAULT_BLE_MANAGER_OPTIONS
  )
}

function createBorrowingManager(
  attachedBackend: DeterministicAttachedBackend,
  authority: DeterministicAuthority,
  ordinal: number
): Promise<DeterministicManager> {
  return BleManager.create(
    {
      attachedBackend,
      clientId: opaqueId(`borrower-client-${ordinal}`, 'client', `deterministic:${ordinal}`),
      managerId: opaqueId(`borrower-manager-${ordinal}`, 'manager', `deterministic:${ordinal}`),
      ownerMode: 'borrowing'
    },
    authority,
    DEFAULT_BLE_MANAGER_OPTIONS
  )
}

function peerId(): PeerId<string> {
  return opaqueId('deterministic-peer', 'peer', 'deterministic')
}

function operationOptions() {
  return { signal: null, deadline: null }
}

async function settle<Value>(fixture: DeterministicBackendFixture, promise: Promise<Value>): Promise<Value> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    fixture.controller.clock.runUntilIdle()
    await Promise.resolve()
  }
  return promise
}

async function settlesWithCode<Value>(
  fixture: DeterministicBackendFixture,
  promise: Promise<Value>,
  code: string
): Promise<boolean> {
  const observation = promise.then(
    () => false,
    error => error instanceof BackendContractError && error.normalized.code === code
  )
  return settle(fixture, observation)
}

function fact(id: TckFact['id'], holds: boolean, detail: SerializableRecord): TckFact {
  return { id, holds, detail }
}
