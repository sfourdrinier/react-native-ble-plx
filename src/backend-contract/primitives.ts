// src/backend-contract/primitives.ts

import { contractError } from './errors'

declare const backendContractBrand: unique symbol

export type Brand<Value, Kind extends string, Scope extends string = string> = Value & {
  readonly [backendContractBrand]: { readonly kind: Kind; readonly scope: Scope }
}

export type OpaqueId<Kind extends string, Scope extends string = string> = Brand<string, Kind, Scope>
export type AttachmentId<Attachment extends string> = OpaqueId<'attachment', Attachment>
export type AdapterId<Attachment extends string> = OpaqueId<'adapter', Attachment>
export type BackendInstanceId<Attachment extends string> = OpaqueId<'backend-instance', Attachment>
export type ManagerId<Attachment extends string, Manager extends string> = OpaqueId<
  'manager',
  `${Attachment}:${Manager}`
>
export type GenerationId<Kind extends string, Scope extends string> = OpaqueId<Kind, Scope>
export type PeerId<Attachment extends string> = OpaqueId<'peer', Attachment>
export type ConnectionId<Attachment extends string, Connection extends string> = OpaqueId<
  'connection',
  `${Attachment}:${Connection}`
>
export type LeaseId<Attachment extends string, Lease extends string> = OpaqueId<'lease', `${Attachment}:${Lease}`>
export type ScanShareToken<Attachment extends string, Lease extends string> = OpaqueId<
  'scan-share-token',
  `${Attachment}:${Lease}`
>
export type ScanSessionId<Attachment extends string, Lease extends string> = OpaqueId<
  'scan-session',
  `${Attachment}:${Lease}`
>
export type ClientId<Attachment extends string, Client extends string> = OpaqueId<'client', `${Attachment}:${Client}`>
export type OperationCorrelation<Attachment extends string, Operation extends string> = OpaqueId<
  'core-operation',
  `${Attachment}:${Operation}`
>
export type BackendOperationHandle<Attachment extends string, Operation extends string> = OpaqueId<
  'backend-operation',
  `${Attachment}:${Operation}`
>
export type NativeOperationCorrelation<Attachment extends string, Operation extends string> = OpaqueId<
  'native-operation',
  `${Attachment}:${Operation}`
>
export type IpcOperationCorrelation<Attachment extends string, Operation extends string> = OpaqueId<
  'ipc-operation',
  `${Attachment}:${Operation}`
>
export type GattDatabaseId<Attachment extends string, Connection extends string, Database extends string> = OpaqueId<
  'gatt-database',
  `${Attachment}:${Connection}:${Database}`
>
export type SubscriptionId<
  Attachment extends string,
  Connection extends string,
  Database extends string,
  Service extends string,
  Characteristic extends string,
  Subscription extends string
> = OpaqueId<'subscription', `${Attachment}:${Connection}:${Database}:${Service}:${Characteristic}:${Subscription}`>
export type Uuid = Brand<string, 'canonical-uuid'>
export type OwnedBytes = Brand<Uint8Array, 'owned-bytes'>
export type BorrowedBytes = Readonly<Uint8Array>
export type ByteLimit = Brand<number, 'byte-limit'>
export type MonotonicTimestamp = Brand<number, 'monotonic-timestamp'>
export type Deadline = Brand<number, 'deadline'>
export type Capacity = Brand<number, 'capacity'>
export type ResourceCount = Brand<number, 'resource-count'>

export type BackendContractAxis = 'backend-contract'
export type CapabilitySchemaAxis = 'capability-schema'
export type EventSchemaAxis = 'event-schema'
export type TraceFormatAxis = 'trace-format'
export type NativeProtocolAxis = 'native-protocol'
export type IpcProtocolAxis = 'ipc-protocol'
export type ProtocolAxis =
  | BackendContractAxis
  | CapabilitySchemaAxis
  | EventSchemaAxis
  | TraceFormatAxis
  | NativeProtocolAxis
  | IpcProtocolAxis

export interface VersionNumber<Axis extends string> {
  readonly axis: Axis
  readonly value: number
}
export interface VersionRange<Axis extends string> {
  readonly axis: Axis
  readonly minimum: VersionNumber<Axis>
  readonly maximum: VersionNumber<Axis>
}
export interface NegotiatedVersion<Axis extends string> {
  readonly axis: Axis
  readonly selected: VersionNumber<Axis>
  readonly localRange: VersionRange<Axis>
  readonly remoteRange: VersionRange<Axis>
}
export interface BackendCompatibilityOffer {
  readonly backendContract: VersionRange<BackendContractAxis>
  readonly capabilitySchema: VersionRange<CapabilitySchemaAxis>
  readonly eventSchema: VersionRange<EventSchemaAxis>
  readonly traceFormat: VersionRange<TraceFormatAxis>
}
export interface NativeCompatibilityOffer extends BackendCompatibilityOffer {
  readonly nativeProtocol: VersionRange<NativeProtocolAxis>
}
export interface IpcCompatibilityOffer extends BackendCompatibilityOffer {
  readonly ipcProtocol: VersionRange<IpcProtocolAxis>
}
export interface CoreVersionAxes {
  readonly backendContract: NegotiatedVersion<BackendContractAxis>
  readonly capabilitySchema: NegotiatedVersion<CapabilitySchemaAxis>
  readonly eventSchema: NegotiatedVersion<EventSchemaAxis>
  readonly traceFormat: NegotiatedVersion<TraceFormatAxis>
}
export interface NativeVersionAxes extends CoreVersionAxes {
  readonly nativeProtocol: NegotiatedVersion<NativeProtocolAxis>
}
export interface IpcVersionAxes extends CoreVersionAxes {
  readonly ipcProtocol: NegotiatedVersion<IpcProtocolAxis>
}
export type HostNeutralVersionAxes = CoreVersionAxes
export type ApplicableCompatibilityOffer = BackendCompatibilityOffer | NativeCompatibilityOffer | IpcCompatibilityOffer
export type ApplicableVersionAxes = HostNeutralVersionAxes | NativeVersionAxes | IpcVersionAxes

export interface ByteLimits {
  readonly maximumOperationBytes: ByteLimit
  readonly maximumAdvertisementBytes: ByteLimit
  readonly maximumStreamItemBytes: ByteLimit
  readonly maximumRetainedBytes: ByteLimit
}
export interface ByteOwnership {
  readonly input: 'caller-borrows-until-settlement'
  readonly retainedInput: 'backend-copies-before-retention'
  readonly output: 'receiver-owns-independent-copy'
  readonly boundary: 'copy-or-transfer-with-explicit-owner'
}
export interface AttachmentBinding<Attachment extends string> {
  readonly attachmentId: AttachmentId<Attachment>
  readonly backendInstanceId: BackendInstanceId<Attachment>
  readonly backendGeneration: GenerationId<'backend-generation', Attachment>
  readonly adapterId: AdapterId<Attachment>
  readonly adapterGeneration: GenerationId<'adapter-generation', Attachment>
}
export interface AttachmentBoundIdFactory<Attachment extends string> {
  clientId(value: string): ClientId<Attachment, string>
  managerId(value: string): ManagerId<Attachment, string>
  connectionId(value: string): ConnectionId<Attachment, string>
  leaseId(value: string): LeaseId<Attachment, string>
  scanShareToken(value: string): ScanShareToken<Attachment, string>
  scanSessionId(value: string): ScanSessionId<Attachment, string>
  databaseId(value: string): GattDatabaseId<Attachment, string, string>
  subscriptionId(value: string): SubscriptionId<Attachment, string, string, string, string, string>
  operationCorrelation(value: string): OperationCorrelation<Attachment, string>
  backendOperationHandle(value: string): BackendOperationHandle<Attachment, string>
}
export interface IpcOperationIdFactory<Attachment extends string> {
  ipcOperationCorrelation(value: string): IpcOperationCorrelation<Attachment, string>
  ipcDispatchEpoch(value: string): GenerationId<'ipc-dispatch-epoch', `${Attachment}:${string}`>
}
type AttachmentFromBoundScope<Scope extends string> = Scope extends `${infer Attachment}:${string}` ? Attachment : never
export type Scalar = boolean | number | string | null
export type SerializableValue = Scalar | OwnedBytes | readonly SerializableValue[] | SerializableRecord
export interface SerializableRecord {
  readonly [key: string]: SerializableValue
}

function assertNonEmptyString(value: string, label: string): void {
  if (value.length === 0) {
    throw new Error(`${label} must be non-empty`)
  }
}
function assertNonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`)
  }
}
export function opaqueId<Kind extends string, Scope extends string>(
  value: string,
  kind: Kind,
  scope: Scope
): OpaqueId<Kind, Scope> {
  assertNonEmptyString(value, kind)
  assertNonEmptyString(scope, `${kind} scope`)
  return value as OpaqueId<Kind, Scope>
}
function runtimeScopedOpaqueId<Kind extends string, Scope extends string>(
  value: string,
  kind: Kind,
  scope: string
): OpaqueId<Kind, Scope> {
  assertNonEmptyString(value, kind)
  assertNonEmptyString(scope, `${kind} scope`)
  return value as OpaqueId<Kind, Scope>
}
function attachmentScope<Attachment extends string>(binding: AttachmentBinding<Attachment>): string {
  const values = [
    binding.attachmentId,
    binding.backendInstanceId,
    binding.backendGeneration,
    binding.adapterId,
    binding.adapterGeneration
  ]
  for (const value of values) {
    assertNonEmptyString(String(value), 'attachment binding value')
  }
  return values.map(value => String(value)).join(':')
}
export function createAttachmentBoundIdFactory<Attachment extends string>(
  binding: AttachmentBinding<Attachment>
): AttachmentBoundIdFactory<Attachment> {
  const scope = attachmentScope(binding)
  return {
    clientId: value => runtimeScopedOpaqueId<'client', `${Attachment}:${string}`>(value, 'client', scope),
    managerId: value => runtimeScopedOpaqueId<'manager', `${Attachment}:${string}`>(value, 'manager', scope),
    connectionId: value => runtimeScopedOpaqueId<'connection', `${Attachment}:${string}`>(value, 'connection', scope),
    leaseId: value => runtimeScopedOpaqueId<'lease', `${Attachment}:${string}`>(value, 'lease', scope),
    scanShareToken: value =>
      runtimeScopedOpaqueId<'scan-share-token', `${Attachment}:${string}`>(value, 'scan-share-token', scope),
    scanSessionId: value =>
      runtimeScopedOpaqueId<'scan-session', `${Attachment}:${string}`>(value, 'scan-session', scope),
    databaseId: value =>
      runtimeScopedOpaqueId<'gatt-database', `${Attachment}:${string}:${string}`>(value, 'gatt-database', scope),
    subscriptionId: value =>
      runtimeScopedOpaqueId<'subscription', `${Attachment}:${string}:${string}:${string}:${string}:${string}`>(
        value,
        'subscription',
        scope
      ),
    operationCorrelation: value =>
      runtimeScopedOpaqueId<'core-operation', `${Attachment}:${string}`>(value, 'core-operation', scope),
    backendOperationHandle: value =>
      runtimeScopedOpaqueId<'backend-operation', `${Attachment}:${string}`>(value, 'backend-operation', scope)
  }
}
/** Creates renderer-local IPC correlation IDs scoped to one already-attached backend generation. */
export function createIpcOperationIdFactory<Attachment extends string>(
  scope: string
): IpcOperationIdFactory<Attachment> {
  return {
    ipcOperationCorrelation: value =>
      runtimeScopedOpaqueId<'ipc-operation', `${Attachment}:${string}`>(value, 'ipc-operation', scope),
    ipcDispatchEpoch: value =>
      runtimeScopedOpaqueId<'ipc-dispatch-epoch', `${Attachment}:${string}`>(value, 'ipc-dispatch-epoch', scope)
  }
}
export function rebindAttachmentBoundId<Kind extends string, Scope extends string>(
  id: OpaqueId<Kind, Scope>,
  source: AttachmentBinding<AttachmentFromBoundScope<Scope>>,
  target: AttachmentBinding<AttachmentFromBoundScope<Scope>>
): OpaqueId<Kind, Scope> {
  if (attachmentScope(source) !== attachmentScope(target)) {
    throw new Error('attachment rebinding requires the identical attachment tuple')
  }
  return id
}
export function canonicalUuid(value: string): Uuid {
  const normalized = value.toLowerCase()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalized)) {
    throw new Error('UUID must be canonical lowercase 128-bit form')
  }
  return normalized as Uuid
}
export function byteLimit(value: number): ByteLimit {
  assertNonNegativeSafeInteger(value, 'byte limit')
  return value as ByteLimit
}
export function capacity(value: number): Capacity {
  assertNonNegativeSafeInteger(value, 'capacity')
  if (value === 0) {
    throw new Error('capacity must be greater than zero')
  }
  return value as Capacity
}
export function resourceCount(value: number): ResourceCount {
  assertNonNegativeSafeInteger(value, 'resource count')
  return value as ResourceCount
}
export function monotonicTimestamp(value: number): MonotonicTimestamp {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('monotonic timestamp must be finite and non-negative')
  }
  return value as MonotonicTimestamp
}
export function deadline(value: number): Deadline {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('deadline must be finite and non-negative')
  }
  return value as Deadline
}
export function ownBytes(bytes: BorrowedBytes, maximumBytes: ByteLimit): OwnedBytes {
  if (bytes.byteLength > maximumBytes) {
    throw contractError('bytes.too-large', 'boundary', 'primitives.own-bytes')
  }
  return new Uint8Array(bytes) as OwnedBytes
}
export function version<Axis extends ProtocolAxis>(axis: Axis, value: number): VersionNumber<Axis> {
  assertNonNegativeSafeInteger(value, `${axis} version`)
  return { axis, value }
}
export function versionRange<Axis extends ProtocolAxis>(
  minimum: VersionNumber<Axis>,
  maximum: VersionNumber<Axis>
): VersionRange<Axis> {
  if (minimum.axis !== maximum.axis) {
    throw contractError('protocol.malformed', 'core', 'version-range.axes')
  }
  if (minimum.value > maximum.value) {
    throw contractError('protocol.malformed', 'core', 'version-range.minimum')
  }
  return { axis: minimum.axis, minimum, maximum }
}
export function negotiateVersion<Axis extends ProtocolAxis>(
  localRange: VersionRange<Axis>,
  remoteRange: VersionRange<Axis>
): NegotiatedVersion<Axis> {
  assertNegotiationRange(localRange)
  assertNegotiationRange(remoteRange)
  if (localRange.axis !== remoteRange.axis) {
    throw contractError('protocol.malformed', 'core', 'version-negotiate.axes')
  }
  const selectedValue = Math.min(localRange.maximum.value, remoteRange.maximum.value)
  if (selectedValue < localRange.minimum.value || selectedValue < remoteRange.minimum.value) {
    throw contractError('protocol.incompatible', 'core', `version-negotiate.${localRange.axis}`)
  }
  return { axis: localRange.axis, selected: version(localRange.axis, selectedValue), localRange, remoteRange }
}
function assertNegotiationRange<Axis extends ProtocolAxis>(range: VersionRange<Axis>): void {
  if (
    range.axis !== range.minimum.axis ||
    range.axis !== range.maximum.axis ||
    !Number.isSafeInteger(range.minimum.value) ||
    range.minimum.value < 0 ||
    !Number.isSafeInteger(range.maximum.value) ||
    range.maximum.value < 0 ||
    range.minimum.value > range.maximum.value
  ) {
    throw contractError('protocol.malformed', 'core', `version-negotiate.${range.axis}.range`)
  }
}
export function negotiateCoreVersions(
  local: BackendCompatibilityOffer,
  remote: BackendCompatibilityOffer
): CoreVersionAxes {
  return {
    backendContract: negotiateVersion(local.backendContract, remote.backendContract),
    capabilitySchema: negotiateVersion(local.capabilitySchema, remote.capabilitySchema),
    eventSchema: negotiateVersion(local.eventSchema, remote.eventSchema),
    traceFormat: negotiateVersion(local.traceFormat, remote.traceFormat)
  }
}
export function assertCoreVersionsAccepted(versions: CoreVersionAxes, offer: BackendCompatibilityOffer): void {
  assertVersionAccepted(versions.backendContract, offer.backendContract)
  assertVersionAccepted(versions.capabilitySchema, offer.capabilitySchema)
  assertVersionAccepted(versions.eventSchema, offer.eventSchema)
  assertVersionAccepted(versions.traceFormat, offer.traceFormat)
}

export function applicableVersionAxesEqual(left: ApplicableVersionAxes, right: ApplicableVersionAxes): boolean {
  if (
    !negotiatedVersionEqual(left.backendContract, right.backendContract) ||
    !negotiatedVersionEqual(left.capabilitySchema, right.capabilitySchema) ||
    !negotiatedVersionEqual(left.eventSchema, right.eventSchema) ||
    !negotiatedVersionEqual(left.traceFormat, right.traceFormat)
  ) {
    return false
  }
  if ('nativeProtocol' in left || 'nativeProtocol' in right) {
    return (
      'nativeProtocol' in left &&
      'nativeProtocol' in right &&
      negotiatedVersionEqual(left.nativeProtocol, right.nativeProtocol)
    )
  }
  if ('ipcProtocol' in left || 'ipcProtocol' in right) {
    return (
      'ipcProtocol' in left && 'ipcProtocol' in right && negotiatedVersionEqual(left.ipcProtocol, right.ipcProtocol)
    )
  }
  return true
}

export function snapshotApplicableVersionAxes(versions: ApplicableVersionAxes): ApplicableVersionAxes {
  const core = {
    backendContract: snapshotNegotiatedVersion(versions.backendContract),
    capabilitySchema: snapshotNegotiatedVersion(versions.capabilitySchema),
    eventSchema: snapshotNegotiatedVersion(versions.eventSchema),
    traceFormat: snapshotNegotiatedVersion(versions.traceFormat)
  }
  if ('nativeProtocol' in versions) {
    return Object.freeze({ ...core, nativeProtocol: snapshotNegotiatedVersion(versions.nativeProtocol) })
  }
  if ('ipcProtocol' in versions) {
    return Object.freeze({ ...core, ipcProtocol: snapshotNegotiatedVersion(versions.ipcProtocol) })
  }
  return Object.freeze(core)
}

function negotiatedVersionEqual<Axis extends string>(
  left: NegotiatedVersion<Axis>,
  right: NegotiatedVersion<Axis>
): boolean {
  return (
    left.axis === right.axis &&
    left.selected.axis === right.selected.axis &&
    left.selected.value === right.selected.value &&
    versionRangeEqual(left.localRange, right.localRange) &&
    versionRangeEqual(left.remoteRange, right.remoteRange)
  )
}

function versionRangeEqual<Axis extends string>(left: VersionRange<Axis>, right: VersionRange<Axis>): boolean {
  return (
    left.axis === right.axis &&
    left.minimum.axis === right.minimum.axis &&
    left.minimum.value === right.minimum.value &&
    left.maximum.axis === right.maximum.axis &&
    left.maximum.value === right.maximum.value
  )
}

function snapshotNegotiatedVersion<Axis extends string>(
  versionValue: NegotiatedVersion<Axis>
): NegotiatedVersion<Axis> {
  return Object.freeze({
    axis: versionValue.axis,
    selected: Object.freeze({ axis: versionValue.selected.axis, value: versionValue.selected.value }),
    localRange: snapshotVersionRange(versionValue.localRange),
    remoteRange: snapshotVersionRange(versionValue.remoteRange)
  })
}

function snapshotVersionRange<Axis extends string>(range: VersionRange<Axis>): VersionRange<Axis> {
  return Object.freeze({
    axis: range.axis,
    minimum: Object.freeze({ axis: range.minimum.axis, value: range.minimum.value }),
    maximum: Object.freeze({ axis: range.maximum.axis, value: range.maximum.value })
  })
}

function assertVersionAccepted<Axis extends ProtocolAxis>(
  selected: NegotiatedVersion<Axis>,
  range: VersionRange<Axis>
): void {
  if (
    selected.axis !== range.axis ||
    selected.selected.value < range.minimum.value ||
    selected.selected.value > range.maximum.value
  ) {
    throw contractError('protocol.incompatible', 'core', `version-accepted.${selected.axis}`)
  }
}
