// src/electron/ipc-message-sizing.ts

import { contractError } from '../backend-contract/errors'
import type { IpcEnvelope } from '../backend-contract/electron'
import type { IpcVersionAxes, SerializableRecord } from '../backend-contract/primitives'
import { snapshotSerializableRecord } from '../backend-contract/serializable'
import type { ElectronBleIpcRequest } from './protocol'

export function electronRequestByteLength<Renderer extends string, Operation extends string>(
  request: ElectronBleIpcRequest<string, Renderer, Operation>
): number {
  if (request.kind === 'route') {
    return ipcEnvelopeByteLength(request.envelope)
  }
  return snapshotSerializableRecord(controlRequestRecord(request)).byteLength
}

function controlRequestRecord<Renderer extends string, Operation extends string>(
  request: ElectronBleIpcRequest<string, Renderer, Operation>
): SerializableRecord {
  if (request.kind === 'bootstrap') {
    return Object.freeze({ kind: request.kind })
  }
  if (request.kind === 'event.ack') {
    return Object.freeze({ kind: request.kind, eventId: request.eventId })
  }
  if (request.kind === 'release') {
    return Object.freeze({ kind: request.kind })
  }
  throw contractError('lifecycle.invariant-violation', 'ipc', 'electron-ipc-message-sizing.route-control')
}

function ipcEnvelopeByteLength<Renderer extends string, Operation extends string>(
  envelope: IpcEnvelope<string, Renderer, Operation>
): number {
  return snapshotSerializableRecord({
    versions: Object.freeze({
      backendContract: snapshotVersion(envelope.versions.backendContract),
      capabilitySchema: snapshotVersion(envelope.versions.capabilitySchema),
      eventSchema: snapshotVersion(envelope.versions.eventSchema),
      traceFormat: snapshotVersion(envelope.versions.traceFormat),
      ipcProtocol: snapshotVersion(envelope.versions.ipcProtocol)
    }),
    attachment: Object.freeze({
      attachmentId: String(envelope.attachment.attachmentId),
      backendInstanceId: String(envelope.attachment.backendInstanceId),
      backendGeneration: String(envelope.attachment.backendGeneration),
      adapter: Object.freeze({
        adapterId: String(envelope.attachment.adapter.adapterId),
        adapterGeneration: String(envelope.attachment.adapter.adapterGeneration)
      })
    }),
    attachmentId: String(envelope.attachmentId),
    renderer: Object.freeze({
      clientId: String(envelope.renderer.clientId),
      windowScope: envelope.renderer.windowScope,
      sessionScope: envelope.renderer.sessionScope
    }),
    correlation: String(envelope.correlation),
    dispatchEpoch: String(envelope.dispatchEpoch),
    command: envelope.command,
    payload: envelope.payload,
    binaryPayload: envelope.binaryPayload
  }).byteLength
}

function snapshotVersion(
  value:
    | IpcVersionAxes['backendContract']
    | IpcVersionAxes['capabilitySchema']
    | IpcVersionAxes['eventSchema']
    | IpcVersionAxes['traceFormat']
    | IpcVersionAxes['ipcProtocol']
): SerializableRecord {
  return Object.freeze({
    axis: String(value.axis),
    selected: Object.freeze({ axis: String(value.selected.axis), value: value.selected.value }),
    localRange: Object.freeze({
      axis: String(value.localRange.axis),
      minimum: Object.freeze({
        axis: String(value.localRange.minimum.axis),
        value: value.localRange.minimum.value
      }),
      maximum: Object.freeze({
        axis: String(value.localRange.maximum.axis),
        value: value.localRange.maximum.value
      })
    }),
    remoteRange: Object.freeze({
      axis: String(value.remoteRange.axis),
      minimum: Object.freeze({
        axis: String(value.remoteRange.minimum.axis),
        value: value.remoteRange.minimum.value
      }),
      maximum: Object.freeze({
        axis: String(value.remoteRange.maximum.axis),
        value: value.remoteRange.maximum.value
      })
    })
  })
}
