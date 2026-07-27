// spikes/rn-jsi-binary/specs/NativeUb4JsiBinaryBootstrap.ts

import type { TurboModule } from 'react-native'
import { TurboModuleRegistry } from 'react-native'

export interface VersionRange {
  minimum: number
  maximum: number
}

export interface BinaryHandshakeRequest {
  nativeProtocol: VersionRange
  abi: VersionRange
  backendContract: VersionRange
  capabilitySchema: VersionRange
  eventSchema: VersionRange
  traceFormat: VersionRange
  owner: string
  backendGeneration: number
}

export interface BinaryHandshakeResult {
  nativeProtocol: number
  abi: number
  backendContract: number
  capabilitySchema: number
  eventSchema: number
  traceFormat: number
  maximumPayloadBytes: number
}

/** Control-only bootstrap: it activates the private JSI binding after exact range negotiation. */
export interface Spec extends TurboModule {
  handshake(request: BinaryHandshakeRequest): Promise<BinaryHandshakeResult>
  emitProbe(): Promise<void>
}

export default TurboModuleRegistry.getEnforcing<Spec>('Ub4JsiBinaryBootstrap')
