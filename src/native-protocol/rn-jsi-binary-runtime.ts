// src/native-protocol/rn-jsi-binary-runtime.ts

import { contractError } from '../backend-contract/errors'
import { byteLimit, ownBytes, type OwnedBytes } from '../backend-contract/primitives'

export interface NativeBinaryReference {
  readonly ownerToken: string
  readonly operationCorrelation: string
  readonly byteOffset: number
  readonly byteLength: number
  readonly ownership: 'nativeOwnedCopy'
}

export interface NativeProtocolBinaryRuntime {
  retain(operationCorrelation: string, value: Uint8Array): NativeBinaryReference
  copy(reference: NativeBinaryReference): Uint8Array
  release(reference: NativeBinaryReference): boolean
  submit(command: Uint8Array): void
  setEventSink(listener: (record: Uint8Array) => void): void
  retainedByteCount(): number
  retainedPayloadCount(): number
}

declare global {
  var __unifiedBleNativeProtocolV1: NativeProtocolBinaryRuntime | undefined
}

/** Returns the installed Android JSI binary transport and rejects every absent/stale boundary. */
export function requireNativeProtocolBinaryRuntime(): NativeProtocolBinaryRuntime {
  const runtime = globalThis.__unifiedBleNativeProtocolV1
  if (runtime === undefined) {
    throw contractError('capability.unavailable', 'boundary', 'rn-jsi-binary-runtime.require')
  }
  return runtime
}

/** Copies caller-owned bytes into the native protocol before radio dispatch. */
export function retainNativeProtocolBytes(
  operationCorrelation: string,
  value: Readonly<Uint8Array>
): NativeBinaryReference {
  if (operationCorrelation.length === 0) {
    throw contractError('argument.invalid', 'boundary', 'rn-jsi-binary-runtime.retain')
  }
  const copy = new Uint8Array(value)
  return requireNativeProtocolBinaryRuntime().retain(operationCorrelation, copy)
}

/** Returns an independently owned JS copy of bytes retained by the native protocol. */
export function copyNativeProtocolBytes(reference: NativeBinaryReference): OwnedBytes {
  const copy = requireNativeProtocolBinaryRuntime().copy(reference)
  return ownBytes(new Uint8Array(copy), byteLimit(copy.byteLength))
}

/** Releases a retained payload exactly once; stale/foreign references fail closed in native code. */
export function releaseNativeProtocolBytes(reference: NativeBinaryReference): boolean {
  return requireNativeProtocolBinaryRuntime().release(reference)
}

/** Submits one already-validated canonical command record to the Android radio dispatcher. */
export function submitNativeProtocolCommand(command: Uint8Array): void {
  requireNativeProtocolBinaryRuntime().submit(new Uint8Array(command))
}

/** Installs the single attachment-scoped native event sink. */
export function setNativeProtocolEventSink(listener: (record: Uint8Array) => void): void {
  requireNativeProtocolBinaryRuntime().setEventSink(listener)
}
