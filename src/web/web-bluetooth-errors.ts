// src/web/web-bluetooth-errors.ts

import { BackendContractError, contractError } from '../backend-contract/errors'
import type { BleErrorCode, BleErrorDomain, CleanupRecord } from '../backend-contract/errors'
import type { ChooserRequest } from '../backend-contract/host/web'

export interface WebErrorContext {
  readonly fallbackCode: BleErrorCode
  readonly domain: BleErrorDomain
  readonly operation: string
}

export function normalizeWebBluetoothError(error: Error, context: WebErrorContext): BackendContractError {
  if (error instanceof BackendContractError) {
    return error
  }
  const namedCode = normalizedNamedErrorCode(error.name, context)
  return contractError(namedCode, context.domain, context.operation, {
    domain: 'web-bluetooth',
    code: error.name.length === 0 ? 'Error' : error.name,
    safeMessage: 'The Web Bluetooth operation failed.',
    metadata: { browserErrorName: error.name.length === 0 ? 'Error' : error.name }
  })
}

function normalizedNamedErrorCode(name: string, context: WebErrorContext): BleErrorCode {
  if (name === 'AbortError') {
    return context.domain === 'chooser' ? 'chooser.cancelled' : 'operation.aborted'
  }
  if (name === 'NotFoundError') {
    return context.domain === 'chooser' ? 'chooser.cancelled' : 'gatt.not-found'
  }
  if (name === 'NotAllowedError') {
    return context.domain === 'chooser' ? 'chooser.cancelled' : 'permission.denied'
  }
  if (name === 'SecurityError') {
    return context.domain === 'chooser' ? 'permission.denied' : 'platform.security'
  }
  if (name === 'NetworkError') {
    return context.domain === 'connection' ? 'connection.failed' : 'operation.disconnected'
  }
  if (name === 'NotSupportedError') {
    return 'gatt.property-not-supported'
  }
  if (name === 'InvalidStateError') {
    return 'lifecycle.invalid-state'
  }
  return context.fallbackCode
}

export function webError(error: Error, context: WebErrorContext): BackendContractError {
  return normalizeWebBluetoothError(error, context)
}

export function webCleanupFailure(resourceKind: string, operation: string): CleanupRecord {
  return {
    state: 'release-failed',
    failures: [{ resourceKind, error: contractError('platform.failure', 'cleanup', operation).normalized }]
  }
}

export function validateWebChooserRequest(request: ChooserRequest): void {
  const hasFilters = request.filters.length > 0
  if (
    request.acceptAllDevices === hasFilters ||
    request.filters.some(filter => filter.serviceUuids.length === 0 && filter.localNamePrefix === null)
  ) {
    throw contractError('scan.filter-invalid', 'chooser', 'web-chooser.request')
  }
}
