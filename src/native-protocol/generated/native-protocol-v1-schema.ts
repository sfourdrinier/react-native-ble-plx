// src/native-protocol/generated/native-protocol-v1-schema.ts

export const NATIVE_PROTOCOL_VERSION = 1
export const NATIVE_PROTOCOL_ABI_VERSION = 1
export const MAXIMUM_CONTROL_RECORD_BYTES = 262144
export const MAXIMUM_BINARY_PAYLOAD_BYTES = 524288

export const recordKinds = Object.freeze([
  'attachment',
  'connectionPath',
  'databasePath',
  'servicePath',
  'characteristicPath',
  'descriptorPath',
  'operationCorrelation',
  'binaryReference',
  'serviceDataEntry',
  'manufacturerDataEntry',
  'scanOptions',
  'adapterStateSnapshot',
  'characteristicSnapshot',
  'databaseSnapshot',
  'command',
  'terminal',
  'result',
  'advertisement',
  'event',
  'error',
  'restorationRecord',
  'restorationAdoptionRequest',
  'restorationAdoptionResult'
])
export type RecordKind = (typeof recordKinds)[number]

export const nativeProtocolRecordWireIds: Readonly<Record<RecordKind, number>> = Object.freeze({
  attachment: 1,
  connectionPath: 2,
  databasePath: 3,
  servicePath: 4,
  characteristicPath: 5,
  descriptorPath: 6,
  operationCorrelation: 7,
  binaryReference: 8,
  serviceDataEntry: 9,
  manufacturerDataEntry: 10,
  command: 11,
  terminal: 12,
  result: 13,
  advertisement: 14,
  event: 15,
  error: 16,
  restorationRecord: 17,
  restorationAdoptionRequest: 18,
  restorationAdoptionResult: 19,
  scanOptions: 20,
  databaseSnapshot: 21,
  characteristicSnapshot: 22,
  adapterStateSnapshot: 23
})

export const nativeProtocolEnumValues: Readonly<Record<string, readonly string[]>> = Object.freeze({
  commandKinds: [
    'scanStart',
    'scanStop',
    'connect',
    'disconnect',
    'discover',
    'read',
    'write',
    'subscribe',
    'unsubscribe',
    'cancel',
    'adoptRestoration',
    'destroy',
    'readRssi',
    'requestMtu',
    'readDescriptor',
    'writeDescriptor'
  ],
  resultKinds: [
    'accepted',
    'scanStarted',
    'connected',
    'database',
    'read',
    'write',
    'subscribed',
    'unsubscribed',
    'cancelled',
    'restoration',
    'destroyed',
    'rssi',
    'mtu',
    'descriptorRead',
    'descriptorWrite'
  ],
  eventKinds: [
    'adapterState',
    'advertisement',
    'connectionLost',
    'databaseChanged',
    'notification',
    'backendRestarted',
    'restorationAvailable',
    'diagnostic'
  ],
  terminalOutcomes: ['succeeded', 'failed'],
  cancellationStates: ['cancellationRequested', 'alreadyTerminal', 'notCancellable'],
  binaryOwnership: ['nativeOwnedCopy', 'javascriptOwnedCopy', 'transferred'],
  writeModes: ['withResponse', 'withoutResponse'],
  adapterAvailability: ['available', 'unavailable', 'unsupported', 'unknown'],
  adapterAuthorization: ['granted', 'denied', 'restricted', 'notDetermined', 'unavailable'],
  adapterPower: ['on', 'off', 'resetting', 'unsupported', 'unknown'],
  restorationKinds: ['adapter', 'connection', 'subscription', 'event'],
  restorationOutcomes: [
    'adopted',
    'alreadyConsumed',
    'attachmentMismatch',
    'backendMismatch',
    'namespaceMismatch',
    'epochMismatch'
  ]
})

export const commandKinds = Object.freeze([
  'scanStart',
  'scanStop',
  'connect',
  'disconnect',
  'discover',
  'read',
  'write',
  'subscribe',
  'unsubscribe',
  'cancel',
  'adoptRestoration',
  'destroy',
  'readRssi',
  'requestMtu',
  'readDescriptor',
  'writeDescriptor'
])
export type CommandKinds = (typeof commandKinds)[number]

export const resultKinds = Object.freeze([
  'accepted',
  'scanStarted',
  'connected',
  'database',
  'read',
  'write',
  'subscribed',
  'unsubscribed',
  'cancelled',
  'restoration',
  'destroyed',
  'rssi',
  'mtu',
  'descriptorRead',
  'descriptorWrite'
])
export type ResultKinds = (typeof resultKinds)[number]

export const eventKinds = Object.freeze([
  'adapterState',
  'advertisement',
  'connectionLost',
  'databaseChanged',
  'notification',
  'backendRestarted',
  'restorationAvailable',
  'diagnostic'
])
export type EventKinds = (typeof eventKinds)[number]

export const terminalOutcomes = Object.freeze(['succeeded', 'failed'])
export type TerminalOutcomes = (typeof terminalOutcomes)[number]

export const cancellationStates = Object.freeze(['cancellationRequested', 'alreadyTerminal', 'notCancellable'])
export type CancellationStates = (typeof cancellationStates)[number]

export const binaryOwnership = Object.freeze(['nativeOwnedCopy', 'javascriptOwnedCopy', 'transferred'])
export type BinaryOwnership = (typeof binaryOwnership)[number]

export const writeModes = Object.freeze(['withResponse', 'withoutResponse'])
export type WriteModes = (typeof writeModes)[number]

export const adapterAvailability = Object.freeze(['available', 'unavailable', 'unsupported', 'unknown'])
export type AdapterAvailability = (typeof adapterAvailability)[number]

export const adapterAuthorization = Object.freeze(['granted', 'denied', 'restricted', 'notDetermined', 'unavailable'])
export type AdapterAuthorization = (typeof adapterAuthorization)[number]

export const adapterPower = Object.freeze(['on', 'off', 'resetting', 'unsupported', 'unknown'])
export type AdapterPower = (typeof adapterPower)[number]

export const restorationKinds = Object.freeze(['adapter', 'connection', 'subscription', 'event'])
export type RestorationKinds = (typeof restorationKinds)[number]

export const restorationOutcomes = Object.freeze([
  'adopted',
  'alreadyConsumed',
  'attachmentMismatch',
  'backendMismatch',
  'namespaceMismatch',
  'epochMismatch'
])
export type RestorationOutcomes = (typeof restorationOutcomes)[number]

export type NativeProtocolFieldDescriptor = readonly [
  record: RecordKind,
  fieldId: number,
  name: string,
  type: string,
  required: boolean
]

function nativeProtocolField(
  record: RecordKind,
  fieldId: number,
  name: string,
  type: string,
  required: boolean
): NativeProtocolFieldDescriptor {
  return Object.freeze([record, fieldId, name, type, required])
}

export const nativeProtocolFields: readonly NativeProtocolFieldDescriptor[] = Object.freeze([
  nativeProtocolField('attachment', 1, 'attachmentId', 'string', true),
  nativeProtocolField('attachment', 2, 'backendInstanceId', 'string', true),
  nativeProtocolField('attachment', 3, 'backendGeneration', 'string', true),
  nativeProtocolField('attachment', 4, 'adapterId', 'string', true),
  nativeProtocolField('attachment', 5, 'adapterGeneration', 'string', true),
  nativeProtocolField('connectionPath', 1, 'attachment', 'record:attachment', true),
  nativeProtocolField('connectionPath', 2, 'peerId', 'string', true),
  nativeProtocolField('connectionPath', 3, 'connectionId', 'string', true),
  nativeProtocolField('connectionPath', 4, 'ownerLeaseId', 'string', true),
  nativeProtocolField('connectionPath', 5, 'connectionGeneration', 'string', true),
  nativeProtocolField('databasePath', 1, 'connection', 'record:connectionPath', true),
  nativeProtocolField('databasePath', 2, 'databaseId', 'string', true),
  nativeProtocolField('databasePath', 3, 'databaseGeneration', 'string', true),
  nativeProtocolField('servicePath', 1, 'database', 'record:databasePath', true),
  nativeProtocolField('servicePath', 2, 'serviceUuid', 'string', true),
  nativeProtocolField('servicePath', 3, 'serviceOccurrence', 'string', true),
  nativeProtocolField('characteristicPath', 1, 'service', 'record:servicePath', true),
  nativeProtocolField('characteristicPath', 2, 'characteristicUuid', 'string', true),
  nativeProtocolField('characteristicPath', 3, 'characteristicOccurrence', 'string', true),
  nativeProtocolField('descriptorPath', 1, 'characteristic', 'record:characteristicPath', true),
  nativeProtocolField('descriptorPath', 2, 'descriptorUuid', 'string', true),
  nativeProtocolField('descriptorPath', 3, 'descriptorOccurrence', 'string', true),
  nativeProtocolField('operationCorrelation', 1, 'attachment', 'record:attachment', true),
  nativeProtocolField('operationCorrelation', 2, 'dispatchEpoch', 'uint64', true),
  nativeProtocolField('operationCorrelation', 3, 'nonce', 'string', true),
  nativeProtocolField('binaryReference', 1, 'ownerToken', 'string', true),
  nativeProtocolField('binaryReference', 2, 'byteOffset', 'uint64', true),
  nativeProtocolField('binaryReference', 3, 'byteLength', 'uint64', true),
  nativeProtocolField('binaryReference', 4, 'ownership', 'enum:binaryOwnership', true),
  nativeProtocolField('binaryReference', 5, 'operationCorrelation', 'string', true),
  nativeProtocolField('serviceDataEntry', 1, 'serviceUuid', 'string', true),
  nativeProtocolField('serviceDataEntry', 2, 'binary', 'record:binaryReference', true),
  nativeProtocolField('manufacturerDataEntry', 1, 'companyIdentifier', 'uint64', true),
  nativeProtocolField('manufacturerDataEntry', 2, 'binary', 'record:binaryReference', true),
  nativeProtocolField('scanOptions', 1, 'serviceUuids', 'strings', true),
  nativeProtocolField('scanOptions', 2, 'allowDuplicates', 'boolean', true),
  nativeProtocolField('scanOptions', 3, 'scanMode', 'int64', true),
  nativeProtocolField('scanOptions', 4, 'callbackType', 'int64', true),
  nativeProtocolField('scanOptions', 5, 'legacyScan', 'boolean', true),
  nativeProtocolField('adapterStateSnapshot', 1, 'availability', 'enum:adapterAvailability', true),
  nativeProtocolField('adapterStateSnapshot', 2, 'authorization', 'enum:adapterAuthorization', true),
  nativeProtocolField('adapterStateSnapshot', 3, 'power', 'enum:adapterPower', true),
  nativeProtocolField('adapterStateSnapshot', 4, 'safeReason', 'string', false),
  nativeProtocolField('characteristicSnapshot', 1, 'path', 'record:characteristicPath', true),
  nativeProtocolField('characteristicSnapshot', 2, 'readable', 'boolean', true),
  nativeProtocolField('characteristicSnapshot', 3, 'writableWithResponse', 'boolean', true),
  nativeProtocolField('characteristicSnapshot', 4, 'writableWithoutResponse', 'boolean', true),
  nativeProtocolField('characteristicSnapshot', 5, 'notifiable', 'boolean', true),
  nativeProtocolField('databaseSnapshot', 1, 'databasePath', 'record:databasePath', true),
  nativeProtocolField('databaseSnapshot', 2, 'services', 'records:servicePath', true),
  nativeProtocolField('databaseSnapshot', 3, 'characteristics', 'records:characteristicSnapshot', true),
  nativeProtocolField('databaseSnapshot', 4, 'descriptors', 'records:descriptorPath', true),
  nativeProtocolField('command', 1, 'protocolVersion', 'uint64', true),
  nativeProtocolField('command', 2, 'correlation', 'record:operationCorrelation', true),
  nativeProtocolField('command', 3, 'kind', 'enum:commandKinds', true),
  nativeProtocolField('command', 4, 'characteristicPath', 'record:characteristicPath', false),
  nativeProtocolField('command', 5, 'descriptorPath', 'record:descriptorPath', false),
  nativeProtocolField('command', 6, 'binary', 'record:binaryReference', false),
  nativeProtocolField('command', 7, 'subscriptionId', 'string', false),
  nativeProtocolField('command', 8, 'cancellationCorrelation', 'record:operationCorrelation', false),
  nativeProtocolField('command', 9, 'restorationRequest', 'record:restorationAdoptionRequest', false),
  nativeProtocolField('command', 10, 'connectionPath', 'record:connectionPath', false),
  nativeProtocolField('command', 11, 'databasePath', 'record:databasePath', false),
  nativeProtocolField('command', 12, 'scanOptions', 'record:scanOptions', false),
  nativeProtocolField('command', 13, 'writeMode', 'enum:writeModes', false),
  nativeProtocolField('command', 14, 'requestedMtu', 'uint64', false),
  nativeProtocolField('terminal', 1, 'correlation', 'record:operationCorrelation', true),
  nativeProtocolField('terminal', 2, 'outcome', 'enum:terminalOutcomes', true),
  nativeProtocolField('terminal', 3, 'cause', 'string', false),
  nativeProtocolField('result', 1, 'protocolVersion', 'uint64', true),
  nativeProtocolField('result', 2, 'kind', 'enum:resultKinds', true),
  nativeProtocolField('result', 3, 'terminal', 'record:terminal', true),
  nativeProtocolField('result', 4, 'databasePath', 'record:databasePath', false),
  nativeProtocolField('result', 5, 'characteristicPath', 'record:characteristicPath', false),
  nativeProtocolField('result', 6, 'binary', 'record:binaryReference', false),
  nativeProtocolField('result', 7, 'subscriptionId', 'string', false),
  nativeProtocolField('result', 8, 'cancellationState', 'enum:cancellationStates', false),
  nativeProtocolField('result', 9, 'restoration', 'record:restorationAdoptionResult', false),
  nativeProtocolField('result', 10, 'error', 'record:error', false),
  nativeProtocolField('result', 11, 'connectionPath', 'record:connectionPath', false),
  nativeProtocolField('result', 12, 'databaseSnapshot', 'record:databaseSnapshot', false),
  nativeProtocolField('result', 13, 'rssi', 'int64', false),
  nativeProtocolField('result', 14, 'negotiatedMtu', 'uint64', false),
  nativeProtocolField('result', 15, 'descriptorPath', 'record:descriptorPath', false),
  nativeProtocolField('advertisement', 1, 'peerId', 'string', true),
  nativeProtocolField('advertisement', 2, 'observedAt', 'uint64', true),
  nativeProtocolField('advertisement', 3, 'ingressOrdinal', 'uint64', true),
  nativeProtocolField('advertisement', 4, 'source', 'string', true),
  nativeProtocolField('advertisement', 5, 'localName', 'string', false),
  nativeProtocolField('advertisement', 6, 'rssi', 'int64', false),
  nativeProtocolField('advertisement', 7, 'txPower', 'int64', false),
  nativeProtocolField('advertisement', 8, 'connectable', 'boolean', false),
  nativeProtocolField('advertisement', 9, 'appearance', 'uint64', false),
  nativeProtocolField('advertisement', 10, 'serviceUuids', 'strings', false),
  nativeProtocolField('advertisement', 11, 'solicitedServiceUuids', 'strings', false),
  nativeProtocolField('advertisement', 12, 'overflowServiceUuids', 'strings', false),
  nativeProtocolField('advertisement', 13, 'serviceData', 'records:serviceDataEntry', false),
  nativeProtocolField('advertisement', 14, 'manufacturerData', 'records:manufacturerDataEntry', false),
  nativeProtocolField('advertisement', 15, 'rawRecord', 'record:binaryReference', false),
  nativeProtocolField('advertisement', 16, 'scanResponseRecord', 'record:binaryReference', false),
  nativeProtocolField('advertisement', 17, 'fieldProvenance', 'strings', true),
  nativeProtocolField('event', 1, 'protocolVersion', 'uint64', true),
  nativeProtocolField('event', 2, 'eventId', 'string', true),
  nativeProtocolField('event', 3, 'kind', 'enum:eventKinds', true),
  nativeProtocolField('event', 4, 'attachment', 'record:attachment', true),
  nativeProtocolField('event', 5, 'ingressOrdinal', 'uint64', true),
  nativeProtocolField('event', 6, 'monotonicTimestamp', 'uint64', true),
  nativeProtocolField('event', 7, 'connectionPath', 'record:connectionPath', false),
  nativeProtocolField('event', 8, 'databasePath', 'record:databasePath', false),
  nativeProtocolField('event', 9, 'characteristicPath', 'record:characteristicPath', false),
  nativeProtocolField('event', 10, 'operationCorrelation', 'record:operationCorrelation', false),
  nativeProtocolField('event', 11, 'subscriptionId', 'string', false),
  nativeProtocolField('event', 12, 'advertisement', 'record:advertisement', false),
  nativeProtocolField('event', 13, 'binary', 'record:binaryReference', false),
  nativeProtocolField('event', 14, 'error', 'record:error', false),
  nativeProtocolField('event', 15, 'adapterState', 'record:adapterStateSnapshot', false),
  nativeProtocolField('error', 1, 'code', 'string', true),
  nativeProtocolField('error', 2, 'domain', 'string', true),
  nativeProtocolField('error', 3, 'operation', 'string', true),
  nativeProtocolField('error', 4, 'retryability', 'string', true),
  nativeProtocolField('error', 5, 'platformDomain', 'string', false),
  nativeProtocolField('error', 6, 'platformCode', 'string', false),
  nativeProtocolField('error', 7, 'safeMessage', 'string', false),
  nativeProtocolField('error', 8, 'androidGattStatus', 'int64', false),
  nativeProtocolField('error', 9, 'coreBluetoothDomain', 'string', false),
  nativeProtocolField('error', 10, 'coreBluetoothCode', 'int64', false),
  nativeProtocolField('error', 11, 'safeMetadata', 'strings', false),
  nativeProtocolField('restorationRecord', 1, 'recordVersion', 'uint64', true),
  nativeProtocolField('restorationRecord', 2, 'namespace', 'string', true),
  nativeProtocolField('restorationRecord', 3, 'attachment', 'record:attachment', true),
  nativeProtocolField('restorationRecord', 4, 'ordinal', 'uint64', true),
  nativeProtocolField('restorationRecord', 5, 'adoptionEpoch', 'string', true),
  nativeProtocolField('restorationRecord', 6, 'kind', 'enum:restorationKinds', true),
  nativeProtocolField('restorationRecord', 7, 'peerId', 'string', false),
  nativeProtocolField('restorationRecord', 8, 'connectionPath', 'record:connectionPath', false),
  nativeProtocolField('restorationRecord', 9, 'characteristicPath', 'record:characteristicPath', false),
  nativeProtocolField('restorationRecord', 10, 'subscriptionId', 'string', false),
  nativeProtocolField('restorationRecord', 11, 'event', 'record:event', false),
  nativeProtocolField('restorationAdoptionRequest', 1, 'namespace', 'string', true),
  nativeProtocolField('restorationAdoptionRequest', 2, 'attachmentId', 'string', true),
  nativeProtocolField('restorationAdoptionRequest', 3, 'expectedBackendInstanceId', 'string', true),
  nativeProtocolField('restorationAdoptionRequest', 4, 'expectedEpoch', 'string', true),
  nativeProtocolField('restorationAdoptionRequest', 5, 'nativeProtocolMinimum', 'uint64', true),
  nativeProtocolField('restorationAdoptionRequest', 6, 'nativeProtocolMaximum', 'uint64', true),
  nativeProtocolField('restorationAdoptionRequest', 7, 'clientId', 'string', true),
  nativeProtocolField('restorationAdoptionRequest', 8, 'hostSessionScope', 'string', true),
  nativeProtocolField('restorationAdoptionResult', 1, 'attachmentId', 'string', true),
  nativeProtocolField('restorationAdoptionResult', 2, 'receiptId', 'string', true),
  nativeProtocolField('restorationAdoptionResult', 3, 'namespace', 'string', true),
  nativeProtocolField('restorationAdoptionResult', 4, 'boundClientId', 'string', true),
  nativeProtocolField('restorationAdoptionResult', 5, 'adoptionEpoch', 'string', true),
  nativeProtocolField('restorationAdoptionResult', 6, 'outcome', 'enum:restorationOutcomes', true),
  nativeProtocolField('restorationAdoptionResult', 7, 'records', 'records:restorationRecord', true)
])
