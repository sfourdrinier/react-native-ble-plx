// src/core/core-descriptor-operations.ts

import type { BleCentralBackend } from '../backend-contract/backend'
import type { DescriptorPath } from '../backend-contract/gatt'
import type { BackendIdentity } from '../backend-contract/identity'
import type { PublicOperationOptions, WritePolicy, WriteReceipt } from '../backend-contract/operations'
import { ownBytes, type ByteLimit, type OwnedBytes } from '../backend-contract/primitives'
import type { CoreGattDatabase } from './core-gatt-handles'
import type { CoreOperationCoordinator } from './operation-coordinator'
import { coreDispatch, requireOperationValue } from './unified-ble-core-helpers'

type CurrentDescriptorPath<Attachment extends string> = DescriptorPath<
  Attachment,
  string,
  string,
  string,
  string,
  string,
  'current'
>

export async function readCoreDescriptor<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  backend: BleCentralBackend<Attachment, Identity>,
  operationCoordinator: CoreOperationCoordinator<Attachment>,
  maximumValueBytes: ByteLimit,
  database: CoreGattDatabase<Attachment, Identity>,
  path: CurrentDescriptorPath<Attachment>,
  options: PublicOperationOptions
): Promise<OwnedBytes> {
  database.assertPath(path)
  const result = await operationCoordinator.run({
    queueKey: String(path.connectionId),
    options,
    mayCommit: false,
    dispatch: correlation => {
      database.assertPath(path)
      const dispatch = backend.gatt.readDescriptor(path, { operation: { ...options, correlation } })
      return coreDispatch(dispatch, correlation, value => value.terminal)
    }
  })
  const read = requireOperationValue(result, 'unified-core.read-descriptor')
  return ownBytes(read.value, maximumValueBytes)
}

export async function writeCoreDescriptor<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  backend: BleCentralBackend<Attachment, Identity>,
  operationCoordinator: CoreOperationCoordinator<Attachment>,
  maximumValueBytes: ByteLimit,
  database: CoreGattDatabase<Attachment, Identity>,
  path: CurrentDescriptorPath<Attachment>,
  bytes: Readonly<Uint8Array>,
  options: WritePolicy
): Promise<WriteReceipt<Attachment, string>> {
  database.assertPath(path)
  const owned = ownBytes(bytes, maximumValueBytes)
  const result = await operationCoordinator.run({
    queueKey: String(path.connectionId),
    options,
    mayCommit: true,
    retainedPayloadBytes: owned.byteLength,
    dispatch: correlation => {
      database.assertPath(path)
      const dispatch = backend.gatt.writeDescriptor(path, {
        operation: { ...options, correlation },
        bytes: owned,
        mode: options.mode
      })
      return coreDispatch(dispatch, correlation, value => value.terminal)
    }
  })
  return requireOperationValue(result, 'unified-core.write-descriptor')
}
