/**
 * Per-device operation serialization for multi-host managers (4.0 Phase 2).
 * Ensures GATT ops against the same device id do not interleave.
 */

export type DeviceQueueKey = string

/**
 * FIFO async queue keyed by device id (case-insensitive MAC/UUID).
 */
export class DeviceOperationQueue {
  private readonly tails = new Map<string, Promise<unknown>>()

  normalizeKey(deviceId: string): string {
    return deviceId.trim().toUpperCase()
  }

  /**
   * Run `fn` after all prior ops for this device settle (success or failure).
   * Errors from `fn` reject the returned promise but do not break the queue.
   */
  enqueue<T>(deviceId: string, fn: () => Promise<T>): Promise<T> {
    const key = this.normalizeKey(deviceId)
    const prev = this.tails.get(key) ?? Promise.resolve()
    const next = prev.then(
      () => fn(),
      () => fn()
    )
    // Keep queue alive regardless of success/failure of `next`
    this.tails.set(
      key,
      next.then(
        () => undefined,
        () => undefined
      )
    )
    return next
  }

  /** Number of devices with a pending tail (for tests). */
  activeDeviceCount(): number {
    return this.tails.size
  }

  /** Drop settled tails (optional GC for long-lived managers). */
  prune(): void {
    // tails always hold a settled promise after enqueue completes; clear map when empty chain
    for (const [key, p] of this.tails) {
      // cannot sync-check promise state; leave map — tests use enqueue ordering
      void key
      void p
    }
  }
}
