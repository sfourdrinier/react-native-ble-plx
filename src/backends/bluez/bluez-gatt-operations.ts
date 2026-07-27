// src/backends/bluez/bluez-gatt-operations.ts

import type { CharacteristicPath, DescriptorPath } from '../../backend-contract/gatt'
import type {
  BackendOperationDispatch,
  PublicOperationOptions,
  ReadRequest,
  ReadResult,
  WritePolicy,
  WriteReceipt,
  WriteRequest,
  WriteResult
} from '../../backend-contract/operations'
import { byteLimit, ownBytes, type OwnedBytes } from '../../backend-contract/primitives'
import type { BluezBackendRuntime } from './bluez-backend-runtime'
import { BluezGattDatabase } from './bluez-backend-handles'
import { BLUEZ_GATT_CHARACTERISTIC_INTERFACE, BLUEZ_GATT_DESCRIPTOR_INTERFACE } from './bluez-dbus-contract'
import { successfulTerminal } from './bluez-runtime-models'

const maximumOperationBytes = byteLimit(512 * 1024)

export function dispatchBluezCharacteristicRead(
  runtime: BluezBackendRuntime,
  path: CharacteristicPath<string, string, string, string, string, 'current'>,
  request: ReadRequest<string, string>
): BackendOperationDispatch<string, ReadResult<string, string>> {
  return runtime.dispatcher.dispatch(request.operation, 'bluez.gatt.read', async () => {
    const value = await runtime.boundary.methods.callBytes(
      runtime.resolveCharacteristicPath(path, 'bluez.gatt.read'),
      BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
      'ReadValue',
      {}
    )
    runtime.resolveCharacteristicPath(path, 'bluez.gatt.read.after-method')
    return { value: ownBytes(value, maximumOperationBytes), terminal: successfulTerminal(request.operation) }
  })
}

export function dispatchBluezCharacteristicWrite(
  runtime: BluezBackendRuntime,
  path: CharacteristicPath<string, string, string, string, string, 'current'>,
  request: WriteRequest<string, string>
): BackendOperationDispatch<string, WriteResult<string, string>> {
  const copied = new Uint8Array(request.bytes)
  return runtime.dispatcher.dispatch(request.operation, 'bluez.gatt.write', async () => {
    await writeValueCall(
      runtime,
      runtime.resolveCharacteristicPath(path, 'bluez.gatt.write'),
      BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
      copied,
      request.mode
    )
    runtime.resolveCharacteristicPath(path, 'bluez.gatt.write.after-method')
    return { terminal: successfulTerminal(request.operation), commitState: 'confirmed' }
  })
}

export function dispatchBluezDescriptorRead(
  runtime: BluezBackendRuntime,
  path: DescriptorPath<string, string, string, string, string, string, 'current'>,
  request: ReadRequest<string, string>
): BackendOperationDispatch<string, ReadResult<string, string>> {
  return runtime.dispatcher.dispatch(request.operation, 'bluez.gatt.read-descriptor', async () => {
    const value = await runtime.boundary.methods.callBytes(
      runtime.resolveDescriptorPath(path, 'bluez.gatt.read-descriptor'),
      BLUEZ_GATT_DESCRIPTOR_INTERFACE,
      'ReadValue',
      {}
    )
    runtime.resolveDescriptorPath(path, 'bluez.gatt.read-descriptor.after-method')
    return { value: ownBytes(value, maximumOperationBytes), terminal: successfulTerminal(request.operation) }
  })
}

export function dispatchBluezDescriptorWrite(
  runtime: BluezBackendRuntime,
  path: DescriptorPath<string, string, string, string, string, string, 'current'>,
  request: WriteRequest<string, string>
): BackendOperationDispatch<string, WriteResult<string, string>> {
  const copied = new Uint8Array(request.bytes)
  return runtime.dispatcher.dispatch(request.operation, 'bluez.gatt.write-descriptor', async () => {
    await writeValueCall(
      runtime,
      runtime.resolveDescriptorPath(path, 'bluez.gatt.write-descriptor'),
      BLUEZ_GATT_DESCRIPTOR_INTERFACE,
      copied,
      request.mode
    )
    runtime.resolveDescriptorPath(path, 'bluez.gatt.write-descriptor.after-method')
    return { terminal: successfulTerminal(request.operation), commitState: 'confirmed' }
  })
}

export async function readBluezValue(
  runtime: BluezBackendRuntime,
  database: BluezGattDatabase,
  objectPath: string,
  interfaceName: string,
  options: PublicOperationOptions,
  operation: string
): Promise<OwnedBytes> {
  database.assertCurrent(operation)
  return runtime.dispatcher.dispatch(options, operation, async () =>
    ownBytes(
      await readCurrentBluezValue(runtime, database, objectPath, interfaceName, operation),
      maximumOperationBytes
    )
  ).completion
}

export async function writeBluezValue(
  runtime: BluezBackendRuntime,
  database: BluezGattDatabase,
  objectPath: string,
  interfaceName: string,
  value: Uint8Array,
  options: WritePolicy,
  operation: string
): Promise<WriteReceipt<string, string>> {
  database.assertCurrent(operation)
  const copied = new Uint8Array(value)
  return runtime.dispatcher.dispatch(options, operation, async () => {
    await writeValueCall(runtime, objectPath, interfaceName, copied, options.mode)
    database.assertCurrent(`${operation}.after-method`)
    const receipt: WriteReceipt<string, string> = {
      terminal: {
        correlation: runtime.allocateDatabaseCorrelation(operation),
        outcome: 'succeeded',
        cause: null
      },
      commitState: 'confirmed'
    }
    return receipt
  }).completion
}

async function readCurrentBluezValue(
  runtime: BluezBackendRuntime,
  database: BluezGattDatabase,
  objectPath: string,
  interfaceName: string,
  operation: string
): Promise<Uint8Array> {
  const value = await runtime.boundary.methods.callBytes(objectPath, interfaceName, 'ReadValue', {})
  database.assertCurrent(`${operation}.after-method`)
  return value
}

async function writeValueCall(
  runtime: BluezBackendRuntime,
  objectPath: string,
  interfaceName: string,
  copied: Uint8Array,
  mode: WritePolicy['mode']
): Promise<void> {
  await runtime.boundary.methods.callVoid(objectPath, interfaceName, 'WriteValue', [
    { signature: 'ay', value: copied },
    {
      signature: 'a{sv}',
      value: {
        type: { signature: 's', value: mode === 'with-response' ? 'request' : 'command' }
      }
    }
  ])
}
