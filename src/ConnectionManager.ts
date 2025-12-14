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
   * Maximum number of retry attempts (default: 3)
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

/**
 * Internal state for a device connection
 */
interface DeviceConnectionState {
  deviceId: DeviceId
  options: ConnectionOptionsWithRetry
  isConnecting: boolean
  retryCount: number
  timeoutId?: ReturnType<typeof setTimeout>
  connectionTimeoutId?: ReturnType<typeof setTimeout>
  disconnectSubscription?: Subscription
  autoReconnect: boolean
  callbacks?: ConnectionCallbacks
  cancelled: boolean
  pendingPromise?: {
    resolve: (device: Device) => void
    reject: (error: BleError) => void
  }
}

/**
 * ConnectionManager unifies connection queuing, retry logic, and automatic reconnection.
 *
 * This manager replaces both ConnectionQueue and ReconnectionManager with a single,
 * unified state machine per device that prevents conflicts and connection storms.
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
    const existing = this._devices.get(deviceId)

    // If there's already a connection attempt in progress, coalesce to the same promise
    if (existing && existing.pendingPromise && !existing.cancelled) {
      // Return a new promise that resolves/rejects when the existing one does
      return new Promise((resolve, reject) => {
        const originalResolve = existing.pendingPromise!.resolve
        const originalReject = existing.pendingPromise!.reject

        // Chain to the original promise
        existing.pendingPromise!.resolve = (device: Device) => {
          originalResolve(device)
          resolve(device)
        }

        existing.pendingPromise!.reject = (error: BleError) => {
          originalReject(error)
          reject(error)
        }
      })
    }

    return new Promise((resolve, reject) => {
      // Cancel and clean up existing state if present
      if (existing) {
        // Reject any existing pending promise before replacing
        if (existing.pendingPromise) {
          existing.pendingPromise.reject(
            new BleError(
              {
                errorCode: BleErrorCode.OperationCancelled,
                attErrorCode: null,
                iosErrorCode: null,
                androidErrorCode: null,
                reason: `Connection attempt replaced for device ${deviceId}`
              },
              BleErrorCodeMessage
            )
          )
        }
        this._cancelState(existing)
      }

      const connectionOptions: ConnectionOptionsWithRetry = {
        maxRetries: options?.maxRetries ?? 3,
        initialDelayMs: options?.initialDelayMs ?? 1000,
        maxDelayMs: options?.maxDelayMs ?? 30000,
        backoffMultiplier: options?.backoffMultiplier ?? 2,
        timeoutMs: options?.timeoutMs ?? 30000,
        connectionOptions: options?.connectionOptions
      }

      const state: DeviceConnectionState = {
        deviceId,
        options: connectionOptions,
        isConnecting: false,
        retryCount: 0,
        autoReconnect: false,
        cancelled: false,
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
   */
  enableAutoReconnect(
    deviceId: DeviceId,
    options?: ConnectionOptionsWithRetry,
    callbacks?: ConnectionCallbacks
  ): void {
    // If already exists, update settings
    let state = this._devices.get(deviceId)

    if (state) {
      // Update existing state
      state.autoReconnect = true
      state.callbacks = callbacks
      if (options) {
        state.options = {
          maxRetries: options.maxRetries ?? state.options.maxRetries,
          initialDelayMs: options.initialDelayMs ?? state.options.initialDelayMs,
          maxDelayMs: options.maxDelayMs ?? state.options.maxDelayMs,
          backoffMultiplier: options.backoffMultiplier ?? state.options.backoffMultiplier,
          timeoutMs: options.timeoutMs ?? state.options.timeoutMs,
          connectionOptions: options.connectionOptions ?? state.options.connectionOptions
        }
      }
    } else {
      // Create new state
      const connectionOptions: ConnectionOptionsWithRetry = {
        maxRetries: options?.maxRetries ?? 5,
        initialDelayMs: options?.initialDelayMs ?? 1000,
        maxDelayMs: options?.maxDelayMs ?? 30000,
        backoffMultiplier: options?.backoffMultiplier ?? 2,
        timeoutMs: options?.timeoutMs ?? 30000,
        connectionOptions: options?.connectionOptions
      }

      state = {
        deviceId,
        options: connectionOptions,
        isConnecting: false,
        retryCount: 0,
        autoReconnect: true,
        callbacks,
        cancelled: false
      }

      this._devices.set(deviceId, state)
    }

    // Subscribe to disconnection events if not already subscribed
    if (!state.disconnectSubscription) {
      state.disconnectSubscription = this._manager.onDeviceDisconnected(deviceId, (error, device) => {
        const currentState = this._devices.get(deviceId)
        if (!currentState) return

        // Notify disconnect callbacks
        currentState.callbacks?.onDisconnect?.(deviceId, error)
        this._globalCallbacks.onDisconnect?.(deviceId, error)

        // Only auto-reconnect on unexpected disconnections (error is not null)
        if (error && currentState.autoReconnect && !currentState.cancelled) {
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

    this._cancelState(state)

    const error = new BleError(
      {
        errorCode: BleErrorCode.OperationCancelled,
        attErrorCode: null,
        iosErrorCode: null,
        androidErrorCode: null,
        reason: `Connection cancelled for device ${deviceId}`
      },
      BleErrorCodeMessage
    )

    // Reject pending promise if exists
    if (state.pendingPromise) {
      state.pendingPromise.reject(error)
      state.pendingPromise = undefined
    }

    // Notify callbacks
    state.callbacks?.onConnectFailed?.(deviceId, error)
    this._globalCallbacks.onConnectFailed?.(deviceId, error)

    // For auto-reconnect devices, reset cancelled flag so future disconnects can trigger reconnection
    if (state.autoReconnect) {
      state.cancelled = false
    } else {
      // Remove if auto-reconnect is disabled
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

    if (state.timeoutId) {
      clearTimeout(state.timeoutId)
      state.timeoutId = undefined
    }

    if (state.connectionTimeoutId) {
      clearTimeout(state.connectionTimeoutId)
      state.connectionTimeoutId = undefined
    }

    if (state.disconnectSubscription && !state.autoReconnect) {
      state.disconnectSubscription.remove()
      state.disconnectSubscription = undefined
    }

    if (state.isConnecting) {
      this._manager.cancelDeviceConnection(state.deviceId).catch(() => {
        // Ignore errors when cancelling
      })
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

    state.timeoutId = setTimeout(() => {
      if (!state.cancelled) {
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

    state.isConnecting = true
    state.retryCount++

    const maxRetries = state.options.maxRetries ?? 3

    // Notify connecting callbacks
    state.callbacks?.onConnecting?.(state.deviceId, state.retryCount, maxRetries)
    this._globalCallbacks.onConnecting?.(state.deviceId, state.retryCount, maxRetries)

    // Set up connection timeout if configured
    let timeoutError: BleError | null = null
    const timeoutMs = state.options.timeoutMs ?? 0

    if (timeoutMs > 0) {
      state.connectionTimeoutId = setTimeout(() => {
        timeoutError = new BleError(
          {
            errorCode: BleErrorCode.OperationTimedOut,
            attErrorCode: null,
            iosErrorCode: null,
            androidErrorCode: null,
            reason: `Connection timeout after ${timeoutMs}ms for device ${state.deviceId}`
          },
          BleErrorCodeMessage
        )

        // Cancel the connection attempt
        this._manager.cancelDeviceConnection(state.deviceId).catch(() => {
          // Ignore errors
        })
      }, timeoutMs)
    }

    try {
      const device = await this._manager.connectToDevice(state.deviceId, state.options.connectionOptions)

      // Clear connection timeout
      if (state.connectionTimeoutId) {
        clearTimeout(state.connectionTimeoutId)
        state.connectionTimeoutId = undefined
      }

      // Check if we timed out or were cancelled
      if (timeoutError) {
        throw timeoutError
      }

      // Check if cancelled or removed after await (race condition protection)
      const currentState = this._devices.get(state.deviceId)
      if (!currentState || currentState !== state || currentState.cancelled) {
        // State was cancelled during connection - disconnect immediately
        await this._manager.cancelDeviceConnection(state.deviceId).catch(() => {})
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
        const bleError = actualError instanceof BleError
          ? actualError
          : new BleError(
              {
                errorCode: BleErrorCode.UnknownError,
                attErrorCode: null,
                iosErrorCode: null,
                androidErrorCode: null,
                reason: actualError instanceof Error ? actualError.message : String(actualError)
              },
              BleErrorCodeMessage
            )

        // Notify callbacks
        state.callbacks?.onConnectFailed?.(state.deviceId, bleError)
        this._globalCallbacks.onConnectFailed?.(state.deviceId, bleError)

        // Reject pending promise if exists
        if (state.pendingPromise) {
          state.pendingPromise.reject(bleError)
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
        state.options.initialDelayMs! * Math.pow(state.options.backoffMultiplier!, state.retryCount - 1),
        state.options.maxDelayMs!
      )

      // Schedule retry
      this._scheduleConnection(state, delay)
    }
  }

  /**
   * Destroy the manager and cancel all pending connections.
   */
  destroy(): void {
    // Force remove ALL subscriptions before clearing (prevents leaks)
    for (const state of this._devices.values()) {
      if (state.disconnectSubscription) {
        state.disconnectSubscription.remove()
        state.disconnectSubscription = undefined
      }
    }

    // Cancel all pending operations
    this.cancelAll()

    // Clear all state
    this._devices.clear()
    this._globalCallbacks = {}
  }
}
