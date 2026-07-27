// src/profiles/commands.ts

import { contractError } from '../backend-contract/errors'
import type { CharacteristicPath, GattDatabaseSnapshot } from '../backend-contract/gatt'
import type { BackendIdentity } from '../backend-contract/identity'
import type {
  PublicOperationOptions,
  SubscriptionOptions,
  WritePolicy,
  WriteReceipt
} from '../backend-contract/operations'
import type { OwnedBytes, Uuid } from '../backend-contract/primitives'
import type { Connection, DiscoveredGattDatabase, Subscription } from '../manager'

type CurrentCharacteristicPath<Attachment extends string> = CharacteristicPath<
  Attachment,
  string,
  string,
  string,
  string,
  'current'
>

/** A duplicate-safe selector for an attribute in one discovered GATT database. */
export interface CharacteristicSelector {
  readonly serviceUuid: Uuid
  readonly characteristicUuid: Uuid
  readonly serviceOccurrence: string | null
  readonly characteristicOccurrence: string | null
}

export interface CharacteristicSelectorOptions {
  readonly serviceOccurrence?: string
  readonly characteristicOccurrence?: string
}

export function characteristicSelector(
  serviceUuid: Uuid,
  characteristicUuid: Uuid,
  options: CharacteristicSelectorOptions = {}
): CharacteristicSelector {
  return {
    serviceUuid,
    characteristicUuid,
    serviceOccurrence: options.serviceOccurrence ?? null,
    characteristicOccurrence: options.characteristicOccurrence ?? null
  }
}

/** Thin public command for discovery; cancellation and deadlines stay with the public connection primitive. */
export function discoverGatt<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  connection: Connection<Attachment, Identity>,
  options: PublicOperationOptions
): Promise<DiscoveredGattDatabase<Attachment, Identity>> {
  return connection.discover(options)
}

/**
 * Resolves one exact characteristic path from an ordered snapshot. UUID-only
 * lookup is intentionally rejected when an occurrence is duplicated.
 */
export async function resolveCharacteristicPath<Attachment extends string>(
  snapshot: GattDatabaseSnapshot<Attachment, string, string>,
  selector: CharacteristicSelector
): Promise<CurrentCharacteristicPath<Attachment>> {
  const candidates = snapshot.characteristics.filter(characteristic => matchesSelector(characteristic.path, selector))
  if (candidates.length === 0) {
    throw contractError('gatt.not-found', 'gatt', 'profiles.resolve-characteristic-path')
  }
  if (candidates.length > 1) {
    throw contractError('gatt.ambiguous-path', 'gatt', 'profiles.resolve-characteristic-path')
  }
  const candidate = candidates[0]
  if (candidate === undefined) {
    throw contractError('lifecycle.invariant-violation', 'core', 'profiles.resolve-characteristic-path.selection')
  }
  return candidate.path
}

export async function readCharacteristic<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  database: DiscoveredGattDatabase<Attachment, Identity>,
  selector: CharacteristicSelector,
  options: PublicOperationOptions
): Promise<OwnedBytes> {
  const path = await resolveCharacteristicPath(await database.snapshot(), selector)
  return database.read(path, options)
}

export async function writeCharacteristic<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  database: DiscoveredGattDatabase<Attachment, Identity>,
  selector: CharacteristicSelector,
  value: Readonly<Uint8Array>,
  options: WritePolicy
): Promise<WriteReceipt<Attachment, string>> {
  const path = await resolveCharacteristicPath(await database.snapshot(), selector)
  return database.write(path, value, options)
}

export async function subscribeCharacteristic<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  database: DiscoveredGattDatabase<Attachment, Identity>,
  selector: CharacteristicSelector,
  options: SubscriptionOptions
): Promise<Subscription<Attachment, Identity>> {
  const path = await resolveCharacteristicPath(await database.snapshot(), selector)
  return database.subscribe(path, options)
}

function matchesSelector<Attachment extends string>(
  path: CurrentCharacteristicPath<Attachment>,
  selector: CharacteristicSelector
): boolean {
  return (
    path.serviceUuid === selector.serviceUuid &&
    path.characteristicUuid === selector.characteristicUuid &&
    (selector.serviceOccurrence === null || String(path.serviceOccurrence) === selector.serviceOccurrence) &&
    (selector.characteristicOccurrence === null ||
      String(path.characteristicOccurrence) === selector.characteristicOccurrence)
  )
}
