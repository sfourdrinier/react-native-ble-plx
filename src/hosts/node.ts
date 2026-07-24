/**
 * Node / headless host entry for unified-ble-manager/node.
 * Same main-process spirit as Electron: inject BlePort (BlueZ later); mock for tests.
 */

import type { BlePort } from '../port/BlePort'
import { FakeBlePort } from '../port/BlePort'
import { PortBleManager } from '../port/PortBleManager'
import { supports as supportsCapability, type BleCapability } from '../supports'

export type NodeBleManagerOptions = {
  port?: BlePort
  allowMockFallback?: boolean
}

export class BleManager extends PortBleManager {
  constructor(options: NodeBleManagerOptions = {}) {
    let port = options.port
    if (!port) {
      if (options.allowMockFallback === false) {
        throw new Error('unified-ble-manager/node requires an injected BlePort (or allowMockFallback).')
      }
      port = new FakeBlePort({ id: 'node-mock-fallback' })
    }
    super({ port, host: 'node' })
  }

  supports(capability: BleCapability): boolean {
    return supportsCapability(capability, 'node')
  }
}

export { PortBleManager } from '../port/PortBleManager'
export { FakeBlePort } from '../port/BlePort'
export { base64ToBytes, bytesToBase64 } from '../encoding'
export { supports } from '../supports'
