// src/native-protocol/rn-apple-boundary.ts

import type { ConnectionControlCapabilities } from '../backend-contract/connection-controls'
import { ReactNativeAndroidProtocolBoundary } from './rn-android-boundary'

/**
 * Apple shares the versioned JSI codec, but CoreBluetooth has no caller-directed ATT MTU request.
 * The explicit capability declaration prevents the core from submitting that impossible command.
 */
export class ReactNativeAppleProtocolBoundary extends ReactNativeAndroidProtocolBoundary {
  readonly connectionControlCapabilities: ConnectionControlCapabilities = Object.freeze({
    rssi: 'available',
    requestMtu: 'unavailable'
  })
}
