/**
 * Duck-typed manager surface for cross-host helpers (RN BleManager + PortBleManager + hosts).
 * Callers may pass any object that implements the subset each helper needs.
 */

export type HelperSubscription = { remove: () => void }

/** Minimal advertisement / scan hit used by findDevice. */
export type ScannedDeviceLike = {
  id: string
  name?: string | null
  rssi?: number | null
  localName?: string | null
  serviceUUIDs?: string[] | null
}

export type ScanListener = (error: Error | null, device: ScannedDeviceLike | null) => void

/**
 * Structural type — do not require a concrete class so Electron main / web / RN
 * and custom PortBleManager wrappers all work.
 */
export type BleCentralLike = {
  supports?: (capability: string) => boolean
  state?: () => Promise<string>
  onStateChange?: (listener: (state: string) => void, emitCurrentState?: boolean) => HelperSubscription
  startDeviceScan: (
    serviceUUIDs: string[] | null,
    options: Record<string, unknown> | null | undefined,
    listener: ScanListener
  ) => void | Promise<void>
  stopDeviceScan: () => void | Promise<void>
  connectToDevice: (deviceId: string, options?: unknown) => Promise<unknown>
  discoverAllServicesAndCharacteristicsForDevice?: (deviceId: string) => Promise<unknown>
  servicesForDevice?: (deviceId: string) => Promise<Array<{ uuid: string }>>
  cancelDeviceConnection?: (deviceId: string) => Promise<unknown>
  destroy?: () => void | Promise<void>
  cancelTransaction?: (transactionId: string) => void
  monitorCharacteristicForDevice?: (
    deviceId: string,
    serviceUUID: string,
    characteristicUUID: string,
    listener: (error: Error | null, characteristic: { value?: string | null } | null) => void,
    transactionId?: string | null,
    subscriptionType?: string | null
  ) => HelperSubscription
  monitorCharacteristicForDeviceAsBytes?: (
    deviceId: string,
    serviceUUID: string,
    characteristicUUID: string,
    listener: (error: Error | null, characteristic: { value?: Uint8Array | null } | null) => void,
    transactionId?: string | null,
    subscriptionType?: string | null
  ) => HelperSubscription
  readCharacteristicForDeviceAsBytes?: (
    deviceId: string,
    serviceUUID: string,
    characteristicUUID: string,
    transactionId?: string
  ) => Promise<{ value: Uint8Array | null }>
  readCharacteristicForDevice?: (
    deviceId: string,
    serviceUUID: string,
    characteristicUUID: string,
    transactionId?: string
  ) => Promise<{ value: string | null }>
  characteristicsMetaForDevice?: (
    deviceId: string,
    serviceUUID: string
  ) => Promise<
    Array<{
      uuid: string
      isReadable?: boolean
      isNotifiable?: boolean
      isIndicatable?: boolean
      isWritableWithResponse?: boolean
      isWritableWithoutResponse?: boolean
    }>
  >
  characteristicsForDevice?: (
    deviceId: string,
    serviceUUID: string
  ) => Promise<Array<{ uuid: string; isReadable?: boolean; value?: string | null }>>
}

export type WaitForStateOptions = {
  /** Default 15000. */
  timeoutMs?: number
  /**
   * Target state(s). Default `['PoweredOn']`.
   * Match is case-sensitive (BleManager State enum strings).
   */
  target?: string | readonly string[]
}

export type FindDeviceOptions = {
  /** Default 10000. */
  timeoutMs?: number
  /** Radio-level service UUID filter (when host supports continuous scan). */
  serviceUUIDs?: string[] | null
  /** Scan options (name filters, Android mode, …) when manager supports them. */
  scanOptions?: Record<string, unknown> | null
  /** Optional AbortSignal to cancel early. */
  signal?: AbortSignal
}

export type ConnectAndDiscoverOptions = {
  /** Connection options forwarded to connectToDevice when supported. */
  connectOptions?: unknown
  /** Default 20000 for connect+discover wall clock. */
  timeoutMs?: number
}

export type FirstNotificationOptions = {
  /** Default 15000. */
  timeoutMs?: number
  /** Prefer bytes path when available (default true). */
  asBytes?: boolean
  transactionId?: string
  /** Android subscription type when supported. */
  subscriptionType?: 'notification' | 'indication' | null
  signal?: AbortSignal
}

export type TryReadOptions = {
  /** When false, skip the meta.isReadable gate (default true). */
  requireReadable?: boolean
  /** Prefer AsBytes when available (default true). */
  asBytes?: boolean
}

export type TryReadResult =
  | { ok: true; value: Uint8Array }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; skipped: false; error: Error }

export type SafeTeardownOptions = {
  /** Device ids to disconnect before destroy. */
  deviceIds?: readonly string[]
  /** Stop scan (default true). */
  stopScan?: boolean
  /** Call destroy when present (default false — apps often own lifecycle). */
  destroy?: boolean
}
