// src/backends/corebluetooth/corebluetooth-connection-controls.ts

import type { BackendConnection } from '../../backend-contract/backend'
import {
  MAXIMUM_REQUESTED_ATT_MTU,
  MINIMUM_ATT_MTU,
  type MtuNegotiation,
  type ReadRssiRequest,
  type RequestMtuRequest,
  type RssiMeasurement
} from '../../backend-contract/connection-controls'
import { contractError } from '../../backend-contract/errors'
import type { BackendOperationDispatch } from '../../backend-contract/operations'
import { successfulTerminal } from './corebluetooth-handles'
import type { CoreBluetoothBackend } from './corebluetooth-backend'

/** Bridges optional direct-boundary connection controls into the canonical operation dispatcher. */
export class CoreBluetoothConnectionControls {
  constructor(private readonly backend: CoreBluetoothBackend) {}

  readRssi<Operation extends string>(
    connection: BackendConnection<string, string>,
    request: ReadRssiRequest<string, Operation>
  ): BackendOperationDispatch<string, RssiMeasurement<string, Operation>> {
    if (this.backend.boundary.connectionControlCapabilities?.rssi === 'unavailable') {
      return this.unsupported(request.operation, 'corebluetooth.connection.read-rssi')
    }
    const readRssi = this.backend.boundary.readRssi?.bind(this.backend.boundary)
    if (readRssi === undefined) {
      return this.unsupported(request.operation, 'corebluetooth.connection.read-rssi')
    }
    const record = this.backend.requireConnection(connection, 'corebluetooth.connection.read-rssi')
    return this.backend.dispatcher.dispatch(request.operation, 'corebluetooth.connection.read-rssi', async () => {
      const rssi = await readRssi(record.nativePeerId)
      if (!Number.isSafeInteger(rssi)) {
        throw contractError('protocol.malformed', 'connection', 'corebluetooth.connection.read-rssi.result')
      }
      return Object.freeze({ rssi, terminal: successfulTerminal(request.operation) })
    })
  }

  requestMtu<Operation extends string>(
    connection: BackendConnection<string, string>,
    request: RequestMtuRequest<string, Operation>
  ): BackendOperationDispatch<string, MtuNegotiation<string, Operation>> {
    if (this.backend.boundary.connectionControlCapabilities?.requestMtu === 'unavailable') {
      return this.unsupported(request.operation, 'corebluetooth.connection.request-mtu')
    }
    const requestMtu = this.backend.boundary.requestMtu?.bind(this.backend.boundary)
    if (requestMtu === undefined) {
      return this.unsupported(request.operation, 'corebluetooth.connection.request-mtu')
    }
    const record = this.backend.requireConnection(connection, 'corebluetooth.connection.request-mtu')
    return this.backend.dispatcher.dispatch(request.operation, 'corebluetooth.connection.request-mtu', async () => {
      const negotiatedMtu = await requestMtu(record.nativePeerId, request.requestedMtu)
      if (
        !Number.isSafeInteger(negotiatedMtu) ||
        negotiatedMtu < MINIMUM_ATT_MTU ||
        negotiatedMtu > MAXIMUM_REQUESTED_ATT_MTU
      ) {
        throw contractError('protocol.malformed', 'connection', 'corebluetooth.connection.request-mtu.result')
      }
      return Object.freeze({
        requestedMtu: request.requestedMtu,
        negotiatedMtu,
        terminal: successfulTerminal(request.operation)
      })
    })
  }

  private unsupported<Operation extends string, Result>(
    operation: ReadRssiRequest<string, Operation>['operation'],
    operationName: string
  ): BackendOperationDispatch<string, Result> {
    return this.backend.dispatcher.dispatch(operation, operationName, async () => {
      throw contractError('capability.unsupported', 'connection', operationName)
    })
  }
}
