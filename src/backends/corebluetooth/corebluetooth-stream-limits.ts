// src/backends/corebluetooth/corebluetooth-stream-limits.ts

import { capacity } from '../../backend-contract/primitives'

export const backendEventLimits = Object.freeze({
  itemCapacity: capacity(64),
  byteCapacity: capacity(64 * 1024),
  reservedControlCapacity: capacity(1)
})

export const adapterStateLimits = Object.freeze({
  itemCapacity: capacity(16),
  byteCapacity: capacity(16 * 1024),
  reservedControlCapacity: capacity(1)
})
