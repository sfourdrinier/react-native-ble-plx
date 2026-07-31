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
import type { CharacteristicPath, DescriptorPath, GattDatabaseSnapshot } from '../backend-contract/gatt'
import type { AdapterSelection } from '../backend-contract/identity'
import type { CapabilityDescriptor, FeatureId } from '../backend-contract/capabilities'
import type {
  PublicOperationOptions,
  SubscriptionOptions,
  WriteMode,
  WritePolicy
} from '../backend-contract/operations'
import type { AttachmentId, BackendCompatibilityOffer, PeerId } from '../backend-contract/primitives'
import { capacity, deadline } from '../backend-contract/primitives'
import type { AttachedBackend, BleCentralBackend, OwningManagerConstruction } from '../backend-contract/backend'
import type { BoundedAsyncStream } from '../backend-contract/streams'
import type { RestorationAdoptionRequest, RestorationAdoptionResult } from '../backend-contract/restoration'
import { DEFAULT_CORE_MAXIMUM_VALUE_BYTES, UnifiedBleCore } from '../core/unified-ble-core'
import type { CoreDeadlineHandle, CoreScanSession, UnifiedBleCoreOptions } from '../core/unified-ble-core'
import { CoreConnection, CoreGattDatabase } from '../core/core-gatt-handles'
import { CoreSubscription } from '../core/subscription-registry'
import {
  type BleConnectionHandle,
  type BleManagerLifetime,
  type DeadlineHandle,
  type DiscoveredGattDatabaseHandle,
  type PortableCurrentCharacteristicPath,
  type PortableCurrentDescriptorPath,
  type PortableOperationOptions,
  type PortableSubscriptionOptions,
  type PortableWritePolicy,
  type SubscriptionHandle
} from './consumer-handles'
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
  readonly timer?: UnifiedBleCoreOptions['timer']
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
export class BleManager<Attachment extends string, Identity extends BackendIdentity<Attachment>>
  implements BleManagerLifetime
{
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
    return this.core.features
  }

  /** True only where the instantiated backend/core registry exposes an invocable feature implementation. */
  supports(id: FeatureId): boolean {
    const descriptor = this.capability(id)
    return descriptor !== null && (descriptor.state === 'supported' || descriptor.state === 'limited')
  }

  /** Returns one immutable capability descriptor, or null when no registration exists. */
  capability(id: FeatureId): CapabilityDescriptor | null {
    for (const descriptor of this.features.descriptors) {
      if (descriptor.id === id) {
        return descriptor
      }
    }
    return null
  }

  /** Returns the immutable capability projection derived from negotiated registrations. */
  capabilities(): readonly CapabilityDescriptor[] {
    return this.features.descriptors
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

  monotonicNow(): number {
    return this.core.monotonicNow()
  }

  scheduleDeadline(deadlineAt: number, action: () => void): CoreDeadlineHandle {
    return this.core.scheduleDeadline(deadlineAt, action)
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

function toPublicOperationOptions(options: PortableOperationOptions): PublicOperationOptions {
  return {
    signal: options.signal,
    deadline: options.deadline === null ? null : deadline(options.deadline)
  }
}

function toPublicWritePolicy(options: PortableWritePolicy): WritePolicy {
  return { ...toPublicOperationOptions(options), mode: options.mode }
}

function toPublicSubscriptionOptions(options: PortableSubscriptionOptions): SubscriptionOptions {
  return {
    ...toPublicOperationOptions(options),
    delivery: {
      itemCapacity: capacity(options.delivery.itemCapacity),
      byteCapacity: capacity(options.delivery.byteCapacity),
      reservedControlCapacity: capacity(options.delivery.reservedControlCapacity),
      overflowPolicy: options.delivery.overflowPolicy
    }
  }
}

function attachmentMatches(
  current: CurrentCharacteristicPath<string>['attachment'],
  portable: PortableCurrentCharacteristicPath['attachment']
): boolean {
  return (
    current.attachmentId === portable.attachmentId &&
    current.backendInstanceId === portable.backendInstanceId &&
    current.backendGeneration === portable.backendGeneration &&
    current.adapter.adapterId === portable.adapter.adapterId &&
    current.adapter.displayName === portable.adapter.displayName &&
    current.adapter.adapterGeneration === portable.adapter.adapterGeneration &&
    current.adapter.state.availability === portable.adapter.state.availability &&
    current.adapter.state.authorization === portable.adapter.state.authorization &&
    current.adapter.state.power === portable.adapter.state.power &&
    current.adapter.state.backendGeneration === portable.adapter.state.backendGeneration &&
    current.adapter.state.updatedAt === portable.adapter.state.updatedAt &&
    current.adapter.state.safeReason === portable.adapter.state.safeReason &&
    current.adapter.limitations.length === portable.adapter.limitations.length &&
    current.adapter.limitations.every((limitation, index) => limitation === portable.adapter.limitations[index])
  )
}

function characteristicPathMatches<Attachment extends string>(
  current: CurrentCharacteristicPath<Attachment>,
  portable: PortableCurrentCharacteristicPath
): boolean {
  return (
    attachmentMatches(current.attachment, portable.attachment) &&
    current.attachmentId === portable.attachmentId &&
    current.peerId === portable.peerId &&
    current.connectionId === portable.connectionId &&
    current.ownerLeaseId === portable.ownerLeaseId &&
    current.connectionGeneration === portable.connectionGeneration &&
    current.databaseId === portable.databaseId &&
    current.databaseGeneration === portable.databaseGeneration &&
    current.serviceUuid === portable.serviceUuid &&
    current.serviceOccurrence === portable.serviceOccurrence &&
    current.characteristicUuid === portable.characteristicUuid &&
    current.characteristicOccurrence === portable.characteristicOccurrence &&
    current.validity === portable.validity
  )
}

function characteristicAddressMatches<Attachment extends string>(
  current: CurrentCharacteristicPath<Attachment>,
  portable: PortableCurrentCharacteristicPath
): boolean {
  return (
    current.serviceUuid === portable.serviceUuid &&
    current.serviceOccurrence === portable.serviceOccurrence &&
    current.characteristicUuid === portable.characteristicUuid &&
    current.characteristicOccurrence === portable.characteristicOccurrence
  )
}

function descriptorPathMatches<Attachment extends string>(
  current: CurrentDescriptorPath<Attachment>,
  portable: PortableCurrentDescriptorPath
): boolean {
  return (
    characteristicPathMatches(current, portable) &&
    current.descriptorUuid === portable.descriptorUuid &&
    current.descriptorOccurrence === portable.descriptorOccurrence
  )
}

function descriptorAddressMatches<Attachment extends string>(
  current: CurrentDescriptorPath<Attachment>,
  portable: PortableCurrentDescriptorPath
): boolean {
  return (
    characteristicAddressMatches(current, portable) &&
    current.descriptorUuid === portable.descriptorUuid &&
    current.descriptorOccurrence === portable.descriptorOccurrence
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

export class Connection<Attachment extends string, Identity extends BackendIdentity<Attachment>>
  implements BleConnectionHandle
{
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

  get events() {
    return this.connection.events
  }

  async discover(options: PortableOperationOptions): Promise<DiscoveredGattDatabase<Attachment, Identity>> {
    const database = await this.connection.discover(toPublicOperationOptions(options))
    return new DiscoveredGattDatabase(database, await database.snapshot())
  }

  release(): Promise<CleanupRecord> {
    return this.connection.release()
  }

  disconnect(): Promise<CleanupRecord> {
    return this.connection.disconnect()
  }

  readRssi(options: PortableOperationOptions) {
    return this.connection.readRssi(toPublicOperationOptions(options))
  }

  requestMtu(requestedMtu: number, options: PortableOperationOptions) {
    return this.connection.requestMtu(requestedMtu, toPublicOperationOptions(options))
  }
}

export class DiscoveredGattDatabase<Attachment extends string, Identity extends BackendIdentity<Attachment>>
  implements DiscoveredGattDatabaseHandle
{
  constructor(
    private readonly database: CoreGattDatabase<Attachment, Identity>,
    private readonly discoverySnapshot: GattDatabaseSnapshot<Attachment, string, string>
  ) {}

  get path() {
    return this.database.path
  }

  monotonicNow(): number {
    return this.database.monotonicNow()
  }

  scheduleDeadline(deadlineAt: number, action: () => void): DeadlineHandle {
    return this.database.scheduleDeadline(deadlineAt, action)
  }

  snapshot() {
    return this.database.snapshot()
  }

  async read(path: PortableCurrentCharacteristicPath, options: PortableOperationOptions) {
    return this.database.read(this.resolveCharacteristicPath(path), toPublicOperationOptions(options))
  }

  async write(path: PortableCurrentCharacteristicPath, bytes: Readonly<Uint8Array>, options: PortableWritePolicy) {
    return this.database.write(this.resolveCharacteristicPath(path), bytes, toPublicWritePolicy(options))
  }

  async maximumWriteLength(path: PortableCurrentCharacteristicPath, mode: WriteMode) {
    return this.database.maximumWriteLength(this.resolveCharacteristicPath(path), mode)
  }

  async writeLong(path: PortableCurrentCharacteristicPath, bytes: Readonly<Uint8Array>, options: PortableWritePolicy) {
    return this.database.writeLong(this.resolveCharacteristicPath(path), bytes, toPublicWritePolicy(options))
  }

  async readDescriptor(path: PortableCurrentDescriptorPath, options: PortableOperationOptions) {
    return this.database.readDescriptor(this.resolveDescriptorPath(path), toPublicOperationOptions(options))
  }

  async writeDescriptor(
    path: PortableCurrentDescriptorPath,
    bytes: Readonly<Uint8Array>,
    options: PortableWritePolicy
  ) {
    return this.database.writeDescriptor(this.resolveDescriptorPath(path), bytes, toPublicWritePolicy(options))
  }

  async subscribe(
    path: PortableCurrentCharacteristicPath,
    options: PortableSubscriptionOptions
  ): Promise<Subscription<Attachment, Identity>> {
    return new Subscription(
      await this.database.subscribe(this.resolveCharacteristicPath(path), toPublicSubscriptionOptions(options))
    )
  }

  private resolveCharacteristicPath(path: PortableCurrentCharacteristicPath): CurrentCharacteristicPath<Attachment> {
    const characteristic = this.discoverySnapshot.characteristics.find(candidate =>
      characteristicAddressMatches(candidate.path, path)
    )
    if (characteristic === undefined) {
      throw contractError('gatt.not-found', 'gatt', 'discovered-gatt.resolve-characteristic-path')
    }
    if (!characteristicPathMatches(characteristic.path, path)) {
      throw contractError('gatt.stale-handle', 'gatt', 'discovered-gatt.resolve-characteristic-path')
    }
    return characteristic.path
  }

  private resolveDescriptorPath(path: PortableCurrentDescriptorPath): CurrentDescriptorPath<Attachment> {
    const descriptor = this.discoverySnapshot.descriptors.find(candidate => descriptorAddressMatches(candidate.path, path))
    if (descriptor === undefined) {
      throw contractError('gatt.not-found', 'gatt', 'discovered-gatt.resolve-descriptor-path')
    }
    if (!descriptorPathMatches(descriptor.path, path)) {
      throw contractError('gatt.stale-handle', 'gatt', 'discovered-gatt.resolve-descriptor-path')
    }
    return descriptor.path
  }
}

export class Subscription<Attachment extends string, Identity extends BackendIdentity<Attachment>>
  implements SubscriptionHandle
{
  constructor(private readonly subscription: CoreSubscription<Attachment, Identity>) {}

  get subscriptionId() {
    return this.subscription.subscriptionId
  }

  get path() {
    return this.subscription.path
  }

  get values() {
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
