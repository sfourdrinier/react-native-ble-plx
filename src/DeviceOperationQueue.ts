/**
 * Per-device operation serialization for multi-host managers (4.0 Phase 2).
 * Ensures GATT ops against the same device id do not interleave.
 */

import { BleError, BleErrorCode, BleErrorCodeMessage } from './BleError'

export type DeviceQueueKey = string

/** Legacy error name retained for multi-host cancel detection (prefer BleError.errorCode). */
export const DEVICE_QUEUE_CANCELLED = 'DeviceQueueCancelled'

/**
 * Build a typed cancel error for queue preemption / long-write abort.
 * Callers that only branch on {@link BleError#errorCode} see OperationCancelled.
 */
export function deviceQueueCancelledError(reason = 'Device operation cancelled by disconnect'): BleError {
  const err = new BleError(
    {
      errorCode: BleErrorCode.OperationCancelled,
      attErrorCode: null,
      iosErrorCode: null,
      androidErrorCode: null,
      reason
    },
    BleErrorCodeMessage
  )
  // Keep legacy name for multi-host cancel detection; prefer errorCode (R2-F028).
  err.name = DEVICE_QUEUE_CANCELLED
  return err
}

/** True when an error is queue/disconnect cancel (or manager destroy cancel). */
export function isDeviceQueueCancelError(error: unknown): boolean {
  if (error instanceof BleError) {
    return (
      error.errorCode === BleErrorCode.OperationCancelled ||
      error.errorCode === BleErrorCode.BluetoothManagerDestroyed ||
      // Link-loss / not-connected must fail closed in long-write even with stopOnError:false (R3-F001).
      error.errorCode === BleErrorCode.DeviceNotConnected ||
      error.errorCode === BleErrorCode.DeviceDisconnected
    )
  }
  if (error && typeof error === 'object' && 'name' in error) {
    if ((error as { name: string }).name === DEVICE_QUEUE_CANCELLED) return true
  }
  // Port-level plain Errors (e.g. FakeBlePort assertConnected) after link-loss.
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    if (
      msg.includes('not connected') ||
      msg.includes('link loss') ||
      msg.includes('link-loss') ||
      msg.includes('disconnected')
    ) {
      return true
    }
  }
  return false
}

/**
 * FIFO async queue keyed by device id (case-insensitive MAC/UUID).
 * Supports cooperative cancel (epoch bump) so disconnect can preempt pending work
 * and long-writes can stop between chunks.
 *
 * Settled tails are removed as soon as the last pending op for a key finishes
 * (F093), so long-lived managers that talk to many devices do not retain a
 * Promise per device forever. {@link prune} is a residual GC hook (also called
 * from BleManager.destroy).
 */
export class DeviceOperationQueue {
  private readonly tails = new Map<string, Promise<unknown>>()
  /** In-flight + queued ops per device (for GC / activeDeviceCount). */
  private readonly pending = new Map<string, number>()
  /** Bumped on cancel/disconnect to invalidate not-yet-started ops. */
  private readonly epoch = new Map<string, number>()
  /** Error to throw for ops superseded by the latest epoch bump for a key. */
  private readonly cancelErrors = new Map<string, Error>()

  normalizeKey(deviceId: string): string {
    return deviceId.trim().toUpperCase()
  }

  /** Current cancel epoch for a device (for cooperative long-write checks). */
  currentEpoch(deviceId: string): number {
    return this.epoch.get(this.normalizeKey(deviceId)) ?? 0
  }

  /**
   * True when the device epoch has moved past `capturedEpoch`
   * (cancel/disconnect was requested while the op was running or waiting).
   */
  isCancelled(deviceId: string, capturedEpoch: number): boolean {
    return this.currentEpoch(deviceId) !== capturedEpoch
  }

  /**
   * Run `fn` after all prior ops for this device settle (success or failure).
   * Errors from `fn` reject the returned promise but do not break the queue.
   * Ops that have not started when {@link enqueueCancel} bumps the epoch reject
   * with {@link BleErrorCode.OperationCancelled}.
   *
   * The returned promise settles only after the op is released from the queue
   * bookkeeping, so `activeDeviceCount()` is accurate after `await enqueue(...)`.
   */
  enqueue<T>(deviceId: string, fn: () => Promise<T>): Promise<T> {
    const key = this.normalizeKey(deviceId)
    const capturedEpoch = this.currentEpoch(deviceId)
    this.pending.set(key, (this.pending.get(key) ?? 0) + 1)

    const prev = this.tails.get(key) ?? Promise.resolve()
    const run = prev.then(
      () => this.runIfCurrentEpoch(key, capturedEpoch, fn),
      () => this.runIfCurrentEpoch(key, capturedEpoch, fn)
    )

    // Release bookkeeping before the caller's await resolves (F093).
    const result = run.finally(() => {
      this.release(key)
    })

    // Tail chain must never reject so subsequent ops always schedule.
    const tail = result.then(
      () => undefined,
      () => undefined
    )
    this.tails.set(key, tail)
    return result
  }

  /**
   * Priority disconnect path: bump epoch so waiting ops fail, then run `fn`
   * after the current in-flight op settles (does not wait for other pending work
   * beyond the chain — superseded ops short-circuit).
   */
  enqueueCancel<T>(deviceId: string, fn: () => Promise<T>): Promise<T> {
    const key = this.normalizeKey(deviceId)
    this.bumpEpoch(key, deviceQueueCancelledError())
    return this.enqueue(deviceId, fn)
  }

  /**
   * Bump cancel epoch for a single device so queued-not-started ops fail and
   * cooperative long-writes abort between chunks. Used by unexpected disconnect
   * fan-out (R3-F001) without waiting for a disconnect write to enqueue.
   */
  cancelDevice(deviceId: string, error: Error = deviceQueueCancelledError()): void {
    this.bumpEpoch(this.normalizeKey(deviceId), error)
  }

  /**
   * Bump cancel epoch for every known device key so queued-not-started ops fail.
   * Used by BleManager.destroy to fail closed with BluetoothManagerDestroyed.
   */
  cancelAll(error: Error = deviceQueueCancelledError()): void {
    const keys = new Set<string>([...this.tails.keys(), ...this.pending.keys(), ...this.epoch.keys()])
    for (const key of keys) {
      this.bumpEpoch(key, error)
    }
  }

  private bumpEpoch(key: string, error: Error): void {
    this.epoch.set(key, (this.epoch.get(key) ?? 0) + 1)
    this.cancelErrors.set(key, error)
  }

  private async runIfCurrentEpoch<T>(key: string, capturedEpoch: number, fn: () => Promise<T>): Promise<T> {
    if ((this.epoch.get(key) ?? 0) !== capturedEpoch) {
      throw this.cancelErrors.get(key) ?? deviceQueueCancelledError()
    }
    return fn()
  }

  private release(key: string): void {
    const n = (this.pending.get(key) ?? 1) - 1
    if (n <= 0) {
      this.pending.delete(key)
      // No remaining ops: drop tail so activeDeviceCount shrinks (F093).
      this.tails.delete(key)
      // R3-F052: drop cancel bookkeeping for idle keys (many-device GC).
      this.cancelErrors.delete(key)
      // Keep epoch counter (monotonic) but allow prune() to clear idle epochs too.
    } else {
      this.pending.set(key, n)
    }
  }

  /** Number of devices with a pending/in-flight tail (for tests). */
  activeDeviceCount(): number {
    return this.tails.size
  }

  /**
   * Drop settled tails (GC for long-lived managers that talk to many devices).
   * Entries with no remaining pending ops are removed immediately; in-flight
   * keys are left alone until they settle.
   */
  prune(): void {
    for (const key of [...this.tails.keys()]) {
      if ((this.pending.get(key) ?? 0) <= 0) {
        this.tails.delete(key)
        this.pending.delete(key)
        this.cancelErrors.delete(key)
      }
    }
    // Drop cancelErrors for keys with no pending/tail (R3-F052).
    for (const key of [...this.cancelErrors.keys()]) {
      if ((this.pending.get(key) ?? 0) <= 0 && !this.tails.has(key)) {
        this.cancelErrors.delete(key)
      }
    }
  }
}
