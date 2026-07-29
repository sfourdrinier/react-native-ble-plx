// src/backends/reactnative/react-native-restoration.ts

import { createFeatureRegistry, type FeatureRegistry, type Limitation } from '../../backend-contract/capabilities'
import { contractError, BackendContractError } from '../../backend-contract/errors'
import {
  attachmentRecordsEqual,
  type AttachmentRecord,
  type BackendProvider,
  type NativeBackendIdentity
} from '../../backend-contract/identity'
import {
  applicableVersionAxesEqual,
  opaqueId,
  version,
  versionRange,
  type ClientId,
  type NativeVersionAxes,
  type SerializableRecord,
  type SerializableValue
} from '../../backend-contract/primitives'
import type {
  AuthenticatedRestorationClient,
  RestorationAdoptionRequest,
  RestorationAdoptionResult,
  RestorationCoordinator,
  RestorationJournalRecord
} from '../../backend-contract/restoration'
import {
  decodeNativeProtocolRecord,
  type NativeProtocolFieldValue,
  type NativeProtocolRecord
} from '../../native-protocol/v1-codec'
import {
  MAXIMUM_CONTROL_RECORD_BYTES,
  type RestorationOutcomes
} from '../../native-protocol/generated/native-protocol-v1-schema'
import type {
  NativeRestorationAdoptionControlResult,
  Spec as NativeProtocolControl
} from '../../NativeUnifiedBleProtocolControl'

const maximumRestorationRecords = 1024
const restorationScenarioId = 'restoration.provider-journal-adoption-and-rejection'
const activationIssuanceToken = Symbol('react-native-restoration-activation')

type ReactNativeRestorationPlatform = 'android' | 'apple'

interface ActiveRestorationBinding {
  readonly activation: ReactNativeRestorationActivation
  readonly attachment: AttachmentRecord<string>
  readonly versions: NativeVersionAxes
}
/** React Native provider surface with one authority-bound restoration coordinator. */
export interface ReactNativeRestorationBackendProvider extends BackendProvider<string, NativeBackendIdentity<string>> {
  readonly restoration: ReactNativeRestorationCoordinator
}

/** Opaque provider-issued binding for one opened React Native native attachment. */
export class ReactNativeRestorationActivation {
  private readonly marker = true

  constructor(issuanceToken: symbol) {
    if (issuanceToken !== activationIssuanceToken || !this.marker) {
      throw contractError('ownership.denied', 'restoration', 'react-native-restoration.activation')
    }
  }
}

/**
 * Provider-owned authority for the one currently open native attachment.
 * It serializes adoption, copies replay bytes, and closes admission before the
 * physical attachment can begin destruction.
 */
export class ReactNativeRestorationCoordinator implements RestorationCoordinator<string> {
  private activeBinding: ActiveRestorationBinding | null = null
  private serial: Promise<void> = Promise.resolve()
  private closing: Promise<void> | null = null
  private consumed: RestorationAdoptionResult<string> | null = null
  private terminalFailure: BackendContractError | null = null

  constructor(
    private readonly control: Pick<NativeProtocolControl, 'adoptRestoration'>,
    private readonly platform: ReactNativeRestorationPlatform
  ) {}

  activate(attachment: AttachmentRecord<string>, versions: NativeVersionAxes): ReactNativeRestorationActivation {
    if (this.activeBinding !== null || this.closing !== null) {
      throw contractError('lifecycle.invalid-state', 'restoration', 'react-native-restoration.activate')
    }
    const activation = new ReactNativeRestorationActivation(activationIssuanceToken)
    this.activeBinding = Object.freeze({ activation, attachment, versions })
    this.consumed = null
    this.terminalFailure = null
    return activation
  }

  deactivate(activation: ReactNativeRestorationActivation): Promise<void> {
    const active = this.activeBinding
    if (active === null || active.activation !== activation) {
      return Promise.resolve()
    }
    this.activeBinding = null
    const waiting = this.serial
    const closing = waiting.then(
      () => undefined,
      () => undefined
    )
    this.closing = closing
    closing.then(() => {
      if (this.closing === closing) {
        this.closing = null
      }
    })
    return closing
  }

  adopt(
    client: AuthenticatedRestorationClient<string>,
    request: RestorationAdoptionRequest<string>
  ): Promise<RestorationAdoptionResult<string>> {
    const adoption = this.serial.then(() => this.adoptWhenTurn(client, request))
    this.serial = adoption.then(
      () => undefined,
      () => undefined
    )
    return adoption
  }

  private async adoptWhenTurn(
    client: AuthenticatedRestorationClient<string>,
    request: RestorationAdoptionRequest<string>
  ): Promise<RestorationAdoptionResult<string>> {
    const binding = this.requireActiveBinding()
    assertClient(client)
    assertRequest(request)
    if (this.platform === 'android') {
      throw contractError('capability.unsupported', 'restoration', 'react-native-restoration.android-adopt')
    }
    const mismatch = requestMismatch(binding, request)
    if (mismatch !== null) {
      return mismatchResult(request, mismatch)
    }
    if (this.terminalFailure !== null) {
      throw this.terminalFailure
    }
    if (this.consumed !== null) {
      return alreadyConsumedResult(this.consumed)
    }

    let nativeResult: NativeRestorationAdoptionControlResult
    try {
      nativeResult = await this.control.adoptRestoration({
        namespaceValue: request.namespace,
        attachmentId: String(request.attachmentId),
        expectedBackendInstanceId: String(request.expectedBackendInstanceId),
        expectedEpoch: String(request.expectedEpoch),
        nativeProtocolMinimum: request.expectedVersions.nativeProtocol.selected.value,
        nativeProtocolMaximum: request.expectedVersions.nativeProtocol.selected.value,
        clientId: String(client.clientId),
        hostSessionScope: client.hostSessionScope
      })
    } catch (error) {
      console.error('[ReactNativeRestorationCoordinator.adopt] Native restoration adoption failed:', error)
      if (error instanceof BackendContractError) {
        throw error
      }
      throw contractError('platform.failure', 'restoration', 'react-native-restoration.native-adopt')
    }

    try {
      const result = decodeAdoptionResult(nativeResult, client, request, binding)
      if (result.outcome === 'adopted' || result.outcome === 'already-consumed') {
        this.consumed = result
      }
      return result
    } catch (error) {
      const normalized =
        error instanceof BackendContractError
          ? error
          : contractError('protocol.malformed', 'restoration', 'react-native-restoration.decode-adoption')
      this.terminalFailure = normalized
      console.error('[ReactNativeRestorationCoordinator.adopt] Native restoration replay was malformed:', error)
      throw normalized
    }
  }

  private requireActiveBinding(): ActiveRestorationBinding {
    if (this.activeBinding === null) {
      throw contractError('lifecycle.destroyed', 'restoration', 'react-native-restoration.adopt')
    }
    return this.activeBinding
  }
}

/** Registers the provider-owned restoration capability independently of host inference. */
export function createReactNativeRestorationFeatureRegistry(
  platform: ReactNativeRestorationPlatform,
  implementationVersion: string
): FeatureRegistry {
  const state = platform === 'apple' ? 'limited' : 'unsupported'
  const limitation = restorationLimitation(platform)
  return createFeatureRegistry(
    Object.freeze([
      Object.freeze({
        id: 'state:restoration-adoption',
        state,
        implementationOrigin: 'backend-native',
        implementation: Object.freeze({
          async invoke(_input: SerializableRecord): Promise<SerializableRecord> {
            throw contractError(
              'lifecycle.invalid-state',
              'restoration',
              'state:restoration-adoption.invoke-without-manager'
            )
          }
        }),
        tck: Object.freeze({
          suiteId: 'restoration',
          requiredScenarioIds: Object.freeze([restorationScenarioId]),
          contractRange: versionRange(version('capability-schema', 1), version('capability-schema', 1))
        }),
        evidence: Object.freeze({
          receiptId: `react-native-${platform}-restoration-adoption-v1:deterministic`,
          evidenceLevel: state === 'limited' ? 'deterministic' : 'blocked',
          implementationVersion,
          sourceDigest: `react-native-${platform}-restoration-adoption-v1`,
          scenarioIds: Object.freeze([restorationScenarioId]),
          limitations: Object.freeze([limitation])
        }),
        limitations: Object.freeze([limitation]),
        limits: Object.freeze({
          maximumRestorationRecords,
          maximumRestorationBytes: MAXIMUM_CONTROL_RECORD_BYTES,
          automaticReconnects: 0,
          automaticSubscriptionResumptions: 0
        })
      })
    ])
  )
}

export function combineReactNativeFeatureRegistries(
  connectionControls: FeatureRegistry,
  restoration: FeatureRegistry
): FeatureRegistry {
  return createFeatureRegistry(Object.freeze([...connectionControls.registrations, ...restoration.registrations]))
}

function restorationLimitation(platform: 'android' | 'apple'): Limitation {
  if (platform === 'android') {
    return Object.freeze({
      code: 'android-process-restart-has-no-restored-gatt-state',
      explanation: 'Android does not provide a native BLE restoration journal for a terminated process.',
      affectedGuarantee: 'replay of state restored before JavaScript starts'
    })
  }
  return Object.freeze({
    code: 'configured-native-restoration-authority-required',
    explanation:
      'Apple replays bounded restored state only after explicit authenticated adoption against its native authority configuration; it never reconnects or resumes subscriptions.',
    affectedGuarantee: 'automatic restoration of radio activity'
  })
}

function assertClient(client: AuthenticatedRestorationClient<string>): void {
  if (String(client.clientId).length === 0 || client.hostSessionScope.length === 0) {
    throw contractError('argument.invalid', 'restoration', 'react-native-restoration.client')
  }
}

function assertRequest(request: RestorationAdoptionRequest<string>): void {
  if (
    request.namespace.length === 0 ||
    String(request.attachmentId).length === 0 ||
    String(request.expectedBackendInstanceId).length === 0 ||
    String(request.expectedEpoch).length === 0
  ) {
    throw contractError('argument.invalid', 'restoration', 'react-native-restoration.request')
  }
}

function requestMismatch(
  binding: ActiveRestorationBinding,
  request: RestorationAdoptionRequest<string>
): 'attachment-mismatch' | 'backend-mismatch' | null {
  if (request.attachmentId !== binding.attachment.attachmentId) {
    return 'attachment-mismatch'
  }
  if (request.expectedBackendInstanceId !== binding.attachment.backendInstanceId) {
    return 'backend-mismatch'
  }
  if (!applicableVersionAxesEqual(request.expectedVersions, binding.versions)) {
    throw contractError('protocol.incompatible', 'restoration', 'react-native-restoration.request-versions')
  }
  return null
}

function mismatchResult(
  request: RestorationAdoptionRequest<string>,
  outcome: 'attachment-mismatch' | 'backend-mismatch'
): RestorationAdoptionResult<string> {
  return Object.freeze({
    attachmentId: request.attachmentId,
    receiptId: null,
    namespace: request.namespace,
    boundClientId: null,
    adoptionEpoch: null,
    outcome,
    replayedRecords: Object.freeze([])
  })
}

function decodeAdoptionResult(
  result: NativeRestorationAdoptionControlResult,
  client: AuthenticatedRestorationClient<string>,
  request: RestorationAdoptionRequest<string>,
  binding: ActiveRestorationBinding
): RestorationAdoptionResult<string> {
  assertNativeResultShape(result)
  const outcome = outcomeFor(result.outcome)
  if (outcome === 'adopted') {
    if (
      result.receiptId.length === 0 ||
      result.boundClientId !== String(client.clientId) ||
      result.adoptionEpoch !== String(request.expectedEpoch)
    ) {
      throw contractError('protocol.violation', 'restoration', 'react-native-restoration.adopted-authority')
    }
    const replayedRecords = decodeReplayedRecords(result, request, binding)
    return Object.freeze({
      attachmentId: binding.attachment.attachmentId,
      receiptId: result.receiptId,
      namespace: request.namespace,
      boundClientId: client.clientId,
      adoptionEpoch: request.expectedEpoch,
      outcome,
      replayedRecords
    })
  }
  if (outcome === 'already-consumed') {
    if (
      result.receiptId.length !== 0 ||
      result.boundClientId.length === 0 ||
      result.adoptionEpoch.length === 0 ||
      result.replayRecordCount !== 0 ||
      result.records.length !== 0
    ) {
      throw contractError('protocol.violation', 'restoration', 'react-native-restoration.already-consumed-authority')
    }
    return Object.freeze({
      attachmentId: binding.attachment.attachmentId,
      receiptId: null,
      namespace: request.namespace,
      boundClientId: restorationClientId(result.boundClientId, binding.attachment),
      adoptionEpoch: restorationEpoch(result.adoptionEpoch),
      outcome,
      replayedRecords: Object.freeze([])
    })
  }
  if (
    result.receiptId.length !== 0 ||
    result.boundClientId.length !== 0 ||
    result.adoptionEpoch.length === 0 ||
    result.replayRecordCount !== 0 ||
    result.records.length !== 0
  ) {
    throw contractError('protocol.violation', 'restoration', 'react-native-restoration.rejection-authority')
  }
  return Object.freeze({
    attachmentId: request.attachmentId,
    receiptId: null,
    namespace: request.namespace,
    boundClientId: null,
    adoptionEpoch: restorationEpoch(result.adoptionEpoch),
    outcome,
    replayedRecords: Object.freeze([])
  })
}

function assertNativeResultShape(result: NativeRestorationAdoptionControlResult): void {
  if (
    !Number.isSafeInteger(result.replayRecordCount) ||
    result.replayRecordCount < 0 ||
    result.replayRecordCount > maximumRestorationRecords ||
    result.replayRecordCount !== result.records.length
  ) {
    throw contractError('protocol.malformed', 'restoration', 'react-native-restoration.native-result')
  }
}

function outcomeFor(outcome: RestorationOutcomes): RestorationAdoptionResult<string>['outcome'] {
  if (outcome === 'adopted') {
    return 'adopted'
  }
  if (outcome === 'alreadyConsumed') {
    return 'already-consumed'
  }
  if (outcome === 'attachmentMismatch') {
    return 'attachment-mismatch'
  }
  if (outcome === 'backendMismatch') {
    return 'backend-mismatch'
  }
  if (outcome === 'namespaceMismatch') {
    return 'namespace-mismatch'
  }
  if (outcome === 'epochMismatch') {
    return 'epoch-mismatch'
  }
  throw contractError('protocol.malformed', 'restoration', 'react-native-restoration.native-outcome')
}

function decodeReplayedRecords(
  result: NativeRestorationAdoptionControlResult,
  request: RestorationAdoptionRequest<string>,
  binding: ActiveRestorationBinding
): readonly RestorationJournalRecord<string>[] {
  const records: RestorationJournalRecord<string>[] = []
  let totalBytes = 0
  let expectedOrdinal = 1
  for (const nativeRecord of result.records) {
    const encoded = ownedEncodedRecord(nativeRecord.encodedRecord, totalBytes)
    totalBytes += encoded.byteLength
    const record = decodeNativeProtocolRecord(encoded)
    const replayed = replayedRecordFromProtocol(record, encoded, request, binding)
    if (replayed.ordinal !== expectedOrdinal) {
      throw contractError('protocol.violation', 'restoration', 'react-native-restoration.replay-ordinal')
    }
    expectedOrdinal += 1
    records.push(replayed)
  }
  return Object.freeze(records)
}

function ownedEncodedRecord(encodedRecord: readonly number[], retainedBytes: number): Uint8Array {
  if (
    encodedRecord.length === 0 ||
    encodedRecord.length > MAXIMUM_CONTROL_RECORD_BYTES ||
    encodedRecord.length > MAXIMUM_CONTROL_RECORD_BYTES - retainedBytes
  ) {
    throw contractError('protocol.malformed', 'restoration', 'react-native-restoration.replay-bytes')
  }
  const owned = new Uint8Array(encodedRecord.length)
  for (let index = 0; index < encodedRecord.length; index += 1) {
    const value = encodedRecord[index]
    if (value === undefined || !Number.isSafeInteger(value) || value < 0 || value > 255) {
      throw contractError('protocol.malformed', 'restoration', 'react-native-restoration.replay-byte')
    }
    owned[index] = value
  }
  return owned
}

function replayedRecordFromProtocol(
  record: NativeProtocolRecord,
  encoded: Uint8Array,
  request: RestorationAdoptionRequest<string>,
  binding: ActiveRestorationBinding
): RestorationJournalRecord<string> {
  if (record.kind !== 'restorationRecord') {
    throw contractError('protocol.malformed', 'restoration', 'react-native-restoration.replay-kind')
  }
  const recordVersion = requiredPositiveUnsigned(record, 1, 'record-version')
  const namespaceValue = requiredString(record, 2, 'namespace')
  const attachment = requiredRecord(record, 3, 'attachment')
  assertRecordAttachment(attachment, binding.attachment)
  const ordinal = requiredPositiveUnsigned(record, 4, 'ordinal')
  const epoch = requiredString(record, 5, 'epoch')
  const kind = requiredRestorationKind(record, 6)
  if (namespaceValue !== request.namespace || epoch !== String(request.expectedEpoch)) {
    throw contractError('protocol.violation', 'restoration', 'react-native-restoration.replay-authority')
  }
  const peerValue = optionalString(record, 7)
  return Object.freeze({
    recordVersion,
    namespace: namespaceValue,
    attachmentId: binding.attachment.attachmentId,
    backendInstanceId: binding.attachment.backendInstanceId,
    backendGeneration: binding.attachment.backendGeneration,
    ordinal,
    adoptionEpoch: restorationEpoch(epoch),
    kind,
    peerId: peerValue === null ? null : opaqueId(peerValue, 'peer', 'react-native-restoration'),
    payload: Object.freeze({
      protocolRecord: protocolRecordPayload(record),
      encodedByteLength: encoded.byteLength
    })
  })
}

function assertRecordAttachment(record: NativeProtocolRecord, expected: AttachmentRecord<string>): void {
  if (record.kind !== 'attachment') {
    throw contractError('protocol.malformed', 'restoration', 'react-native-restoration.replay-attachment-kind')
  }
  const actual: AttachmentRecord<string> = Object.freeze({
    attachmentId: opaqueId(requiredString(record, 1, 'attachment-id'), 'attachment', 'react-native-restoration'),
    backendInstanceId: opaqueId(
      requiredString(record, 2, 'backend-instance-id'),
      'backend-instance',
      'react-native-restoration'
    ),
    backendGeneration: opaqueId(
      requiredString(record, 3, 'backend-generation'),
      'backend-generation',
      'react-native-restoration'
    ),
    adapter: Object.freeze({
      adapterId: opaqueId(requiredString(record, 4, 'adapter-id'), 'adapter', 'react-native-restoration'),
      displayName: null,
      state: expected.adapter.state,
      adapterGeneration: opaqueId(
        requiredString(record, 5, 'adapter-generation'),
        'adapter-generation',
        'react-native-restoration'
      ),
      limitations: Object.freeze([])
    })
  })
  if (!attachmentRecordsEqual(actual, expected)) {
    throw contractError('protocol.violation', 'restoration', 'react-native-restoration.replay-attachment')
  }
}

function requiredRestorationKind(record: NativeProtocolRecord, id: number): RestorationJournalRecord<string>['kind'] {
  const value = requiredString(record, id, 'kind')
  if (value === 'adapter' || value === 'connection' || value === 'subscription' || value === 'event') {
    return value
  }
  throw contractError('protocol.malformed', 'restoration', 'react-native-restoration.replay-kind-value')
}

function requiredPositiveUnsigned(record: NativeProtocolRecord, id: number, fieldName: string): number {
  const value = requiredValue(record, id, fieldName)
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw contractError('protocol.malformed', 'restoration', `react-native-restoration.replay-${fieldName}`)
  }
  return value
}

function requiredString(record: NativeProtocolRecord, id: number, fieldName: string): string {
  const value = requiredValue(record, id, fieldName)
  if (typeof value !== 'string' || value.length === 0) {
    throw contractError('protocol.malformed', 'restoration', `react-native-restoration.replay-${fieldName}`)
  }
  return value
}

function optionalString(record: NativeProtocolRecord, id: number): string | null {
  const field = record.fields.find(candidate => candidate.id === id)
  if (field === undefined) {
    return null
  }
  if (typeof field.value !== 'string' || field.value.length === 0) {
    throw contractError('protocol.malformed', 'restoration', 'react-native-restoration.replay-optional-string')
  }
  return field.value
}

function requiredRecord(record: NativeProtocolRecord, id: number, fieldName: string): NativeProtocolRecord {
  const value = requiredValue(record, id, fieldName)
  if (!isNativeProtocolRecord(value)) {
    throw contractError('protocol.malformed', 'restoration', `react-native-restoration.replay-${fieldName}`)
  }
  return value
}

function requiredValue(record: NativeProtocolRecord, id: number, fieldName: string) {
  const field = record.fields.find(candidate => candidate.id === id)
  if (field === undefined) {
    throw contractError('protocol.malformed', 'restoration', `react-native-restoration.replay-${fieldName}`)
  }
  return field.value
}

function isNativeProtocolRecord(value: NativeProtocolFieldValue): value is NativeProtocolRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'kind' in value && 'fields' in value
}

function protocolRecordPayload(record: NativeProtocolRecord): SerializableRecord {
  return Object.freeze({
    kind: record.kind,
    fields: Object.freeze(
      record.fields.map(field =>
        Object.freeze({
          id: field.id,
          value: serializableProtocolValue(field.value)
        })
      )
    )
  })
}

function serializableProtocolValue(value: NativeProtocolFieldValue): SerializableValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map(item => serializableProtocolValue(item)))
  }
  if (isNativeProtocolRecord(value)) {
    return protocolRecordPayload(value)
  }
  throw contractError('protocol.malformed', 'restoration', 'react-native-restoration.replay-value')
}

function restorationClientId(value: string, attachment: AttachmentRecord<string>): ClientId<string, string> {
  const scope: `${string}:${string}` = `restoration:${String(attachment.attachmentId)}`
  return opaqueId(value, 'client', scope)
}

function restorationEpoch(value: string) {
  return opaqueId(value, 'restoration-epoch', 'react-native-restoration')
}

function alreadyConsumedResult(result: RestorationAdoptionResult<string>): RestorationAdoptionResult<string> {
  return Object.freeze({
    attachmentId: result.attachmentId,
    receiptId: null,
    namespace: result.namespace,
    boundClientId: result.boundClientId,
    adoptionEpoch: result.adoptionEpoch,
    outcome: 'already-consumed',
    replayedRecords: Object.freeze([])
  })
}
