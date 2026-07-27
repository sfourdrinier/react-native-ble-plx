// src/core/core-discovery.ts

import { BackendContractError, contractError } from '../backend-contract/errors'
import type { BleCentralBackend } from '../backend-contract/backend'
import type { GattDatabase } from '../backend-contract/gatt'
import type { BackendIdentity } from '../backend-contract/identity'
import type { PublicOperationOptions } from '../backend-contract/operations'
import type { CoreConnection, CoreGattDatabase } from './core-gatt-handles'
import { CoreGattDatabase as CoreGattDatabaseRuntime } from './core-gatt-handles'
import type { ResourceLedger } from './resource-ledger'
import type { UnifiedBleCore } from './unified-ble-core'

/** Performs a fresh database discovery after invalidating the prior generation-bound snapshot. */
export async function discoverCoreGattDatabase<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  core: UnifiedBleCore<Attachment, Identity>,
  backend: BleCentralBackend<Attachment, Identity>,
  resourceLedger: ResourceLedger,
  connection: CoreConnection<Attachment, Identity>,
  options: PublicOperationOptions,
  assertReady: (operation: string) => void,
  assertOperationAdmission: (options: PublicOperationOptions, operation: string) => void,
  assertAdmissionCurrent: (admissionEpoch: number, options: PublicOperationOptions, operation: string) => void,
  admissionEpoch: number
): Promise<CoreGattDatabase<Attachment, Identity>> {
  assertReady('discover')
  assertOperationAdmission(options, 'discover')
  connection.assertCurrent()
  const invalidation = await connection.invalidateDatabase('owner-released')
  if (invalidation.state === 'release-failed') {
    throw new BackendContractError(
      invalidation.failures[0]?.error ??
        contractError('platform.failure', 'gatt', 'unified-core.discover-cleanup').normalized
    )
  }
  assertAdmissionCurrent(admissionEpoch, options, 'discover')
  connection.assertCurrent()
  let backendDatabase: GattDatabase<Attachment, string, string>
  try {
    backendDatabase = await backend.gatt.discover(connection.resource, options)
  } catch (error) {
    if (error instanceof BackendContractError) {
      throw error
    }
    throw contractError('gatt.discovery-required', 'gatt', 'unified-core.discover')
  }
  assertAdmissionCurrent(admissionEpoch, options, 'discover')
  connection.assertCurrent()
  const database = new CoreGattDatabaseRuntime(core, connection, backendDatabase)
  connection.setDatabase(database)
  resourceLedger.increment('databaseSnapshots')
  return database
}
