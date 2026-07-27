/**
 * Strategic cross-host central helpers (4.0).
 *
 * Host-agnostic: duck-type {@link BleCentralLike} so RN BleManager, PortBleManager,
 * and host wrappers share one recipe path. Prefer manager.supports() before
 * scan/bond/optional surfaces; helpers fail closed with BleError where possible.
 */

import { BleErrorCode } from '../BleError'
import { expandBluetoothUuid } from '../discovery/uuidMatch'
import { base64ToBytes } from '../encoding'
import { unsupportedOperationError } from '../unsupported'
import { helperBleError, helperNotFoundError, helperTimeoutError } from './errors'
import type {
  BleCentralLike,
  ConnectAndDiscoverOptions,
  FindDeviceOptions,
  FirstNotificationOptions,
  SafeTeardownOptions,
  ScannedDeviceLike,
  TryReadOptions,
  TryReadResult,
  WaitForStateOptions
} from './types'

function targetsOf(target: string | readonly string[] | undefined): Set<string> {
  if (target == null) return new Set(['PoweredOn'])
  if (typeof target === 'string') return new Set([target])
  return new Set(target)
}

function isVoidPromise(value: void | Promise<void>): value is Promise<void> {
  return value instanceof Promise
}

/**
 * Start cleanup without allowing a synchronous host throw to escape a timer or
 * native callback. The operation that triggered cleanup must settle first.
 */
function runBestEffortCleanup(label: string, cleanup: (() => void | Promise<void>) | undefined): void {
  if (!cleanup) return
  Promise.resolve()
    .then(() => cleanup())
    .catch(error => {
      console.error(`[${label}] Cleanup failed:`, error)
    })
}

/**
 * Race `promise` against a wall-clock timeout. Does not cancel the underlying
 * work unless `onTimeout` is provided (e.g. stop scan / cancelTransaction).
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation = 'operation',
  onTimeout?: () => void | Promise<void>
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw helperBleError(BleErrorCode.InvalidIdentifiers, {
      internalMessage: 'withTimeout: timeoutMs must be a positive number'
    })
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(helperTimeoutError(operation, timeoutMs))
          runBestEffortCleanup('withTimeout', onTimeout)
        }, timeoutMs)
      })
    ])
  } finally {
    if (timer != null) clearTimeout(timer)
  }
}

/**
 * Wait until Bluetooth adapter state is one of `target` (default PoweredOn).
 *
 * - Prefer `onStateChange(..., true)` when present (RN BleManager).
 * - Else poll `state()` every 100ms.
 * - If neither API exists (many Port hosts), resolves immediately with
 *   `{ state: 'PoweredOn', assumed: true }` — port hosts without adapter state
 *   are treated as ready; document this for Electron Fake / BlueZ inject.
 */
export async function waitForState(
  manager: BleCentralLike,
  options: WaitForStateOptions = {}
): Promise<{ state: string; assumed?: boolean }> {
  const timeoutMs = options.timeoutMs ?? 15000
  const wanted = targetsOf(options.target)

  if (typeof manager.onStateChange === 'function') {
    return new Promise<{ state: string }>((resolve, reject) => {
      let settled = false
      let subscription: { remove: () => void } | null = null

      const removeSubscription = () => {
        if (!subscription) return
        try {
          subscription.remove()
        } catch (error) {
          console.error('[waitForState] Failed to remove adapter-state listener:', error)
        }
        subscription = null
      }

      const finish = (error: Error | null, state: string | null) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        removeSubscription()
        if (error) {
          reject(error)
          return
        }
        if (state) {
          resolve({ state })
          return
        }
        reject(helperTimeoutError('waitForState', timeoutMs))
      }

      const timeout = setTimeout(() => {
        finish(helperTimeoutError('waitForState', timeoutMs), null)
      }, timeoutMs)

      const onState = (state: string) => {
        if (!wanted.has(state)) return
        finish(null, state)
      }

      try {
        subscription = manager.onStateChange!(onState, true)
        // A synchronous emitCurrent callback can settle before the subscription is assigned.
        if (settled) removeSubscription()
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)), null)
        return
      }

      // Safety: if emitCurrent never fires and state() exists, issue one bounded lookup.
      if (typeof manager.state === 'function') {
        withTimeout(manager.state(), timeoutMs, 'waitForState state()').then(
          state => {
            if (wanted.has(state)) finish(null, state)
          },
          error => {
            if (!settled) {
              console.error('[waitForState] Fallback state lookup failed:', error)
            }
          }
        )
      }
    })
  }

  if (typeof manager.state === 'function') {
    const started = Date.now()

    while (true) {
      const elapsed = Date.now() - started
      const remainingMs = timeoutMs - elapsed
      if (remainingMs <= 0) {
        throw helperTimeoutError('waitForState', timeoutMs)
      }
      // A host state() call is allowed to hang; bound each query by the remaining budget.
      const state = await withTimeout(manager.state(), remainingMs, 'waitForState state()')
      if (wanted.has(state)) return { state }
      if (Date.now() - started >= timeoutMs) {
        throw helperTimeoutError('waitForState', timeoutMs)
      }
      await new Promise<void>(resolve => setTimeout(resolve, Math.min(100, timeoutMs - (Date.now() - started))))
    }
  }

  // Port hosts without adapter state surface
  return { state: 'PoweredOn', assumed: true }
}

/**
 * Scan until `predicate` matches (or timeout). Stops the scan before resolving.
 * Does **not** connect — use {@link connectAndDiscover} or manager.connectToDevice.
 *
 * Continuous-scan hosts only. Web should use `requestDevice` (helpers will reject
 * with OperationNotSupported when supports('continuousScan') is false).
 */
export async function findDevice(
  manager: BleCentralLike,
  predicate: (device: ScannedDeviceLike) => boolean,
  options: FindDeviceOptions = {}
): Promise<ScannedDeviceLike> {
  if (typeof manager.supports === 'function') {
    const ok = manager.supports('continuousScan') === true || manager.supports('scan') === true
    if (!ok) {
      throw unsupportedOperationError(
        'findDevice',
        'host has no continuous scan — use requestDevice() on web after a user gesture'
      )
    }
  }

  const timeoutMs = options.timeoutMs ?? 10000
  const serviceUUIDs = options.serviceUUIDs ?? null
  const scanOptions = options.scanOptions ?? null
  const signal = options.signal

  return new Promise<ScannedDeviceLike>((resolve, reject) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const cleanup = (fn: () => void | Promise<void>) => {
      runBestEffortCleanup('findDevice', fn)
    }

    const finish = (err: Error | null, device: ScannedDeviceLike | null) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (signal) {
        try {
          signal.removeEventListener('abort', onAbort)
        } catch (error) {
          console.error('[findDevice] Failed to remove abort listener:', error)
        }
      }
      cleanup(() => manager.stopDeviceScan())
      if (err) reject(err)
      else if (device) resolve(device)
      else reject(helperNotFoundError('findDevice', timeoutMs))
    }

    const onAbort = () => {
      finish(
        helperBleError(BleErrorCode.OperationCancelled, {
          internalMessage: 'findDevice aborted'
        }),
        null
      )
    }

    if (signal) {
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }

    timer = setTimeout(() => {
      finish(helperNotFoundError('findDevice', timeoutMs), null)
    }, timeoutMs)

    let start: void | Promise<void>
    try {
      start = manager.startDeviceScan(serviceUUIDs, scanOptions, (error, device) => {
        if (settled) return
        if (error) {
          finish(error instanceof Error ? error : new Error(String(error)), null)
          return
        }
        if (!device) return
        let matches: boolean
        try {
          matches = predicate(device)
        } catch (predicateError) {
          console.error('[findDevice] Device predicate failed:', predicateError)
          finish(predicateError instanceof Error ? predicateError : new Error(String(predicateError)), null)
          return
        }
        if (!matches) return
        finish(null, device)
      })
    } catch (startError) {
      finish(startError instanceof Error ? startError : new Error(String(startError)), null)
      return
    }

    if (isVoidPromise(start)) {
      start.catch(err => {
        finish(err instanceof Error ? err : new Error(String(err)), null)
      })
    }
  })
}

/**
 * Connect then discover services/characteristics (when API present).
 * On PortBleManager, discoverAllServicesAndCharacteristicsForDevice is available;
 * if missing, falls back to servicesForDevice when present.
 */
export async function connectAndDiscover(
  manager: BleCentralLike,
  deviceId: string,
  options: ConnectAndDiscoverOptions = {}
): Promise<{ deviceId: string; device: unknown }> {
  const timeoutMs = options.timeoutMs ?? 20000
  const id = String(deviceId || '').trim()
  if (!id) {
    throw helperBleError(BleErrorCode.InvalidIdentifiers, {
      internalMessage: 'connectAndDiscover: deviceId required'
    })
  }

  const run = async () => {
    const device = await manager.connectToDevice(id, options.connectOptions)
    if (typeof manager.discoverAllServicesAndCharacteristicsForDevice === 'function') {
      await manager.discoverAllServicesAndCharacteristicsForDevice(id)
    } else if (typeof manager.servicesForDevice === 'function') {
      await manager.servicesForDevice(id)
    }
    return { deviceId: id, device }
  }

  return withTimeout(run(), timeoutMs, 'connectAndDiscover', async () => {
    if (typeof manager.cancelDeviceConnection === 'function') {
      try {
        await manager.cancelDeviceConnection(id)
      } catch (error) {
        console.error('[connectAndDiscover] Failed to cancel connection after timeout:', error)
      }
    }
  })
}

/**
 * Wait for the first notification/indication value, then tear down the subscription.
 * Prefers AsBytes when available (default).
 */
export async function firstNotification(
  manager: BleCentralLike,
  deviceId: string,
  serviceUUID: string,
  characteristicUUID: string,
  options: FirstNotificationOptions = {}
): Promise<Uint8Array> {
  const timeoutMs = options.timeoutMs ?? 15000
  const asBytes = options.asBytes !== false
  const signal = options.signal

  const useBytes = asBytes && typeof manager.monitorCharacteristicForDeviceAsBytes === 'function'
  const useBase64 = typeof manager.monitorCharacteristicForDevice === 'function'

  if (!useBytes && !useBase64) {
    throw unsupportedOperationError('firstNotification', 'manager has no monitorCharacteristicForDevice(AsBytes)')
  }

  return new Promise<Uint8Array>((resolve, reject) => {
    let settled = false
    let subscription: { remove: () => void } | null = null

    const removeSubscription = () => {
      if (!subscription) return
      try {
        subscription.remove()
      } catch (error) {
        console.error('[firstNotification] Failed to remove notification subscription:', error)
      }
      subscription = null
    }

    const cancelTransaction = () => {
      if (!options.transactionId || typeof manager.cancelTransaction !== 'function') return
      try {
        manager.cancelTransaction(options.transactionId)
      } catch (error) {
        console.error('[firstNotification] Failed to cancel notification transaction:', error)
      }
    }

    const finish = (error: Error | null, value: Uint8Array | null) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (signal) {
        try {
          signal.removeEventListener('abort', onAbort)
        } catch (cleanupError) {
          console.error('[firstNotification] Failed to remove abort listener:', cleanupError)
        }
      }
      removeSubscription()
      cancelTransaction()
      if (error) {
        reject(error)
        return
      }
      if (value) {
        resolve(value)
        return
      }
      reject(helperTimeoutError('firstNotification', timeoutMs))
    }

    const onAbort = () => {
      finish(
        helperBleError(BleErrorCode.OperationCancelled, {
          internalMessage: 'firstNotification aborted'
        }),
        null
      )
    }

    const timeout = setTimeout(() => {
      finish(helperTimeoutError('firstNotification', timeoutMs), null)
    }, timeoutMs)

    if (signal) {
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }

    try {
      if (useBytes) {
        subscription = manager.monitorCharacteristicForDeviceAsBytes!(
          deviceId,
          serviceUUID,
          characteristicUUID,
          (error, characteristic) => {
            if (error) {
              finish(error instanceof Error ? error : new Error(String(error)), null)
              return
            }
            const value = characteristic?.value
            if (value && value.byteLength > 0) {
              finish(null, value instanceof Uint8Array ? value : new Uint8Array(value))
            }
          },
          options.transactionId ?? null,
          options.subscriptionType ?? null
        )
      } else {
        subscription = manager.monitorCharacteristicForDevice!(
          deviceId,
          serviceUUID,
          characteristicUUID,
          (error, characteristic) => {
            if (error) {
              finish(error instanceof Error ? error : new Error(String(error)), null)
              return
            }
            const base64 = characteristic?.value
            if (base64 != null && base64 !== '') {
              try {
                finish(null, base64ToBytes(base64))
              } catch (decodeError) {
                finish(decodeError instanceof Error ? decodeError : new Error(String(decodeError)), null)
              }
            }
          },
          options.transactionId ?? null,
          options.subscriptionType ?? null
        )
      }
      // A synchronous callback can settle before the monitor method returns its subscription.
      if (settled) removeSubscription()
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)), null)
    }
  })
}

/**
 * Best-effort characteristic read that does not throw for indicate-only / empty.
 * Prefer meta `isReadable === false` short-circuit when characteristicsMeta is available.
 */
export async function tryReadCharacteristicBytes(
  manager: BleCentralLike,
  deviceId: string,
  serviceUUID: string,
  characteristicUUID: string,
  options: TryReadOptions = {}
): Promise<TryReadResult> {
  const requireReadable = options.requireReadable !== false
  const asBytes = options.asBytes !== false

  if (requireReadable && typeof manager.characteristicsMetaForDevice === 'function') {
    try {
      const metas = await manager.characteristicsMetaForDevice(deviceId, serviceUUID)
      const want = expandBluetoothUuid(characteristicUUID)
      const meta = metas.find(m => expandBluetoothUuid(m.uuid) === want)
      if (meta && meta.isReadable === false) {
        return {
          ok: false,
          skipped: true,
          reason: 'not readable (indicate/notify-only; subscribe for live data)'
        }
      }
    } catch (error) {
      console.error('[tryReadCharacteristicBytes] Metadata lookup failed; attempting direct read:', error)
    }
  }

  if (asBytes && typeof manager.readCharacteristicForDeviceAsBytes === 'function') {
    try {
      const snap = await manager.readCharacteristicForDeviceAsBytes(deviceId, serviceUUID, characteristicUUID)
      const v = snap?.value
      if (v && (v.byteLength > 0 || v.length > 0)) {
        return { ok: true, value: v instanceof Uint8Array ? v : new Uint8Array(v) }
      }
      return { ok: false, skipped: true, reason: 'empty value (may be indicate/notify-only)' }
    } catch (e) {
      return {
        ok: false,
        skipped: false,
        error: e instanceof Error ? e : new Error(String(e))
      }
    }
  }

  if (typeof manager.readCharacteristicForDevice === 'function') {
    try {
      const snap = await manager.readCharacteristicForDevice(deviceId, serviceUUID, characteristicUUID)
      if (snap?.value != null && snap.value !== '') {
        return { ok: true, value: base64ToBytes(snap.value) }
      }
      return { ok: false, skipped: true, reason: 'empty value (may be indicate/notify-only)' }
    } catch (e) {
      return {
        ok: false,
        skipped: false,
        error: e instanceof Error ? e : new Error(String(e))
      }
    }
  }

  return {
    ok: false,
    skipped: true,
    reason: 'host has no readCharacteristicForDevice(AsBytes)'
  }
}

/**
 * Fail closed when `manager.supports(capability)` is not true.
 * No-op (returns) when supports() is absent — caller owns honesty.
 */
export function assertSupported(manager: BleCentralLike, capability: string, detail?: string): void {
  if (typeof manager.supports !== 'function') return
  if (manager.supports(capability) === true) return
  throw unsupportedOperationError(capability, detail ?? `supports('${capability}') is not true`)
}

/**
 * Best-effort teardown: stop scan, cancel connections, optional destroy.
 * Swallows individual failures; returns a list of warnings.
 */
export async function safeTeardown(
  manager: BleCentralLike,
  options: SafeTeardownOptions = {}
): Promise<{ warnings: string[] }> {
  const warnings: string[] = []
  const stopScan = options.stopScan !== false

  if (stopScan && typeof manager.stopDeviceScan === 'function') {
    try {
      await manager.stopDeviceScan()
    } catch (e) {
      warnings.push(`stopDeviceScan: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  for (const id of options.deviceIds ?? []) {
    if (typeof manager.cancelDeviceConnection !== 'function') break
    try {
      await manager.cancelDeviceConnection(id)
    } catch (e) {
      warnings.push(`cancelDeviceConnection(${id}): ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  if (options.destroy && typeof manager.destroy === 'function') {
    try {
      await manager.destroy()
    } catch (e) {
      warnings.push(`destroy: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return { warnings }
}
