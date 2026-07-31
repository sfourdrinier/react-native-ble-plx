// src/core/connection-lifecycle-rules.ts

import { contractError } from '../backend-contract/errors'
import type { BackendDisconnectReason, ConnectionState } from '../backend-contract/backend'
import type { ConnectionLifecycleTerminalCause } from '../backend-contract/connection-lifecycle'

export function assertBackendLifecycleTransition(
  expectedPrevious: ConnectionState,
  previous: ConnectionState,
  current: ConnectionState,
  backendIngressOrdinal: number,
  lastBackendIngressOrdinal: number | null
): void {
  if (lastBackendIngressOrdinal !== null && backendIngressOrdinal <= lastBackendIngressOrdinal) {
    throw contractError('lifecycle.invariant-violation', 'connection', 'connection-lifecycle.ingress-order')
  }
  if (previous !== expectedPrevious) {
    throw contractError('lifecycle.invariant-violation', 'connection', 'connection-lifecycle.previous-state')
  }
  if (!isAllowedBackendTransition(previous, current)) {
    throw contractError('lifecycle.invariant-violation', 'connection', 'connection-lifecycle.transition')
  }
}

export function lifecycleCauseFromBackendDisconnect(reason: BackendDisconnectReason): ConnectionLifecycleTerminalCause {
  if (reason === 'peer') {
    return 'peer-link-loss'
  }
  if (reason === 'adapter') {
    return 'adapter-loss'
  }
  if (reason === 'backend-restart') {
    return 'backend-restart'
  }
  return 'requested-disconnect'
}

export function isConnectionLossCause(cause: ConnectionLifecycleTerminalCause): boolean {
  return (
    cause === 'peer-link-loss' || cause === 'adapter-loss' || cause === 'backend-restart' || cause === 'backend-failure'
  )
}

function isAllowedBackendTransition(previous: ConnectionState, current: ConnectionState): boolean {
  if (previous === 'connecting') {
    return current === 'connected' || current === 'disconnecting' || current === 'disconnected' || current === 'lost'
  }
  if (previous === 'connected') {
    return current === 'disconnecting' || current === 'disconnected' || current === 'lost'
  }
  if (previous === 'disconnecting') {
    return current === 'disconnected' || current === 'lost'
  }
  return false
}
