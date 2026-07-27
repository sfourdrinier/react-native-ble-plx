/**
 * Base64 ↔ bytes edge codecs for the 4.0 dual-path contract.
 * Internal radio path is bytes; Base64 is the public compat edge only.
 *
 * Avoid TypeScript `Buffer` global types so RN/Expo apps typecheck without @types/node.
 */

type NodeBufferLike = {
  from(data: string, encoding: string): { buffer: ArrayBufferLike; byteOffset: number; byteLength: number } & Uint8Array
  from(
    arrayBuffer: ArrayBufferLike,
    byteOffset?: number,
    length?: number
  ): {
    toString(encoding: string): string
  }
}

function nodeBuffer(): NodeBufferLike | undefined {
  const g = globalThis as { Buffer?: NodeBufferLike }
  return typeof g.Buffer !== 'undefined' ? g.Buffer : undefined
}

/** Standard Base64 alphabet + optional padding; rejects whitespace and url-safe variants. */
const STRICT_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

function assertValidBase64(base64: string): void {
  if (!STRICT_BASE64.test(base64)) {
    throw new TypeError('Invalid Base64 string')
  }
}

/** Convert a standard Base64 string to Uint8Array. Rejects invalid alphabet/padding. */
export function base64ToBytes(base64: string): Uint8Array {
  if (typeof base64 !== 'string') {
    throw new TypeError('base64ToBytes expects a string')
  }
  if (base64.length === 0) {
    return new Uint8Array(0)
  }
  assertValidBase64(base64)
  const Buf = nodeBuffer()
  if (Buf) {
    // STRICT_BASE64 pre-check above rejects invalid alphabet/padding.
    // Node Buffer.from is used only after that gate (R2-F120).
    return new Uint8Array(Buf.from(base64, 'base64'))
  }
  // Browser / Hermes with atob
  try {
    const binary = globalThis.atob(base64)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      out[i] = binary.charCodeAt(i)
    }
    return out
  } catch {
    throw new TypeError('Invalid Base64 string')
  }
}

const ENCODE_CHUNK = 0x8000

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
  // Chunked encode avoids O(n²) string growth on large payloads (scan records, long reads).
  const parts: string[] = []
  for (let i = 0; i < bytes.length; i += ENCODE_CHUNK) {
    const end = Math.min(i + ENCODE_CHUNK, bytes.length)
    let chunk = ''
    for (let j = i; j < end; j++) {
      chunk += String.fromCharCode(bytes[j]!)
    }
    parts.push(chunk)
  }
  return globalThis.btoa(parts.join(''))
}

/** Round-trip identity check helper used in tests and migration tooling. */
export function roundTripBase64(base64: string): string {
  return bytesToBase64(base64ToBytes(base64))
}
