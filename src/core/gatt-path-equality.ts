// src/core/gatt-path-equality.ts

import { attachmentRecordsEqual } from '../backend-contract/identity'
import type { CharacteristicPath, ConnectionPath, DatabasePath, DescriptorPath } from '../backend-contract/gatt'

export function connectionPathsEqual<Attachment extends string>(
  left: ConnectionPath<Attachment, string>,
  right: ConnectionPath<Attachment, string>
): boolean {
  return (
    left.attachmentId === right.attachmentId &&
    attachmentRecordsEqual(left.attachment, right.attachment) &&
    left.peerId === right.peerId &&
    left.connectionId === right.connectionId &&
    left.connectionGeneration === right.connectionGeneration &&
    left.ownerLeaseId === right.ownerLeaseId
  )
}

export function databasePathsEqual<Attachment extends string>(
  left: DatabasePath<Attachment, string, string>,
  right: DatabasePath<Attachment, string, string>
): boolean {
  return (
    connectionPathsEqual(left, right) &&
    left.databaseId === right.databaseId &&
    left.databaseGeneration === right.databaseGeneration
  )
}

export function characteristicPathsEqual<Attachment extends string>(
  left: CharacteristicPath<Attachment, string, string, string, string>,
  right: CharacteristicPath<Attachment, string, string, string, string>
): boolean {
  return (
    databasePathsEqual(left, right) &&
    left.serviceUuid === right.serviceUuid &&
    left.serviceOccurrence === right.serviceOccurrence &&
    left.characteristicUuid === right.characteristicUuid &&
    left.characteristicOccurrence === right.characteristicOccurrence &&
    left.validity === right.validity
  )
}

export function descriptorPathsEqual<Attachment extends string>(
  left: DescriptorPath<Attachment, string, string, string, string, string>,
  right: DescriptorPath<Attachment, string, string, string, string, string>
): boolean {
  return (
    characteristicPathsEqual(left, right) &&
    left.descriptorUuid === right.descriptorUuid &&
    left.descriptorOccurrence === right.descriptorOccurrence
  )
}

export function characteristicPathKey<Attachment extends string>(
  path: CharacteristicPath<Attachment, string, string, string, string>
): string {
  return [
    path.attachmentId,
    path.attachment.backendInstanceId,
    path.attachment.backendGeneration,
    path.attachment.adapter.adapterId,
    path.attachment.adapter.adapterGeneration,
    path.peerId,
    path.connectionId,
    path.connectionGeneration,
    path.ownerLeaseId,
    path.databaseId,
    path.databaseGeneration,
    path.serviceUuid,
    path.serviceOccurrence,
    path.characteristicUuid,
    path.characteristicOccurrence,
    path.validity
  ].join('|')
}
