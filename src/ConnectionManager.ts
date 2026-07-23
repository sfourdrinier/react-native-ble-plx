import { Device } from './Device'
import { BleError, BleErrorCode, BleErrorCodeMessage } from './BleError'
import type { BleManager } from './BleManager'
import type { DeviceId, ConnectionOptions, Subscription } from './TypeDefinition'

/**
 * Connection options with retry and timeout support
 */
export interface ConnectionOptionsWithRetry {
  /**
   * Connection options to pass to the device
   */
  connectionOptions?: ConnectionOptions

  /**
   * Maximum number of connection attempts, including the first try (default: 3).
   * Example: `maxRetries: 1` means a single attempt with no retries;
   * `maxRetries: 3` means up to three total attempts.
   */
  maxRetries?: number

  /**
   * Initial delay before first retry in milliseconds (default: 1000)
   */
  initialDelayMs?: number

  /**
   * Maximum delay between retries in milliseconds (default: 30000)
   */
  maxDelayMs?: number

  /**
   * Multiplier for exponential backoff (default: 2)
   */
  backoffMultiplier?: number

  /**
   * Connection timeout in milliseconds (default: 30000)
   * Set to 0 to disable timeout
   */
  timeoutMs?: number
}

/**
 * Auto-reconnection options
 */
export interface AutoReconnectOptions extends ConnectionOptionsWithRetry {
  /**
   * Enable automatic reconnection on unexpected disconnects
   */
  enabled: boolean
}

/**
 * Event callbacks for connection events
 */
export interface ConnectionCallbacks {
  /**
   * Called when a device successfully connects or reconnects
   */
  onConnect?: (device: Device) => void

  /**
   * Called when connection fails after all retries
   */
  onConnectFailed?: (deviceId: DeviceId, error: BleError) => void

  /**
   * Called when a connection attempt starts (includes retry attempts)
   */
  onConnecting?: (deviceId: DeviceId, attempt: number, maxAttempts: number) => void

  /**
   * Called when a device disconnects unexpectedly
   */
  onDisconnect?: (deviceId: DeviceId, error: BleError | null) => void
}

type ResolvedConnectionOptions = {
  connectionOptions?: ConnectionOptions
  maxRetries: number
  initialDelayMs: number
  maxDelayMs: number
  backoffMultiplier: number
  timeoutMs: number
}

const ignoreConnectionCancellationError = () => {
  // Native cancellation can reject if the connection already ended.
}

/**
 * Internal state for a device connection
 */
interface DeviceConnectionState {
  deviceId: DeviceId
  options: ResolvedConnectionOptions
  reconnectOptions?: ResolvedConnectionOptions
  isConnecting: boolean
  retryCount: number
  timeoutId?: ReturnType<typeof setTimeout>
  connectionTimeoutId?: ReturnType<typeof setTimeout>
  disconnectSubscription?: Subscription
  autoReconnect: boolean
  callbacks?: ConnectionCallbacks
  cancelled: boolean
  attemptId: number // Generation token to invalidate old async attempts
  /** True while attemptConnectOnce owns the in-flight attempt for this device. */
  gatedAttempt: boolean
  /**
   * After user cancel of an in-flight connect on an auto-reconnect device, ignore the
   * next disconnect for auto-rearm (that disconnect is from cancelDeviceConnection).
   */
  suppressNextAutoReconnect?: boolean
  pendingPromise?: {
    resolve: (device: Device) => void
    reject: (error: BleError) => void
  }
}

/** Reject reason used when settling promises during destroy. */
const DESTROY_CANCEL_REASON = 'ConnectionManager destroyed'

const DEFAULT_CONNECT_MAX_RETRIES = 3
const DEFAULT_AUTO_MAX_RETRIES = 5
const DEFAULT_INITIAL_DELAY_MS = 1000
const DEFAULT_MAX_DELAY_MS = 30000
const DEFAULT_BACKOFF_MULTIPLIER = 2
const DEFAULT_TIMEOUT_MS = 30000

function makeBleError(errorCode: BleErrorCode, reason: string): BleError {
  return new BleError(
    {
      errorCode,
      attErrorCode: null,
      iosErrorCode: null,
      androidErrorCode: null,
      reason
    },
    BleErrorCodeMessage
  )
}

function resolveConnectionOptions(
  options: ConnectionOptionsWithRetry | undefined,
  defaults: { maxRetries: number }
): ResolvedConnectionOptions {
  return {
    maxRetries: options?.maxRetries ?? defaults.maxRetries,
    initialDelayMs: options?.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS,
    maxDelayMs: options?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS,
    backoffMultiplier: options?.backoffMultiplier ?? DEFAULT_BACKOFF_MULTIPLIER,
    timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    connectionOptions: options?.connectionOptions
  }
}

/**
 * ConnectionManager unifies connection queuing, retry logic, and automatic reconnection.
 *
 * This manager is the single supported reliability API (older ConnectionQueue /
 * ReconnectionManager helpers were removed). It keeps a unified state machine per
 * device to prevent conflicts and connection storms.
 *
 * Features:
 * - Single connection state per device (no competing retry engines)
 * - Concurrent connections to different devices
 * - Exponential backoff retry logic
 * - Configurable connection timeout
 * - Automatic reconnection on unexpected disconnects
 * - Comprehensive event callbacks
 *
 * @example
 * const manager = new ConnectionManager(bleManager);
 *
 * // Connect with retry logic
 * const device = await manager.connect('AA:BB:CC:DD:EE:FF', {
 *   maxRetries: 5,
 *   timeoutMs: 15000,
 *   backoffMultiplier: 1.5
 * });
 *
 * // Enable auto-reconnect for a device
 * manager.enableAutoReconnect('AA:BB:CC:DD:EE:FF', {
 *   maxRetries: 10,
 *   initialDelayMs: 2000
 * }, {
 *   onConnect: (device) => console.log('Connected!', device.id),
 *   onDisconnect: (deviceId, error) => console.log('Disconnected', deviceId)
 * });
 *
 * // Cancel a connection
 * manager.cancel('AA:BB:CC:DD:EE:FF');
 */
export class ConnectionManager {
  private _manager: BleManager
  private _devices: Map<DeviceId, DeviceConnectionState> = new Map()
  private _globalCallbacks: ConnectionCallbacks = {}
  /** True while destroy() is tearing down — suppress re-arm from callbacks/promise handlers. */
  private _destroying = false

  constructor(manager: BleManager) {
    this._manager = manager
  }

  /**
   * Set global callbacks for all connection events.
   *
   * @param callbacks Callback functions for connection events
   */
  setGlobalCallbacks(callbacks: ConnectionCallbacks): void {
    this._globalCallbacks = callbacks
  }

  /**
   * Connect to a device with retry logic and timeout.
   *
   * @param deviceId Device identifier to connect to
   * @param options Connection and retry options
   * @returns Promise resolving to connected Device
   */
  connect(deviceId: DeviceId, options?: ConnectionOptionsWithRetry): Promise<Device> {
    return this._beginConnect(deviceId, options, { gated: false })
  }

  /**
   * Exactly one race-hardened connect attempt. No internal retries and no auto re-arm.
   * Mutually exclusive with auto-reconnect for this deviceId (D1 strict coalesce).
   *
   * @param deviceId Device identifier to connect to
   * @param options Connection options; `maxRetries` is forced to 1 (single attempt)
   * @returns Promise resolving to connected Device
   */
  attemptConnectOnce(deviceId: DeviceId, options?: ConnectionOptionsWithRetry): Promise<Device> {
    return this._beginConnect(deviceId, options, { gated: true })
  }

  /**
   * Shared connect entry for {@link connect} and {@link attemptConnectOnce}.
   * @private
   */
  private _beginConnect(
    deviceId: DeviceId,
    options: ConnectionOptionsWithRetry | undefined,
    mode: { gated: boolean }
  ): Promise<Device> {
    if (this._destroying) {
      return Promise.reject(makeBleError(BleErrorCode.OperationCancelled, DESTROY_CANCEL_REASON))
    }

    if (mode.gated && this.isAutoReconnectEnabled(deviceId)) {
      return Promise.reject(
        makeBleError(
          BleErrorCode.OperationStartFailed,
          `attemptConnectOnce is not allowed while auto-reconnect is enabled for device ${deviceId}`
        )
      )
    }

    if (mode.gated && options?.maxRetries != null && options.maxRetries !== 1) {
      console.warn(
        `[ConnectionManager] attemptConnectOnce ignores maxRetries=${options.maxRetries}; single attempt only`
      )
    }

    const existing = this._devices.get(deviceId)

    // D1: gated must not join any non-gated in-flight connect (strict coalesce)
    if (mode.gated && existing && existing.pendingPromise && !existing.cancelled && !existing.gatedAttempt) {
      return Promise.reject(
        makeBleError(
          BleErrorCode.OperationStartFailed,
          `attemptConnectOnce cannot join a non-gated in-flight connect for device ${deviceId}`
        )
      )
    }

    // Coalesce: normal connect joins any in-flight pending; gated only joins gated
    const canCoalesce =
      existing && existing.pendingPromise && !existing.cancelled && (!mode.gated || existing.gatedAttempt)

    if (canCoalesce && existing.pendingPromise) {
      const pending = existing.pendingPromise
      return new Promise((resolve, reject) => {
        const originalResolve = pending.resolve
        const originalReject = pending.reject

        pending.resolve = (device: Device) => {
          originalResolve(device)
          resolve(device)
        }

        pending.reject = (error: BleError) => {
          originalReject(error)
          reject(error)
        }
      })
    }

    return new Promise((resolve, reject) => {
      if (existing) {
        if (existing.pendingPromise) {
          existing.pendingPromise.reject(
            makeBleError(BleErrorCode.OperationCancelled, `Connection attempt replaced for device ${deviceId}`)
          )
        }
        this._cancelState(existing)
      }

      const connectionOptions = resolveConnectionOptions(options, {
        maxRetries: mode.gated ? 1 : DEFAULT_CONNECT_MAX_RETRIES
      })
      if (mode.gated) {
        connectionOptions.maxRetries = 1
      }

      const state: DeviceConnectionState = {
        deviceId,
        options: connectionOptions,
        reconnectOptions: mode.gated ? undefined : existing?.reconnectOptions,
        isConnecting: false,
        retryCount: 0,
        autoReconnect: mode.gated ? false : (existing?.autoReconnect ?? false),
        callbacks: existing?.callbacks,
        // Keep the same disconnect subscription for non-gated replace — also inherit
        // suppressNextAutoReconnect so a cancel-induced disconnect from the old attempt
        // does not re-arm auto on top of the replacement connect.
        disconnectSubscription: mode.gated ? undefined : existing?.disconnectSubscription,
        suppressNextAutoReconnect: mode.gated ? false : (existing?.suppressNextAutoReconnect ?? false),
        cancelled: false,
        attemptId: existing ? existing.attemptId + 1 : 0,
        gatedAttempt: mode.gated,
        pendingPromise: { resolve, reject }
      }

      this._devices.set(deviceId, state)
      this._attemptConnection(state)
    })
  }

  /**
   * Enable automatic reconnection for a device.
   *
   * @param deviceId Device identifier
   * @param options Connection and retry options for reconnection
   * @param callbacks Optional callbacks for this specific device
   * @throws {BleError} OperationStartFailed if attemptConnectOnce is in flight for this device
   */
  enableAutoReconnect(deviceId: DeviceId, options?: ConnectionOptionsWithRetry, callbacks?: ConnectionCallbacks): void {
    if (this._destroying) {
      throw makeBleError(BleErrorCode.OperationCancelled, DESTROY_CANCEL_REASON)
    }

    const existingForGuard = this._devices.get(deviceId)
    // In-flight means native connect still active (isConnecting). After native settles,
    // onConnect may call enableAutoReconnect before pendingPromise is cleared — that must succeed.
    if (
      existingForGuard?.gatedAttempt &&
      existingForGuard.isConnecting &&
      existingForGuard.pendingPromise &&
      !existingForGuard.cancelled
    ) {
      throw makeBleError(
        BleErrorCode.OperationStartFailed,
        `enableAutoReconnect is not allowed while attemptConnectOnce is in flight for device ${deviceId}`
      )
    }

    // If already exists, update settings
    let state = this._devices.get(deviceId)
    const existingReconnectOptions = state?.reconnectOptions

    const reconnectOptions = resolveConnectionOptions(
      {
        maxRetries: options?.maxRetries ?? existingReconnectOptions?.maxRetries,
        initialDelayMs: options?.initialDelayMs ?? existingReconnectOptions?.initialDelayMs,
        maxDelayMs: options?.maxDelayMs ?? existingReconnectOptions?.maxDelayMs,
        backoffMultiplier: options?.backoffMultiplier ?? existingReconnectOptions?.backoffMultiplier,
        timeoutMs: options?.timeoutMs ?? existingReconnectOptions?.timeoutMs,
        connectionOptions: options?.connectionOptions ?? existingReconnectOptions?.connectionOptions
      },
      { maxRetries: DEFAULT_AUTO_MAX_RETRIES }
    )

    if (state) {
      // Update existing state
      state.autoReconnect = true
      state.gatedAttempt = false
      state.callbacks = callbacks
      state.reconnectOptions = reconnectOptions
      state.options = { ...reconnectOptions }
    } else {
      state = {
        deviceId,
        options: reconnectOptions,
        reconnectOptions,
        isConnecting: false,
        retryCount: 0,
        autoReconnect: true,
        callbacks,
        cancelled: false,
        attemptId: 0,
        gatedAttempt: false
      }

      this._devices.set(deviceId, state)
    }

    // Subscribe to disconnection events if not already subscribed
    if (!state.disconnectSubscription) {
      state.disconnectSubscription = this._manager.onDeviceDisconnected(deviceId, (error, _device) => {
        const currentState = this._devices.get(deviceId)
        if (!currentState) return

        // Notify disconnect callbacks
        currentState.callbacks?.onDisconnect?.(deviceId, error)
        this._globalCallbacks.onDisconnect?.(deviceId, error)

        // User cancel of an in-flight connect fires cancelDeviceConnection → disconnect.
        // That disconnect must not immediately re-arm auto-reconnect.
        if (currentState.suppressNextAutoReconnect) {
          currentState.suppressNextAutoReconnect = false
          return
        }

        // Auto-reconnect on ANY disconnect unless explicitly cancelled
        // This handles all platform behaviors including quirky null-error disconnects
        if (currentState.autoReconnect && !currentState.cancelled) {
          this._startReconnection(deviceId)
        }
      })
    }
  }

  /**
   * Disable automatic reconnection for a device.
   *
   * @param deviceId Device identifier
   * @returns True if auto-reconnect was disabled, false if it wasn't enabled
   */
  disableAutoReconnect(deviceId: DeviceId): boolean {
    const state = this._devices.get(deviceId)
    if (!state || !state.autoReconnect) {
      return false
    }

    state.autoReconnect = false

    // If not currently connecting, clean up
    if (!state.isConnecting && !state.pendingPromise) {
      this._cancelState(state)
      this._devices.delete(deviceId)
    }

    return true
  }

  /**
   * Cancel a pending or in-progress connection attempt.
   *
   * @param deviceId Device identifier to cancel connection for
   * @returns True if a connection was cancelled
   */
  cancel(deviceId: DeviceId): boolean {
    const state = this._devices.get(deviceId)
    if (!state) {
      return false
    }

    // attemptId invalidation + isConnecting clear + native cancel happen in _cancelState
    this._cancelState(state)

    // Only reject promise and call callbacks if there was actually a pending connection
    if (state.pendingPromise) {
      const error = makeBleError(
        BleErrorCode.OperationCancelled,
        this._destroying ? DESTROY_CANCEL_REASON : `Connection cancelled for device ${deviceId}`
      )

      // Reject pending promise
      state.pendingPromise.reject(error)
      state.pendingPromise = undefined

      // Skip failure callbacks during destroy so app handlers cannot start a new connect
      // after the deviceIds snapshot (would leave native work + unsettled promises).
      if (!this._destroying) {
        state.callbacks?.onConnectFailed?.(deviceId, error)
        this._globalCallbacks.onConnectFailed?.(deviceId, error)
      }
    }

    // For auto-reconnect devices, reset cancelled flag so future disconnects can trigger reconnection
    // (unless we are destroying the whole manager).
    if (state.autoReconnect && !this._destroying) {
      state.cancelled = false
    } else {
      // Remove if auto-reconnect is disabled or manager is being destroyed
      this._devices.delete(deviceId)
    }

    return true
  }

  /**
   * Cancel all pending connections.
   */
  cancelAll(): void {
    const deviceIds = Array.from(this._devices.keys())
    for (const deviceId of deviceIds) {
      this.cancel(deviceId)
    }
  }

  /**
   * Get the number of devices with active or pending connections.
   */
  get activeCount(): number {
    let count = 0
    for (const state of this._devices.values()) {
      if (state.isConnecting || state.pendingPromise) {
        count++
      }
    }
    return count
  }

  /**
   * Check if a device has a pending or active connection.
   */
  isConnecting(deviceId: DeviceId): boolean {
    const state = this._devices.get(deviceId)
    return state?.isConnecting ?? false
  }

  /**
   * Check if auto-reconnect is enabled for a device.
   */
  isAutoReconnectEnabled(deviceId: DeviceId): boolean {
    const state = this._devices.get(deviceId)
    return state?.autoReconnect ?? false
  }

  /**
   * Get the current retry count for a device.
   */
  getRetryCount(deviceId: DeviceId): number {
    const state = this._devices.get(deviceId)
    return state?.retryCount ?? 0
  }

  /**
   * Cancel state timers and subscriptions
   */
  private _cancelState(state: DeviceConnectionState): void {
    state.cancelled = true
    const wasConnecting = state.isConnecting
    // Clear connecting so auto-reconnect is not permanently stuck after cancel/replace
    // (stale _attemptConnection returns early on attemptId mismatch without clearing the flag).
    state.isConnecting = false

    if (state.timeoutId) {
      clearTimeout(state.timeoutId)
      state.timeoutId = undefined
    }

    if (state.connectionTimeoutId) {
      clearTimeout(state.connectionTimeoutId)
      state.connectionTimeoutId = undefined
    }

    // Keep disconnect sub for live auto-reconnect devices; always drop it when destroying.
    if (state.disconnectSubscription && (!state.autoReconnect || this._destroying)) {
      state.disconnectSubscription.remove()
      state.disconnectSubscription = undefined
    }

    // Invalidate in-flight async generation so stale success paths no-op without
    // cancelDeviceConnection on a newer attempt for the same deviceId.
    state.attemptId++

    if (wasConnecting) {
      // Native cancel may emit a disconnect after we re-arm auto (cancelled=false).
      // Suppress that one disconnect so cancel does not immediately start another connect.
      if (state.autoReconnect && !this._destroying) {
        state.suppressNextAutoReconnect = true
      }
      this._manager.cancelDeviceConnection(state.deviceId).catch(ignoreConnectionCancellationError)
    }
  }

  /**
   * Start reconnection after unexpected disconnect
   */
  private _startReconnection(deviceId: DeviceId): void {
    const state = this._devices.get(deviceId)
    if (!state || state.isConnecting || state.cancelled) {
      return
    }

    // Don't start if a retry is already scheduled
    if (state.timeoutId) {
      return
    }

    if (state.reconnectOptions) {
      state.options = { ...state.reconnectOptions }
    }

    state.retryCount = 0
    this._scheduleConnection(state, 0)
  }

  /**
   * Schedule a connection attempt with delay
   */
  private _scheduleConnection(state: DeviceConnectionState, delay: number): void {
    if (state.cancelled) {
      return
    }

    // Clear any existing retry timer to prevent multiple scheduled attempts
    if (state.timeoutId) {
      clearTimeout(state.timeoutId)
      state.timeoutId = undefined
    }

    // Capture generation so cancel()/replace (attemptId++) invalidates delay-0 microtasks
    // even when auto-reconnect immediately clears the cancelled flag.
    const scheduledAttemptId = state.attemptId

    if (delay === 0) {
      Promise.resolve().then(() => {
        if (!state.cancelled && state.attemptId === scheduledAttemptId) {
          this._attemptConnection(state)
        }
      })
      return
    }

    state.timeoutId = setTimeout(() => {
      if (!state.cancelled && state.attemptId === scheduledAttemptId) {
        this._attemptConnection(state)
      }
    }, delay)
  }

  /**
   * Attempt to connect to a device with timeout and retry logic
   */
  private async _attemptConnection(state: DeviceConnectionState): Promise<void> {
    // Early returns to prevent concurrent attempts
    if (state.cancelled) {
      return
    }

    if (state.isConnecting) {
      // Already connecting - don't start another attempt
      return
    }

    // Clear the retry timer since we're now consuming this scheduled attempt
    if (state.timeoutId) {
      clearTimeout(state.timeoutId)
      state.timeoutId = undefined
    }

    // Capture attempt ID to detect if this attempt was invalidated during async operations
    const myAttemptId = state.attemptId

    state.isConnecting = true
    state.retryCount++

    const maxRetries = state.options.maxRetries ?? DEFAULT_CONNECT_MAX_RETRIES

    // Notify connecting callbacks
    state.callbacks?.onConnecting?.(state.deviceId, state.retryCount, maxRetries)
    this._globalCallbacks.onConnecting?.(state.deviceId, state.retryCount, maxRetries)

    // Set up connection timeout if configured
    let timeoutError: BleError | null = null
    const timeoutMs = state.options.timeoutMs ?? 0

    if (timeoutMs > 0) {
      state.connectionTimeoutId = setTimeout(() => {
        timeoutError = makeBleError(
          BleErrorCode.OperationTimedOut,
          `Connection timeout after ${timeoutMs}ms for device ${state.deviceId}`
        )

        // Cancel the connection attempt
        this._manager.cancelDeviceConnection(state.deviceId).catch(ignoreConnectionCancellationError)
      }, timeoutMs)
    }

    try {
      const device = await this._manager.connectToDevice(state.deviceId, state.options.connectionOptions)

      // Check if this attempt was invalidated during the async connect operation
      if (state.attemptId !== myAttemptId) {
        // This attempt is stale - a newer attempt has started or cancel was called
        return
      }

      // Clear connection timeout
      if (state.connectionTimeoutId) {
        clearTimeout(state.connectionTimeoutId)
        state.connectionTimeoutId = undefined
      }

      // Do NOT clear suppressNextAutoReconnect on success: a late disconnect from the
      // previous cancelDeviceConnection must still be consumed without re-arming auto.
      // If no disconnect ever arrives (cancel of never-connected attempt), drop orphan
      // suppression after a short delay so a later real disconnect can re-arm.
      if (state.suppressNextAutoReconnect) {
        const suppressGeneration = state.attemptId
        setTimeout(() => {
          if (state.suppressNextAutoReconnect && state.attemptId === suppressGeneration && !this._destroying) {
            state.suppressNextAutoReconnect = false
          }
        }, 2000)
      }

      // Check if we timed out or were cancelled
      if (timeoutError) {
        throw timeoutError
      }

      // Check if cancelled or removed after await (race condition protection)
      const currentState = this._devices.get(state.deviceId)
      if (!currentState || currentState !== state || currentState.cancelled) {
        // State was cancelled during connection - disconnect immediately
        await this._manager.cancelDeviceConnection(state.deviceId).catch(ignoreConnectionCancellationError)

        // Check again after the disconnect await
        if (state.attemptId !== myAttemptId) {
          return
        }

        return
      }

      // Success!
      state.isConnecting = false
      state.retryCount = 0

      // Notify callbacks
      state.callbacks?.onConnect?.(device)
      this._globalCallbacks.onConnect?.(device)

      // Resolve pending promise if exists
      if (state.pendingPromise) {
        state.pendingPromise.resolve(device)
        state.pendingPromise = undefined
      }

      // Clean up if auto-reconnect is disabled
      if (!state.autoReconnect) {
        this._devices.delete(state.deviceId)
      }
    } catch (error) {
      // Check if this attempt was invalidated during the async operation
      if (state.attemptId !== myAttemptId) {
        // This attempt is stale - don't schedule retry or update state
        return
      }

      // Clear connection timeout
      if (state.connectionTimeoutId) {
        clearTimeout(state.connectionTimeoutId)
        state.connectionTimeoutId = undefined
      }

      // Use timeout error if it occurred
      const actualError = timeoutError || error

      // Check if cancelled after await
      const currentState = this._devices.get(state.deviceId)
      if (!currentState || currentState !== state || currentState.cancelled) {
        return
      }

      state.isConnecting = false

      if (state.retryCount >= maxRetries) {
        // Max retries exceeded
        const failureError =
          actualError instanceof BleError
            ? actualError
            : makeBleError(
                BleErrorCode.UnknownError,
                actualError instanceof Error ? actualError.message : String(actualError)
              )

        // Notify callbacks
        state.callbacks?.onConnectFailed?.(state.deviceId, failureError)
        this._globalCallbacks.onConnectFailed?.(state.deviceId, failureError)

        // Reject pending promise if exists
        if (state.pendingPromise) {
          state.pendingPromise.reject(failureError)
          state.pendingPromise = undefined
        }

        // Clean up if auto-reconnect is disabled
        if (!state.autoReconnect) {
          this._devices.delete(state.deviceId)
        }

        return
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(
        state.options.initialDelayMs * Math.pow(state.options.backoffMultiplier, state.retryCount - 1),
        state.options.maxDelayMs
      )

      // Schedule retry
      this._scheduleConnection(state, delay)
    }
  }

  /**
   * Destroy the manager and cancel all pending connections.
   */
  destroy(): void {
    this._destroying = true
    // Drop callbacks first so cancel() / promise rejections cannot re-arm connects.
    this._globalCallbacks = {}
    for (const state of this._devices.values()) {
      state.callbacks = undefined
    }

    // Drain until stable: a reject handler may still call connect before _destroying
    // was observed on a different call stack edge; _beginConnect rejects while destroying.
    let safety = 0
    while (this._devices.size > 0 && safety < 32) {
      safety += 1
      const deviceIds = Array.from(this._devices.keys())
      for (const deviceId of deviceIds) {
        this.cancel(deviceId)
      }
      // Any leftover auto-reconnect entries (or re-entries) — hard clear timers/subs
      for (const state of this._devices.values()) {
        state.cancelled = true
        state.callbacks = undefined
        if (state.timeoutId) {
          clearTimeout(state.timeoutId)
          state.timeoutId = undefined
        }
        if (state.connectionTimeoutId) {
          clearTimeout(state.connectionTimeoutId)
          state.connectionTimeoutId = undefined
        }
        if (state.disconnectSubscription) {
          state.disconnectSubscription.remove()
          state.disconnectSubscription = undefined
        }
        if (state.pendingPromise) {
          const error = makeBleError(BleErrorCode.OperationCancelled, DESTROY_CANCEL_REASON)
          state.pendingPromise.reject(error)
          state.pendingPromise = undefined
        }
      }
      this._devices.clear()
    }

    this._globalCallbacks = {}
  }
}
