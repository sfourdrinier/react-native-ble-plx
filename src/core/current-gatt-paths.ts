// src/core/current-gatt-paths.ts

import type { CharacteristicPath, DescriptorPath } from '../backend-contract/gatt'

export type CurrentCharacteristicPath<Attachment extends string> = CharacteristicPath<
  Attachment,
  string,
  string,
  string,
  string,
  'current'
>

export type CurrentDescriptorPath<Attachment extends string> = DescriptorPath<
  Attachment,
  string,
  string,
  string,
  string,
  string,
  'current'
>
