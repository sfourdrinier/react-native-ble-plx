/**
 * Base64 ↔ bytes edge codecs for the 4.0 dual-path contract.
 * Internal radio path is bytes; Base64 is the public compat edge only.
 *
 * Avoid TypeScript `Buffer` global types so RN/Expo apps typecheck without @types/node.
 */

type NodeBufferLike = {
  from(data: string, encoding: string): { buffer: ArrayBufferLike; byteOffset: number; byteLength: number } & Uint8Array
  from(arrayBuffer: ArrayBufferLike, byteOffset?: number, length?: number): {
    toString(encoding: string): string
  }
}

function nodeBuffer(): NodeBufferLike | undefined {
  const g = globalThis as { Buffer?: NodeBufferLike }
  return typeof g.Buffer !== 'undefined' ? g.Buffer : undefined
}

/** Convert a standard Base64 string to Uint8Array. */
export function base64ToBytes(base64: string): Uint8Array {
  if (typeof base64 !== 'string') {
    throw new TypeError('base64ToBytes expects a string')
  }
  if (base64.length === 0) {
    return new Uint8Array(0)
  }
  const Buf = nodeBuffer()
  if (Buf) {
    return new Uint8Array(Buf.from(base64, 'base64'))
  }
  // Browser / Hermes with atob
  const binary = globalThis.atob(base64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i)
  }
  return out
}

/** Convert Uint8Array (or ArrayBuffer view) to standard Base64 string. */
export function bytesToBase64(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('bytesToBase64 expects a Uint8Array')
  }
  if (bytes.length === 0) {
    return ''
  }
  const Buf = nodeBuffer()
  if (Buf) {
    return Buf.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
  }
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return globalThis.btoa(binary)
}

/** Round-trip identity check helper used in tests and migration tooling. */
export function roundTripBase64(base64: string): string {
  return bytesToBase64(base64ToBytes(base64))
}
