// src/codecs-primitives.ts

/** Creates a view over exactly the supplied Uint8Array range without copying. */
export function dataView(bytes: Readonly<Uint8Array>): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

/** Returns a receiver-owned byte copy for codec consumers that retain a payload. */
export function copyBytes(bytes: Readonly<Uint8Array>): Uint8Array {
  return new Uint8Array(bytes)
}
