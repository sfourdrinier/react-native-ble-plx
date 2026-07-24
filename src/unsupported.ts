/**
 * Typed unsupported-operation failures for multi-host honesty.
 */

import { BleError, BleErrorCode, BleErrorCodeMessage } from './BleError'

/**
 * Build a BleError for an operation that is not available on this host.
 * @param operation e.g. "createBond", "startDeviceScan"
 * @param detail optional host/capability note
 */
export function unsupportedOperationError(operation: string, detail?: string): BleError {
  const internalMessage = detail ? `${operation}: ${detail}` : operation
  return new BleError(
    {
      errorCode: BleErrorCode.OperationNotSupported,
      attErrorCode: null,
      iosErrorCode: null,
      androidErrorCode: null,
      reason: null,
      internalMessage
    },
    BleErrorCodeMessage
  )
}

export function rejectUnsupported(operation: string, detail?: string): Promise<never> {
  return Promise.reject(unsupportedOperationError(operation, detail))
}
