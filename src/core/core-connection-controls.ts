// src/core/core-connection-controls.ts

import type { BleCentralBackend } from '../backend-contract/backend'
import {
  MAXIMUM_REQUESTED_ATT_MTU,
  MINIMUM_ATT_MTU,
  type MtuNegotiation,
  type RssiMeasurement
} from '../backend-contract/connection-controls'
import { contractError } from '../backend-contract/errors'
import type { BackendIdentity } from '../backend-contract/identity'
import type { PublicOperationOptions } from '../backend-contract/operations'
import type { CoreConnection } from './core-gatt-handles'
import type { CoreOperationCoordinator } from './operation-coordinator'
import { coreDispatch, requireOperationValue } from './unified-ble-core-helpers'

export interface CoreConnectionControls<Attachment extends string, Identity extends BackendIdentity<Attachment>> {
  readRssi(
    connection: CoreConnection<Attachment, Identity>,
    options: PublicOperationOptions
  ): Promise<RssiMeasurement<Attachment, string>>
  requestMtu(
    connection: CoreConnection<Attachment, Identity>,
    requestedMtu: number,
    options: PublicOperationOptions
  ): Promise<MtuNegotiation<Attachment, string>>
}

export function createCoreConnectionControls<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  backend: BleCentralBackend<Attachment, Identity>,
  operationCoordinator: CoreOperationCoordinator<Attachment>,
  assertReady: (operation: string) => void
): CoreConnectionControls<Attachment, Identity> {
  return Object.freeze({
    readRssi: (connection: CoreConnection<Attachment, Identity>, options: PublicOperationOptions) => {
      assertReady('read-rssi')
      return readCoreRssi(backend, operationCoordinator, connection, options)
    },
    requestMtu: (
      connection: CoreConnection<Attachment, Identity>,
      requestedMtu: number,
      options: PublicOperationOptions
    ) => {
      assertReady('request-mtu')
      return requestCoreMtu(backend, operationCoordinator, connection, requestedMtu, options)
    }
  })
}

export async function readCoreRssi<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  backend: BleCentralBackend<Attachment, Identity>,
  operationCoordinator: CoreOperationCoordinator<Attachment>,
  connection: CoreConnection<Attachment, Identity>,
  options: PublicOperationOptions
): Promise<RssiMeasurement<Attachment, string>> {
  const readRssi = backend.connections.readRssi
  if (readRssi === undefined) {
    throw contractError('capability.unsupported', 'connection', 'unified-core.read-rssi')
  }
  connection.assertCurrent()
  const result = await operationCoordinator.run({
    queueKey: String(connection.resource.connectionId),
    options,
    mayCommit: false,
    dispatch: correlation => {
      connection.assertCurrent()
      const dispatch = readRssi(connection.resource, { operation: { ...options, correlation } })
      return coreDispatch(dispatch, correlation, value => value.terminal)
    }
  })
  return requireOperationValue(result, 'unified-core.read-rssi')
}

export async function requestCoreMtu<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  backend: BleCentralBackend<Attachment, Identity>,
  operationCoordinator: CoreOperationCoordinator<Attachment>,
  connection: CoreConnection<Attachment, Identity>,
  requestedMtu: number,
  options: PublicOperationOptions
): Promise<MtuNegotiation<Attachment, string>> {
  if (
    !Number.isSafeInteger(requestedMtu) ||
    requestedMtu < MINIMUM_ATT_MTU ||
    requestedMtu > MAXIMUM_REQUESTED_ATT_MTU
  ) {
    throw contractError('argument.invalid', 'connection', 'unified-core.request-mtu')
  }
  const requestMtu = backend.connections.requestMtu
  if (requestMtu === undefined) {
    throw contractError('capability.unsupported', 'connection', 'unified-core.request-mtu')
  }
  connection.assertCurrent()
  const result = await operationCoordinator.run({
    queueKey: String(connection.resource.connectionId),
    options,
    mayCommit: true,
    dispatch: correlation => {
      connection.assertCurrent()
      const dispatch = requestMtu(connection.resource, {
        operation: { ...options, correlation },
        requestedMtu
      })
      return coreDispatch(dispatch, correlation, value => value.terminal)
    }
  })
  return requireOperationValue(result, 'unified-core.request-mtu')
}
