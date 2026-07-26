/**
 * Typed errors for package helpers (shared across hosts).
 */

import { BleError, BleErrorCode, BleErrorCodeMessage } from '../BleError'

export function helperBleError(
  errorCode: BleErrorCode,
  opts: {
    reason?: string | null
    internalMessage?: string
    deviceID?: string
  } = {}
): BleError {
  return new BleError(
    {
      errorCode,
      attErrorCode: null,
      iosErrorCode: null,
      androidErrorCode: null,
      reason: opts.reason ?? null,
      internalMessage: opts.internalMessage,
      deviceID: opts.deviceID
    },
    BleErrorCodeMessage
  )
}

export function helperTimeoutError(operation: string, timeoutMs: number): BleError {
  return helperBleError(BleErrorCode.OperationTimedOut, {
    internalMessage: `${operation} timed out after ${timeoutMs}ms`
  })
}

export function helperNotFoundError(operation: string, timeoutMs: number): BleError {
  return helperBleError(BleErrorCode.DeviceNotFound, {
    internalMessage: `${operation} timed out after ${timeoutMs}ms`
  })
}
