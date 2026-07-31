// src/core/current-gatt-paths.ts

import type { CharacteristicPath, DescriptorPath } from '../backend-contract/gatt'

export type CurrentCharacteristicPath<
  Attachment extends string,
  Connection extends string = string,
  Database extends string = string,
  ServiceOccurrence extends string = string,
  CharacteristicOccurrence extends string = string
> = CharacteristicPath<Attachment, Connection, Database, ServiceOccurrence, CharacteristicOccurrence, 'current'>

export type CurrentDescriptorPath<
  Attachment extends string,
  Connection extends string = string,
  Database extends string = string,
  ServiceOccurrence extends string = string,
  CharacteristicOccurrence extends string = string,
  DescriptorOccurrence extends string = string
> = DescriptorPath<
  Attachment,
  Connection,
  Database,
  ServiceOccurrence,
  CharacteristicOccurrence,
  DescriptorOccurrence,
  'current'
>
