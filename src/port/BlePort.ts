/**
 * Host-agnostic BLE radio port (Phase 0 constitution).
 * Real backends (mobile TurboModule, WebBT, Electron native) implement this later.
 */

export type PortDeviceId = string

export type PortAdvertisement = {
  id: PortDeviceId
  name: string | null
  rssi: number | null
  rawScanRecordBase64?: string | null
}

export type PortConnectionState = 'disconnected' | 'connecting' | 'connected'

export interface BlePort {
  readonly id: string
  startScan(onDevice: (ad: PortAdvertisement) => void): Promise<void>
  stopScan(): Promise<void>
  connect(deviceId: PortDeviceId): Promise<void>
  disconnect(deviceId: PortDeviceId): Promise<void>
  getConnectionState(deviceId: PortDeviceId): PortConnectionState
  /** Read characteristic value as Base64 (3.9-compat edge shape). */
  readCharacteristicBase64(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string
  ): Promise<string>
  /** Write characteristic value from Base64. */
  writeCharacteristicBase64(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string,
    valueBase64: string
  ): Promise<void>
}

export type FakePortOptions = {
  id?: string
  /** deviceId -> serviceUUID -> charUUID -> base64 value */
  characteristics?: Record<string, Record<string, Record<string, string>>>
  advertisements?: PortAdvertisement[]
}

/**
 * In-memory fake radio for TDD (no native I/O).
 */
export class FakeBlePort implements BlePort {
  readonly id: string
  private scanning = false
  private states = new Map<PortDeviceId, PortConnectionState>()
  private characteristics: Record<string, Record<string, Record<string, string>>>
  private advertisements: PortAdvertisement[]
  private scanTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: FakePortOptions = {}) {
    this.id = options.id ?? 'fake'
    this.characteristics = options.characteristics ?? {}
    this.advertisements = options.advertisements ?? []
  }

  async startScan(onDevice: (ad: PortAdvertisement) => void): Promise<void> {
    this.scanning = true
    // Emit known ads asynchronously so callers can await startScan then observe events
    this.scanTimer = setTimeout(() => {
      if (!this.scanning) return
      for (const ad of this.advertisements) {
        onDevice(ad)
      }
    }, 0)
  }

  async stopScan(): Promise<void> {
    this.scanning = false
    if (this.scanTimer) {
      clearTimeout(this.scanTimer)
      this.scanTimer = null
    }
  }

  async connect(deviceId: PortDeviceId): Promise<void> {
    this.states.set(deviceId, 'connected')
  }

  async disconnect(deviceId: PortDeviceId): Promise<void> {
    this.states.set(deviceId, 'disconnected')
  }

  getConnectionState(deviceId: PortDeviceId): PortConnectionState {
    return this.states.get(deviceId) ?? 'disconnected'
  }

  async readCharacteristicBase64(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string
  ): Promise<string> {
    if (this.getConnectionState(deviceId) !== 'connected') {
      throw new Error(`Not connected to ${deviceId}`)
    }
    const value = this.characteristics[deviceId]?.[serviceUUID]?.[characteristicUUID]
    if (value == null) {
      throw new Error(`Characteristic not found: ${serviceUUID}/${characteristicUUID}`)
    }
    return value
  }

  async writeCharacteristicBase64(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string,
    valueBase64: string
  ): Promise<void> {
    if (this.getConnectionState(deviceId) !== 'connected') {
      throw new Error(`Not connected to ${deviceId}`)
    }
    if (!this.characteristics[deviceId]) this.characteristics[deviceId] = {}
    if (!this.characteristics[deviceId][serviceUUID]) this.characteristics[deviceId][serviceUUID] = {}
    this.characteristics[deviceId][serviceUUID][characteristicUUID] = valueBase64
  }
}
