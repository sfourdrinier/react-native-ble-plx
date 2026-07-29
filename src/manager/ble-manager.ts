// src/manager/ble-manager.ts

import { BackendContractError, contractError } from '../backend-contract/errors'
import { assertAttachedBackend, attachBackend } from '../backend-contract/backend'
import type {
  AdapterStateSnapshot,
  BackendIdentity,
  BackendProvider,
  ManagerConstruction,
  OwnerMode
} from '../backend-contract'
import type { AdvertisementObservation, ScanOptions } from '../backend-contract/advertisement'
import type { CleanupRecord } from '../backend-contract/errors'
import type { CharacteristicPath, DescriptorPath, GattDatabase, NotificationValue } from '../backend-contract/gatt'
import type { AdapterSelection } from '../backend-contract/identity'
import type {
  PublicOperationOptions,
  SubscriptionOptions,
  WritePolicy,
  WriteReceipt
} from '../backend-contract/operations'
import type { AttachmentId, BackendCompatibilityOffer, OwnedBytes, PeerId } from '../backend-contract/primitives'
import type { MtuNegotiation, RssiMeasurement } from '../backend-contract/connection-controls'
import type { AttachedBackend, BleCentralBackend, OwningManagerConstruction } from '../backend-contract/backend'
import type { BoundedAsyncStream } from '../backend-contract/streams'
import type { RestorationAdoptionRequest, RestorationAdoptionResult } from '../backend-contract/restoration'
import { DEFAULT_CORE_MAXIMUM_VALUE_BYTES, UnifiedBleCore } from '../core/unified-ble-core'
import type { CoreScanSession, UnifiedBleCoreOptions } from '../core/unified-ble-core'
import { CoreConnection, CoreGattDatabase } from '../core/core-gatt-handles'
import { CoreSubscription } from '../core/subscription-registry'
import {
  assertOwnershipRoleTransitionCapability,
  issueManagerOwnershipAuthority,
  ManagerOwnershipAuthority,
  type OwnershipRoleTransitionCapability,
  type OwnershipTransferGrant
} from './manager-ownership-authority'

const constructedBleManagerOwnershipParticipants = new WeakSet<object>()

/** Internal non-enrolling bridge used by the authority to verify actual BleManager construction. */
export function isConstructedBleManagerOwnershipParticipant(participant: object): boolean {
  return constructedBleManagerOwnershipParticipants.has(participant)
}

type CurrentCharacteristicPath<Attachment extends string> = CharacteristicPath<
  Attachment,
  string,
  string,
  string,
  string,
  'current'
>

type CurrentDescriptorPath<Attachment extends string> = DescriptorPath<
  Attachment,
  string,
  string,
  string,
  string,
  string,
  'current'
>

export interface BleManagerOptions {
  readonly now: () => number
  readonly maximumValueBytes: UnifiedBleCoreOptions['maximumValueBytes']
  readonly maximumAggregateRetainedBytes: number
  readonly traceMaximumRecords: number
  readonly traceMaximumBytes: number
}

export interface ProviderBleManagerConstruction<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>
> {
  readonly provider: BackendProvider<Attachment, Identity>
  readonly selection: AdapterSelection<Attachment>
  readonly coreCompatibility: BackendCompatibilityOffer
  readonly manager: Omit<OwningManagerConstruction<Attachment, Identity>, 'attachedBackend'>
}

export interface BackendBleManagerConstruction<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>
> {
  readonly coreCompatibility: BackendCompatibilityOffer
  readonly manager: Omit<OwningManagerConstruction<Attachment, Identity>, 'attachedBackend'>
}

/**
 * Host-neutral public manager. Construction is explicit and delegates all
 * shared policy to UnifiedBleCore; it neither detects a host nor creates a
 * singleton or physical adapter owner on import.
 */
export class BleManager<Attachment extends string, Identity extends BackendIdentity<Attachment>> {
  private resourceReleaseResult: Promise<CleanupRecord> | null = null
  private destroyResult: Promise<CleanupRecord> | null = null
  private ownershipMode: OwnerMode

  private constructor(
    private readonly core: UnifiedBleCore<Attachment, Identity>,
    private readonly ownershipAuthority: ManagerOwnershipAuthority<Attachment, Identity>
  ) {
    if (!(core instanceof UnifiedBleCore)) {
      throw contractError('argument.invalid', 'core', 'ble-manager.constructor.core')
    }
    if (!(ownershipAuthority instanceof ManagerOwnershipAuthority)) {
      throw contractError('argument.invalid', 'core', 'ble-manager.constructor.ownership-authority')
    }
    this.ownershipMode = core.construction.ownerMode
  }

  get state(): UnifiedBleCore<Attachment, Identity>['state'] {
    return this.core.state
  }

  get identity(): Identity {
    return this.core.identity
  }

  get attachmentId(): AttachmentId<Attachment> {
    return this.core.attachmentId
  }

  get managerId(): ManagerConstruction<Attachment, Identity>['managerId'] {
    return this.core.construction.managerId
  }

  get clientId(): ManagerConstruction<Attachment, Identity>['clientId'] {
    return this.core.construction.clientId
  }

  get ownerMode(): OwnerMode {
    return this.ownershipMode
  }

  get attachedBackend(): AttachedBackend<Attachment, Identity> {
    return this.core.construction.attachedBackend
  }

  get features() {
    return this.core.backend.features
  }

  /** Explicitly consumes the active provider's bounded native restoration journal. */
  adoptRestoration(request: RestorationAdoptionRequest<Attachment>): Promise<RestorationAdoptionResult<Attachment>> {
    if (this.core.state !== 'ready') {
      throw contractError('lifecycle.destroyed', 'restoration', 'ble-manager.adopt-restoration')
    }
    const restoration = this.core.construction.restoration
    if (restoration === undefined) {
      throw contractError('capability.unsupported', 'restoration', 'ble-manager.adopt-restoration')
    }
    return restoration.coordinator.adopt(restoration.client, request)
  }

  static async create<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
    construction: ManagerConstruction<Attachment, Identity>,
    ownershipAuthority: ManagerOwnershipAuthority<Attachment, Identity>,
    options: BleManagerOptions
  ): Promise<BleManager<Attachment, Identity>> {
    if (construction.restoration !== undefined && construction.restoration.client.clientId !== construction.clientId) {
      throw contractError('ownership.denied', 'restoration', 'ble-manager.create.restoration-client')
    }
    const core = await UnifiedBleCore.attach(construction, options)
    const manager = new BleManager(core, ownershipAuthority)
    constructedBleManagerOwnershipParticipants.add(manager)
    try {
      assertAttachedBackend(manager.attachedBackend)
      ownershipAuthority.register(manager)
      return manager
    } catch (error) {
      const cleanup = await core.releaseResources()
      if (cleanup.state === 'release-failed') {
        console.error('[BleManager.create] Manager admission cleanup failed:', cleanup.failures)
      }
      if (error instanceof BackendContractError) {
        throw error
      }
      throw contractError('platform.failure', 'core', 'ble-manager.create')
    }
  }

  async scan(options: ScanOptions<Attachment, string>): Promise<ScanSession<Attachment>> {
    return new ScanSession(await this.core.scan(options))
  }

  async connect(
    peerId: PeerId<Attachment>,
    options: PublicOperationOptions
  ): Promise<Connection<Attachment, Identity>> {
    return new Connection(await this.core.connect(peerId, options))
  }

  destroy(): Promise<CleanupRecord> {
    if (this.destroyResult === null) {
      const destruction = this.ownerMode === 'owning' ? this.destroyOwningManager() : this.destroyBorrowingManager()
      this.destroyResult = retryableCleanup(destruction, () => {
        this.destroyResult = null
      })
    }
    return this.destroyResult
  }

  traces() {
    return this.core.traces()
  }

  localResourceCounters() {
    return this.core.localResourceCounters()
  }

  adapterState(): Promise<AdapterStateSnapshot<Attachment>> {
    return this.core.adapterState()
  }

  /** Called only by the explicit authority during settled owner revocation. */
  revokeForOwnerDestroy(): Promise<CleanupRecord> {
    return this.releaseOwnedResources()
  }

  /** Settles this owner's resources, then atomically hands backend authority to an accepted borrower. */
  async transferOwnership(grant: OwnershipTransferGrant<Attachment>): Promise<CleanupRecord> {
    this.ownershipAuthority.verifyTransferGrant(this.managerId, grant)
    const cleanup = await this.releaseOwnedResources()
    if (cleanup.state === 'release-failed') {
      return cleanup
    }
    this.ownershipAuthority.consumeTransferGrant(this.managerId, grant)
    return cleanup
  }

  acceptsOwnershipTransfer(): boolean {
    return this.core.state === 'ready' && this.ownershipMode === 'borrowing'
  }

  becomeOwnershipTransferDestination(capability: OwnershipRoleTransitionCapability): void {
    assertOwnershipRoleTransitionCapability(capability)
    if (this.ownershipMode !== 'borrowing') {
      throw contractError('ownership.denied', 'core', 'ble-manager.transfer-destination')
    }
    this.ownershipMode = 'owning'
  }

  relinquishOwnershipTransferSource(capability: OwnershipRoleTransitionCapability): void {
    assertOwnershipRoleTransitionCapability(capability)
    if (this.ownershipMode !== 'owning') {
      throw contractError('ownership.denied', 'core', 'ble-manager.transfer-relinquish')
    }
    this.ownershipMode = 'borrowing'
  }

  private releaseOwnedResources(): Promise<CleanupRecord> {
    if (this.resourceReleaseResult === null) {
      this.resourceReleaseResult = retryableCleanup(this.core.releaseResources(), () => {
        this.resourceReleaseResult = null
      })
    }
    return this.resourceReleaseResult
  }

  private async destroyBorrowingManager(): Promise<CleanupRecord> {
    const cleanup = await this.releaseOwnedResources()
    if (cleanup.state === 'released') {
      this.ownershipAuthority.unregister(this.managerId)
    }
    return cleanup
  }

  private async destroyOwningManager(): Promise<CleanupRecord> {
    const ownCleanup = await this.releaseOwnedResources()
    if (ownCleanup.state === 'release-failed') {
      return ownCleanup
    }
    const borrowerCleanup = await this.ownershipAuthority.revokeBorrowers(this.managerId)
    if (borrowerCleanup.state === 'release-failed') {
      return borrowerCleanup
    }
    const backendCleanup = await this.core.destroyBackend()
    if (backendCleanup.state === 'released') {
      this.ownershipAuthority.unregister(this.managerId)
    }
    return backendCleanup
  }
}

/** Explicitly creates a manager from a selected provider adapter. */
export async function createBleManagerFromProvider<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>
>(
  construction: ProviderBleManagerConstruction<Attachment, Identity>,
  options: BleManagerOptions
): Promise<BleManager<Attachment, Identity>> {
  const backend = await construction.provider.create(construction.selection)
  return createBleManagerFromBackend(
    backend,
    {
      coreCompatibility: construction.coreCompatibility,
      manager: construction.manager
    },
    options,
    construction.selection.selectedAdapterId
  )
}

/** Creates an owning manager for a host backend that has already been selected. */
export async function createBleManagerFromBackend<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>
>(
  backend: BleCentralBackend<Attachment, Identity>,
  construction: BackendBleManagerConstruction<Attachment, Identity>,
  options: BleManagerOptions,
  expectedAdapterId?: AdapterSelection<Attachment>['selectedAdapterId']
): Promise<BleManager<Attachment, Identity>> {
  try {
    if (expectedAdapterId !== undefined && expectedAdapterId !== backend.identity.attachment.adapter.adapterId) {
      throw contractError('argument.invalid', 'adapter', 'ble-manager.create-from-provider.adapter-selection')
    }
    const attachedBackend = await attachBackend(backend, construction.coreCompatibility)
    if (
      expectedAdapterId !== undefined &&
      expectedAdapterId !== attachedBackend.attachment.attachment.adapter.adapterId
    ) {
      throw contractError('argument.invalid', 'adapter', 'ble-manager.create-from-provider.adapter-selection')
    }
    const authority = createManagerOwnershipAuthority(attachedBackend)
    return await BleManager.create({ ...construction.manager, attachedBackend }, authority, options)
  } catch (error) {
    const cleanup = await destroyUnadmittedBackend(backend)
    console.error('[createBleManagerFromProvider] Backend attachment or manager admission failed:', { error, cleanup })
    if (cleanup.state === 'release-failed') {
      const primary =
        error instanceof BackendContractError
          ? error.normalized.code
          : contractError('platform.failure', 'core', 'ble-manager.create-from-provider').normalized.code
      throw contractError('platform.failure', 'cleanup', 'ble-manager.create-from-provider.cleanup', {
        domain: 'manager',
        code: 'admission-and-cleanup-failed',
        safeMessage: 'Backend manager admission failed and unadmitted backend cleanup did not complete.',
        metadata: { primaryCode: primary, cleanupFailureCount: cleanup.failures.length }
      })
    }
    if (error instanceof BackendContractError) {
      throw error
    }
    throw contractError('platform.failure', 'core', 'ble-manager.create-from-provider')
  }
}

/** Performs the one manager-neutral attachment handshake for a selected backend. */
export function attachBleBackend<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  backend: AttachedBackend<Attachment, Identity>['backend'],
  coreCompatibility: BackendCompatibilityOffer
): Promise<AttachedBackend<Attachment, Identity>> {
  return attachBackend(backend, coreCompatibility)
}

/** Creates the explicit per-attachment authority shared by logical managers. */
export function createManagerOwnershipAuthority<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>
>(attachedBackend: AttachedBackend<Attachment, Identity>): ManagerOwnershipAuthority<Attachment, Identity> {
  assertAttachedBackend(attachedBackend)
  return issueManagerOwnershipAuthority(attachedBackend)
}

/** Explicitly creates a manager from a backend that has already been selected by its host/provider. */
export function createBleManager<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  construction: ManagerConstruction<Attachment, Identity>,
  ownershipAuthority: ManagerOwnershipAuthority<Attachment, Identity>,
  options: BleManagerOptions
): Promise<BleManager<Attachment, Identity>> {
  return BleManager.create(construction, ownershipAuthority, options)
}

async function destroyUnadmittedBackend<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  backend: BleCentralBackend<Attachment, Identity>
): Promise<CleanupRecord> {
  try {
    const cleanup = await backend.destroy()
    if (cleanup.state === 'release-failed') {
      console.error('[createBleManagerFromProvider] Unadmitted backend cleanup reported failures:', cleanup.failures)
    }
    return cleanup
  } catch (error) {
    console.error('[createBleManagerFromProvider] Unadmitted backend destroy rejected:', error)
    return {
      state: 'release-failed',
      failures: [
        {
          resourceKind: 'backend',
          error: contractError('platform.failure', 'cleanup', 'ble-manager.create-from-provider.backend-destroy')
            .normalized
        }
      ]
    }
  }
}

function retryableCleanup(cleanup: Promise<CleanupRecord>, onIncomplete: () => void): Promise<CleanupRecord> {
  return cleanup.then(
    result => {
      if (result.state === 'release-failed') {
        onIncomplete()
      }
      return result
    },
    error => {
      onIncomplete()
      throw error
    }
  )
}

export class ScanSession<Attachment extends string> {
  constructor(private readonly session: CoreScanSession<Attachment>) {}

  get scanSessionId(): CoreScanSession<Attachment>['scanSessionId'] {
    return this.session.scanSessionId
  }

  get leaseId(): CoreScanSession<Attachment>['leaseId'] {
    return this.session.leaseId
  }

  get shareToken(): CoreScanSession<Attachment>['shareToken'] {
    return this.session.shareToken
  }

  get observations(): BoundedAsyncStream<AdvertisementObservation<Attachment>> {
    return this.session.observations
  }

  stop(): Promise<CleanupRecord> {
    return this.session.stop()
  }
}

export class Connection<Attachment extends string, Identity extends BackendIdentity<Attachment>> {
  constructor(private readonly connection: CoreConnection<Attachment, Identity>) {}

  get peerId(): PeerId<Attachment> {
    return this.connection.resource.peerId
  }

  get connectionId() {
    return this.connection.resource.connectionId
  }

  get connectionGeneration() {
    return this.connection.resource.connectionGeneration
  }

  async discover(options: PublicOperationOptions): Promise<DiscoveredGattDatabase<Attachment, Identity>> {
    return new DiscoveredGattDatabase(await this.connection.discover(options))
  }

  release(): Promise<CleanupRecord> {
    return this.connection.release()
  }

  disconnect(): Promise<CleanupRecord> {
    return this.connection.disconnect()
  }

  readRssi(options: PublicOperationOptions): Promise<RssiMeasurement<Attachment, string>> {
    return this.connection.readRssi(options)
  }

  requestMtu(requestedMtu: number, options: PublicOperationOptions): Promise<MtuNegotiation<Attachment, string>> {
    return this.connection.requestMtu(requestedMtu, options)
  }
}

export class DiscoveredGattDatabase<Attachment extends string, Identity extends BackendIdentity<Attachment>> {
  constructor(private readonly database: CoreGattDatabase<Attachment, Identity>) {}

  get path() {
    return this.database.path
  }

  snapshot(): ReturnType<GattDatabase<Attachment, string, string>['snapshot']> {
    return this.database.snapshot()
  }

  read(path: CurrentCharacteristicPath<Attachment>, options: PublicOperationOptions): Promise<OwnedBytes> {
    return this.database.read(path, options)
  }

  write(
    path: CurrentCharacteristicPath<Attachment>,
    bytes: Readonly<Uint8Array>,
    options: WritePolicy
  ): Promise<WriteReceipt<Attachment, string>> {
    return this.database.write(path, bytes, options)
  }

  readDescriptor(path: CurrentDescriptorPath<Attachment>, options: PublicOperationOptions): Promise<OwnedBytes> {
    return this.database.readDescriptor(path, options)
  }

  writeDescriptor(
    path: CurrentDescriptorPath<Attachment>,
    bytes: Readonly<Uint8Array>,
    options: WritePolicy
  ): Promise<WriteReceipt<Attachment, string>> {
    return this.database.writeDescriptor(path, bytes, options)
  }

  async subscribe(
    path: CurrentCharacteristicPath<Attachment>,
    options: SubscriptionOptions
  ): Promise<Subscription<Attachment, Identity>> {
    return new Subscription(await this.database.subscribe(path, options))
  }
}

export class Subscription<Attachment extends string, Identity extends BackendIdentity<Attachment>> {
  constructor(private readonly subscription: CoreSubscription<Attachment, Identity>) {}

  get subscriptionId() {
    return this.subscription.subscriptionId
  }

  get path(): CurrentCharacteristicPath<Attachment> {
    return this.subscription.path
  }

  get values(): BoundedAsyncStream<NotificationValue> {
    return this.subscription.values
  }

  remove(): Promise<CleanupRecord> {
    return this.subscription.remove()
  }
}

export const DEFAULT_BLE_MANAGER_OPTIONS: BleManagerOptions = {
  now: () => {
    if (globalThis.performance === undefined) {
      throw contractError('capability.unavailable', 'core', 'ble-manager.monotonic-clock')
    }
    return globalThis.performance.now()
  },
  maximumValueBytes: DEFAULT_CORE_MAXIMUM_VALUE_BYTES,
  maximumAggregateRetainedBytes: 4 * 1024 * 1024,
  traceMaximumRecords: 256,
  traceMaximumBytes: 512 * 1024
}
