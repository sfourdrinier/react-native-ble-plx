/**
 * Long-write helper: chunk a payload into ATT-sized writes (4.0 Phase 2 software path).
 * Does not talk to radio directly — callers pass a write function (port or BleManager).
 */

import { isDeviceQueueCancelError } from './DeviceOperationQueue'

export type LongWriteOptions = {
  /** Max payload bytes per write (ATT MTU − 3 for write with response, typically). Default 20. */
  chunkSize?: number
  /**
   * When true (default), stop on first write failure.
   * Cancel/disconnect errors (OperationCancelled / DeviceQueueCancelled / destroy)
   * are always rethrown regardless of this flag.
   */
  stopOnError?: boolean
}

export type LongWriteResult = {
  bytesWritten: number
  chunks: number
}

/**
 * Write `value` as sequential chunks via `writeChunk`.
 * Uses shipped encoding-agnostic bytes; callers supply Base64 edge if needed.
 */
export async function writeLongCharacteristicFromBytes(
  value: Uint8Array,
  writeChunk: (chunk: Uint8Array, offset: number, index: number) => Promise<void>,
  options: LongWriteOptions = {}
): Promise<LongWriteResult> {
  if (!(value instanceof Uint8Array)) {
    throw new TypeError('writeLongCharacteristicFromBytes expects Uint8Array')
  }
  const chunkSize = options.chunkSize ?? 20
  if (!Number.isFinite(chunkSize) || chunkSize < 1) {
    throw new RangeError('chunkSize must be a positive number')
  }
  const stopOnError = options.stopOnError !== false
  let bytesWritten = 0
  let chunks = 0
  for (let offset = 0; offset < value.length; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, value.length)
    const chunk = value.subarray(offset, end)
    try {
      await writeChunk(chunk, offset, chunks)
      bytesWritten += chunk.length
      chunks += 1
    } catch (e) {
      // Always fail closed on cancel/disconnect/destroy (R2-F085).
      if (isDeviceQueueCancelError(e) || stopOnError) throw e
    }
  }
  return { bytesWritten, chunks }
}
