// src/backends/corebluetooth/corebluetooth-identifiers.ts

import type { AttachmentRecord } from '../../backend-contract/identity'
import { createAttachmentBoundIdFactory } from '../../backend-contract/primitives'

export function createCoreBluetoothIdentifiers(attachment: AttachmentRecord<string>) {
  return createAttachmentBoundIdFactory({
    attachmentId: attachment.attachmentId,
    backendInstanceId: attachment.backendInstanceId,
    backendGeneration: attachment.backendGeneration,
    adapterId: attachment.adapter.adapterId,
    adapterGeneration: attachment.adapter.adapterGeneration
  })
}
