// src/backends/winrt/winrt-adapter-state.ts

import type { AdapterStateSnapshot } from '../../backend-contract/identity'
import { contractError } from '../../backend-contract/errors'
import { monotonicTimestamp, opaqueId } from '../../backend-contract/primitives'
import type { WinRtAdapterRecord, WinRtAdapterSnapshot } from './winrt-boundary'

export function winRtAdapterState(
  state: WinRtAdapterSnapshot,
  backendGeneration: number,
  now: () => number
): AdapterStateSnapshot<string> {
  return Object.freeze({
    availability: state.availability,
    authorization: state.authorization,
    power: state.power,
    backendGeneration: opaqueId(String(backendGeneration), 'backend-generation', 'winrt'),
    updatedAt: monotonicTimestamp(now()),
    safeReason: state.safeReason
  })
}

export function winRtAdapterIsReady(state: WinRtAdapterSnapshot): boolean {
  return state.availability === 'available' && state.authorization === 'granted' && state.power === 'on'
}

export function assertWinRtAdapterReady(
  adapter: WinRtAdapterRecord,
  state: WinRtAdapterSnapshot,
  operation: string
): void {
  if (adapter.deployment === 'packaged' && adapter.packagedCapability === 'missing') {
    throw contractError('permission.denied', 'adapter', operation)
  }
  if (state.availability !== 'available') {
    throw contractError('adapter.unavailable', 'adapter', operation)
  }
  if (state.authorization === 'denied') {
    throw contractError('permission.denied', 'adapter', operation)
  }
  if (state.authorization === 'restricted') {
    throw contractError('permission.restricted', 'adapter', operation)
  }
  if (state.authorization !== 'granted') {
    throw contractError('permission.not-determined', 'adapter', operation)
  }
  if (state.power === 'off') {
    throw contractError('adapter.powered-off', 'adapter', operation)
  }
  if (state.power === 'resetting') {
    throw contractError('adapter.resetting', 'adapter', operation)
  }
}
