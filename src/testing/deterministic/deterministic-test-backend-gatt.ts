// src/testing/deterministic/deterministic-test-backend-gatt.ts

import type { BackendConnection, BackendSubscription, GattBackend } from '../../backend-contract/backend'
import type { CharacteristicPath, DescriptorPath } from '../../backend-contract/gatt'
import type {
  BackendOperationDispatch,
  OperationOptions,
  OperationTerminalRecord,
  ReadRequest,
  ReadResult,
  SubscribeRequest,
  WriteRequest,
  WriteResult
} from '../../backend-contract/operations'

export interface DeterministicGattRuntime {
  discover(
    connection: BackendConnection<string, string>,
    options: import('../../backend-contract/operations').PublicOperationOptions
  ): Promise<import('../../backend-contract/gatt').GattDatabase<string, string, string>>
  read<
    Connection extends string,
    Database extends string,
    Service extends string,
    Characteristic extends string,
    Operation extends string
  >(
    path: CharacteristicPath<string, Connection, Database, Service, Characteristic, 'current'>,
    request: ReadRequest<string, Operation>
  ): Promise<ReadResult<string, Operation>>
  write<
    Connection extends string,
    Database extends string,
    Service extends string,
    Characteristic extends string,
    Operation extends string
  >(
    path: CharacteristicPath<string, Connection, Database, Service, Characteristic, 'current'>,
    request: WriteRequest<string, Operation>
  ): Promise<WriteResult<string, Operation>>
  readDescriptor<
    Connection extends string,
    Database extends string,
    Service extends string,
    Characteristic extends string,
    Descriptor extends string,
    Operation extends string
  >(
    path: DescriptorPath<string, Connection, Database, Service, Characteristic, Descriptor, 'current'>,
    request: ReadRequest<string, Operation>
  ): Promise<ReadResult<string, Operation>>
  writeDescriptor<
    Connection extends string,
    Database extends string,
    Service extends string,
    Characteristic extends string,
    Descriptor extends string,
    Operation extends string
  >(
    path: DescriptorPath<string, Connection, Database, Service, Characteristic, Descriptor, 'current'>,
    request: WriteRequest<string, Operation>
  ): Promise<WriteResult<string, Operation>>
  subscribeFromBackend<
    Connection extends string,
    Database extends string,
    Service extends string,
    Characteristic extends string,
    Operation extends string
  >(
    path: CharacteristicPath<string, Connection, Database, Service, Characteristic, 'current'>,
    request: SubscribeRequest<string, Operation>
  ): Promise<BackendSubscription<string, string, string, string, string>>
  unsubscribeFromBackend<
    Connection extends string,
    Database extends string,
    Service extends string,
    Characteristic extends string,
    Operation extends string
  >(
    subscription: BackendSubscription<string, Connection, Database, Service, Characteristic>,
    operation: OperationOptions<string, Operation>
  ): Promise<OperationTerminalRecord<string, string>>
  createBackendOperationDispatch<Operation extends string, Result>(
    operation: OperationOptions<string, Operation>,
    start: (operation: OperationOptions<string, Operation>) => Promise<Result>
  ): BackendOperationDispatch<string, Result>
}

export function createDeterministicGattBackend(runtime: DeterministicGattRuntime): GattBackend<string> {
  return {
    discover: async (
      connection: BackendConnection<string, string>,
      options: import('../../backend-contract/operations').PublicOperationOptions
    ) => runtime.discover(connection, options),
    read: <
      Connection extends string,
      Database extends string,
      Service extends string,
      Characteristic extends string,
      Operation extends string
    >(
      path: CharacteristicPath<string, Connection, Database, Service, Characteristic, 'current'>,
      request: ReadRequest<string, Operation>
    ) => runtime.createBackendOperationDispatch(request.operation, operation => runtime.read(path, { operation })),
    write: <
      Connection extends string,
      Database extends string,
      Service extends string,
      Characteristic extends string,
      Operation extends string
    >(
      path: CharacteristicPath<string, Connection, Database, Service, Characteristic, 'current'>,
      request: WriteRequest<string, Operation>
    ) =>
      runtime.createBackendOperationDispatch(request.operation, operation =>
        runtime.write(path, { ...request, operation })
      ),
    readDescriptor: <
      Connection extends string,
      Database extends string,
      Service extends string,
      Characteristic extends string,
      Descriptor extends string,
      Operation extends string
    >(
      path: DescriptorPath<string, Connection, Database, Service, Characteristic, Descriptor, 'current'>,
      request: ReadRequest<string, Operation>
    ) =>
      runtime.createBackendOperationDispatch(request.operation, operation =>
        runtime.readDescriptor(path, { operation })
      ),
    writeDescriptor: <
      Connection extends string,
      Database extends string,
      Service extends string,
      Characteristic extends string,
      Descriptor extends string,
      Operation extends string
    >(
      path: DescriptorPath<string, Connection, Database, Service, Characteristic, Descriptor, 'current'>,
      request: WriteRequest<string, Operation>
    ) =>
      runtime.createBackendOperationDispatch(request.operation, operation =>
        runtime.writeDescriptor(path, { ...request, operation })
      ),
    subscribe: <
      Connection extends string,
      Database extends string,
      Service extends string,
      Characteristic extends string,
      Operation extends string
    >(
      path: CharacteristicPath<string, Connection, Database, Service, Characteristic, 'current'>,
      request: SubscribeRequest<string, Operation>
    ) =>
      runtime.createBackendOperationDispatch(request.operation, operation =>
        runtime.subscribeFromBackend(path, { ...request, operation })
      ),
    unsubscribe: <
      Connection extends string,
      Database extends string,
      Service extends string,
      Characteristic extends string,
      Operation extends string
    >(
      subscription: BackendSubscription<string, Connection, Database, Service, Characteristic>,
      operation: OperationOptions<string, Operation>
    ) =>
      runtime.createBackendOperationDispatch(operation, dispatchedOperation =>
        runtime.unsubscribeFromBackend(subscription, dispatchedOperation)
      )
  }
}
