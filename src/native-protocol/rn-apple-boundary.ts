// src/native-protocol/rn-apple-boundary.ts

import { contractError } from '../backend-contract/errors'
import type { ConnectionControlCapabilities } from '../backend-contract/connection-controls'
import type {
  CoreBluetoothAdapterSnapshot,
  CoreBluetoothAdvertisement
} from '../backends/corebluetooth/corebluetooth-boundary'
import { ReactNativeAndroidProtocolBoundary } from './rn-android-boundary'

/**
 * Apple shares the versioned JSI codec, but CoreBluetooth has no caller-directed ATT MTU request.
 * The explicit capability declaration prevents the core from submitting that impossible command.
 */
export class ReactNativeAppleProtocolBoundary extends ReactNativeAndroidProtocolBoundary {
  override readonly descriptorOperationsAvailable = false
  readonly connectionControlCapabilities: ConnectionControlCapabilities = Object.freeze({
    rssi: 'available',
    requestMtu: 'unavailable'
  })

  override adapterSnapshot(): CoreBluetoothAdapterSnapshot {
    const snapshot = super.adapterSnapshot()
    if (snapshot.safeReason !== 'The Android radio has not emitted its authoritative adapter state yet.') {
      return snapshot
    }
    return Object.freeze({
      ...snapshot,
      safeReason: 'CoreBluetooth has not emitted its authoritative adapter state yet.'
    })
  }

  override async startScan(
    onAdvertisement: (advertisement: CoreBluetoothAdvertisement) => void,
    serviceUuids: readonly string[]
  ): Promise<void> {
    this.assertAdapterReady('scan.start')
    return super.startScan(onAdvertisement, serviceUuids)
  }

  override async connect(nativePeerId: string): Promise<void> {
    this.assertAdapterReady('connection.connect')
    return super.connect(nativePeerId)
  }

  private assertAdapterReady(operation: string): void {
    const snapshot = this.adapterSnapshot()
    if (snapshot.availability !== 'available' || snapshot.power === 'unsupported') {
      throw contractError('adapter.unavailable', 'adapter', `rn-apple-boundary.${operation}`)
    }
    if (snapshot.authorization === 'denied') {
      throw contractError('permission.denied', 'adapter', `rn-apple-boundary.${operation}`)
    }
    if (snapshot.authorization === 'restricted') {
      throw contractError('permission.restricted', 'adapter', `rn-apple-boundary.${operation}`)
    }
    if (snapshot.authorization !== 'granted') {
      throw contractError('permission.not-determined', 'adapter', `rn-apple-boundary.${operation}`)
    }
    if (snapshot.power === 'off') {
      throw contractError('adapter.powered-off', 'adapter', `rn-apple-boundary.${operation}`)
    }
    if (snapshot.power === 'resetting') {
      throw contractError('adapter.resetting', 'adapter', `rn-apple-boundary.${operation}`)
    }
    if (snapshot.power !== 'on') {
      throw contractError('adapter.unavailable', 'adapter', `rn-apple-boundary.${operation}`)
    }
  }
}
