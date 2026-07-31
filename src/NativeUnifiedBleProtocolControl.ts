// src/NativeUnifiedBleProtocolControl.ts

import type { TurboModule } from 'react-native'
import { TurboModuleRegistry } from 'react-native'

export interface NativeProtocolVersionRange {
  minimum: number
  maximum: number
}

export interface NativeProtocolHandshakeRequest {
  nativeProtocol: NativeProtocolVersionRange
  abi: NativeProtocolVersionRange
  backendContract: NativeProtocolVersionRange
  capabilitySchema: NativeProtocolVersionRange
  eventSchema: NativeProtocolVersionRange
  traceFormat: NativeProtocolVersionRange
  attachmentId: string
  backendInstanceId: string
  backendGeneration: string
  adapterId: string
  adapterGeneration: string
  ownerId: string
}

export interface NativeProtocolHandshakeResult {
  nativeProtocol: number
  abi: number
  backendContract: number
  capabilitySchema: number
  eventSchema: number
  traceFormat: number
  maximumControlRecordBytes: number
  maximumBinaryPayloadBytes: number
}

export interface NativeAttachmentIdentity {
  attachmentId: string
  backendInstanceId: string
  backendGeneration: string
  adapterId: string
  adapterGeneration: string
}

export interface NativeOperationCorrelation {
  attachment: NativeAttachmentIdentity
  dispatchEpoch: number
  nonce: string
}

export type NativeRestorationOutcome =
  | 'adopted'
  | 'alreadyConsumed'
  | 'attachmentMismatch'
  | 'backendMismatch'
  | 'namespaceMismatch'
  | 'epochMismatch'

export type NativeCancellationState = 'cancellationRequested' | 'alreadyTerminal' | 'notCancellable'

export interface NativeRestorationAdoptionRequest {
  namespaceValue: string
  attachmentId: string
  expectedBackendInstanceId: string
  expectedEpoch: string
  nativeProtocolMinimum: number
  nativeProtocolMaximum: number
  clientId: string
  hostSessionScope: string
}

export interface NativeRestorationReplayRecord {
  recordVersion: number
  namespaceValue: string
  attachmentId: string
  backendInstanceId: string
  backendGeneration: string
  adapterId: string
  adapterGeneration: string
  ordinal: number
  adoptionEpoch: string
  kind: 'adapter' | 'connection'
  peerId: string | null
  connectionId: string | null
  ownerLeaseId: string | null
  connectionGeneration: string | null
}

export interface NativeRestorationAdoptionControlResult {
  receiptId: string
  outcome: NativeRestorationOutcome
  boundClientId: string
  adoptionEpoch: string
  replayRecordCount: number
  records: NativeRestorationReplayRecord[]
}

export interface NativeCancellationControlResult {
  state: NativeCancellationState
}

export interface Spec extends TurboModule {
  handshake(request: NativeProtocolHandshakeRequest): Promise<NativeProtocolHandshakeResult>
  installExecutionRuntime(): Promise<void>
  cancelOperation(correlation: NativeOperationCorrelation): Promise<NativeCancellationControlResult>
  adoptRestoration(request: NativeRestorationAdoptionRequest): Promise<NativeRestorationAdoptionControlResult>
  closeAttachment(attachment: NativeAttachmentIdentity): Promise<void>
}

export default TurboModuleRegistry.getEnforcing<Spec>('UnifiedBleProtocolControl')
