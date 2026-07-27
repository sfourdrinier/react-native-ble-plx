// ios/Generated/NativeProtocolV1Schema.swift

import Foundation

public let nativeProtocolVersion: UInt32 = 1
public let nativeProtocolABIVersion: UInt32 = 1
public let maximumControlRecordBytes: Int = 262144
public let maximumBinaryPayloadBytes: Int = 524288

public enum RecordKind: UInt16, CaseIterable, Sendable {
  case attachment = 1
  case connectionPath = 2
  case databasePath = 3
  case servicePath = 4
  case characteristicPath = 5
  case descriptorPath = 6
  case operationCorrelation = 7
  case binaryReference = 8
  case serviceDataEntry = 9
  case manufacturerDataEntry = 10
  case scanOptions = 20
  case adapterStateSnapshot = 23
  case characteristicSnapshot = 22
  case databaseSnapshot = 21
  case command = 11
  case terminal = 12
  case result = 13
  case advertisement = 14
  case event = 15
  case error = 16
  case restorationRecord = 17
  case restorationAdoptionRequest = 18
  case restorationAdoptionResult = 19
}

public enum CommandKinds: UInt16, CaseIterable, Sendable {
  case scanStart = 1
  case scanStop = 2
  case connect = 3
  case disconnect = 4
  case discover = 5
  case read = 6
  case write = 7
  case subscribe = 8
  case unsubscribe = 9
  case cancel = 10
  case adoptRestoration = 11
  case destroy = 12
  case readRssi = 13
  case requestMtu = 14
}

public enum ResultKinds: UInt16, CaseIterable, Sendable {
  case accepted = 1
  case scanStarted = 2
  case connected = 3
  case database = 4
  case read = 5
  case write = 6
  case subscribed = 7
  case unsubscribed = 8
  case cancelled = 9
  case restoration = 10
  case destroyed = 11
  case rssi = 12
  case mtu = 13
}

public enum EventKinds: UInt16, CaseIterable, Sendable {
  case adapterState = 1
  case advertisement = 2
  case connectionLost = 3
  case databaseChanged = 4
  case notification = 5
  case backendRestarted = 6
  case restorationAvailable = 7
  case diagnostic = 8
}

public enum TerminalOutcomes: UInt16, CaseIterable, Sendable {
  case succeeded = 1
  case failed = 2
}

public enum CancellationStates: UInt16, CaseIterable, Sendable {
  case cancellationRequested = 1
  case alreadyTerminal = 2
  case notCancellable = 3
}

public enum BinaryOwnership: UInt16, CaseIterable, Sendable {
  case nativeOwnedCopy = 1
  case javascriptOwnedCopy = 2
  case transferred = 3
}

public enum WriteModes: UInt16, CaseIterable, Sendable {
  case withResponse = 1
  case withoutResponse = 2
}

public enum AdapterAvailability: UInt16, CaseIterable, Sendable {
  case available = 1
  case unavailable = 2
  case unsupported = 3
  case unknown = 4
}

public enum AdapterAuthorization: UInt16, CaseIterable, Sendable {
  case granted = 1
  case denied = 2
  case restricted = 3
  case notDetermined = 4
  case unavailable = 5
}

public enum AdapterPower: UInt16, CaseIterable, Sendable {
  case on = 1
  case off = 2
  case resetting = 3
  case unsupported = 4
  case unknown = 5
}

public enum RestorationKinds: UInt16, CaseIterable, Sendable {
  case adapter = 1
  case connection = 2
  case subscription = 3
  case event = 4
}

public enum RestorationOutcomes: UInt16, CaseIterable, Sendable {
  case adopted = 1
  case alreadyConsumed = 2
  case attachmentMismatch = 3
  case backendMismatch = 4
  case namespaceMismatch = 5
  case epochMismatch = 6
}

public struct FieldDescriptor: Equatable, Sendable {
  public let record: RecordKind
  public let fieldID: UInt16
  public let name: String
  public let type: String
  public let required: Bool
}

public let nativeProtocolFields: [FieldDescriptor] = [
    FieldDescriptor(record: .attachment, fieldID: 1, name: "attachmentId", type: "string", required: true),
    FieldDescriptor(record: .attachment, fieldID: 2, name: "backendInstanceId", type: "string", required: true),
    FieldDescriptor(record: .attachment, fieldID: 3, name: "backendGeneration", type: "string", required: true),
    FieldDescriptor(record: .attachment, fieldID: 4, name: "adapterId", type: "string", required: true),
    FieldDescriptor(record: .attachment, fieldID: 5, name: "adapterGeneration", type: "string", required: true),
    FieldDescriptor(record: .connectionPath, fieldID: 1, name: "attachment", type: "record:attachment", required: true),
    FieldDescriptor(record: .connectionPath, fieldID: 2, name: "peerId", type: "string", required: true),
    FieldDescriptor(record: .connectionPath, fieldID: 3, name: "connectionId", type: "string", required: true),
    FieldDescriptor(record: .connectionPath, fieldID: 4, name: "ownerLeaseId", type: "string", required: true),
    FieldDescriptor(record: .connectionPath, fieldID: 5, name: "connectionGeneration", type: "string", required: true),
    FieldDescriptor(record: .databasePath, fieldID: 1, name: "connection", type: "record:connectionPath", required: true),
    FieldDescriptor(record: .databasePath, fieldID: 2, name: "databaseId", type: "string", required: true),
    FieldDescriptor(record: .databasePath, fieldID: 3, name: "databaseGeneration", type: "string", required: true),
    FieldDescriptor(record: .servicePath, fieldID: 1, name: "database", type: "record:databasePath", required: true),
    FieldDescriptor(record: .servicePath, fieldID: 2, name: "serviceUuid", type: "string", required: true),
    FieldDescriptor(record: .servicePath, fieldID: 3, name: "serviceOccurrence", type: "string", required: true),
    FieldDescriptor(record: .characteristicPath, fieldID: 1, name: "service", type: "record:servicePath", required: true),
    FieldDescriptor(record: .characteristicPath, fieldID: 2, name: "characteristicUuid", type: "string", required: true),
    FieldDescriptor(record: .characteristicPath, fieldID: 3, name: "characteristicOccurrence", type: "string", required: true),
    FieldDescriptor(record: .descriptorPath, fieldID: 1, name: "characteristic", type: "record:characteristicPath", required: true),
    FieldDescriptor(record: .descriptorPath, fieldID: 2, name: "descriptorUuid", type: "string", required: true),
    FieldDescriptor(record: .descriptorPath, fieldID: 3, name: "descriptorOccurrence", type: "string", required: true),
    FieldDescriptor(record: .operationCorrelation, fieldID: 1, name: "attachment", type: "record:attachment", required: true),
    FieldDescriptor(record: .operationCorrelation, fieldID: 2, name: "dispatchEpoch", type: "uint64", required: true),
    FieldDescriptor(record: .operationCorrelation, fieldID: 3, name: "nonce", type: "string", required: true),
    FieldDescriptor(record: .binaryReference, fieldID: 1, name: "ownerToken", type: "string", required: true),
    FieldDescriptor(record: .binaryReference, fieldID: 2, name: "byteOffset", type: "uint64", required: true),
    FieldDescriptor(record: .binaryReference, fieldID: 3, name: "byteLength", type: "uint64", required: true),
    FieldDescriptor(record: .binaryReference, fieldID: 4, name: "ownership", type: "enum:binaryOwnership", required: true),
    FieldDescriptor(record: .binaryReference, fieldID: 5, name: "operationCorrelation", type: "string", required: true),
    FieldDescriptor(record: .serviceDataEntry, fieldID: 1, name: "serviceUuid", type: "string", required: true),
    FieldDescriptor(record: .serviceDataEntry, fieldID: 2, name: "binary", type: "record:binaryReference", required: true),
    FieldDescriptor(record: .manufacturerDataEntry, fieldID: 1, name: "companyIdentifier", type: "uint64", required: true),
    FieldDescriptor(record: .manufacturerDataEntry, fieldID: 2, name: "binary", type: "record:binaryReference", required: true),
    FieldDescriptor(record: .scanOptions, fieldID: 1, name: "serviceUuids", type: "strings", required: true),
    FieldDescriptor(record: .scanOptions, fieldID: 2, name: "allowDuplicates", type: "boolean", required: true),
    FieldDescriptor(record: .scanOptions, fieldID: 3, name: "scanMode", type: "int64", required: true),
    FieldDescriptor(record: .scanOptions, fieldID: 4, name: "callbackType", type: "int64", required: true),
    FieldDescriptor(record: .scanOptions, fieldID: 5, name: "legacyScan", type: "boolean", required: true),
    FieldDescriptor(record: .adapterStateSnapshot, fieldID: 1, name: "availability", type: "enum:adapterAvailability", required: true),
    FieldDescriptor(record: .adapterStateSnapshot, fieldID: 2, name: "authorization", type: "enum:adapterAuthorization", required: true),
    FieldDescriptor(record: .adapterStateSnapshot, fieldID: 3, name: "power", type: "enum:adapterPower", required: true),
    FieldDescriptor(record: .adapterStateSnapshot, fieldID: 4, name: "safeReason", type: "string", required: false),
    FieldDescriptor(record: .characteristicSnapshot, fieldID: 1, name: "path", type: "record:characteristicPath", required: true),
    FieldDescriptor(record: .characteristicSnapshot, fieldID: 2, name: "readable", type: "boolean", required: true),
    FieldDescriptor(record: .characteristicSnapshot, fieldID: 3, name: "writableWithResponse", type: "boolean", required: true),
    FieldDescriptor(record: .characteristicSnapshot, fieldID: 4, name: "writableWithoutResponse", type: "boolean", required: true),
    FieldDescriptor(record: .characteristicSnapshot, fieldID: 5, name: "notifiable", type: "boolean", required: true),
    FieldDescriptor(record: .databaseSnapshot, fieldID: 1, name: "databasePath", type: "record:databasePath", required: true),
    FieldDescriptor(record: .databaseSnapshot, fieldID: 2, name: "services", type: "records:servicePath", required: true),
    FieldDescriptor(record: .databaseSnapshot, fieldID: 3, name: "characteristics", type: "records:characteristicSnapshot", required: true),
    FieldDescriptor(record: .databaseSnapshot, fieldID: 4, name: "descriptors", type: "records:descriptorPath", required: true),
    FieldDescriptor(record: .command, fieldID: 1, name: "protocolVersion", type: "uint64", required: true),
    FieldDescriptor(record: .command, fieldID: 2, name: "correlation", type: "record:operationCorrelation", required: true),
    FieldDescriptor(record: .command, fieldID: 3, name: "kind", type: "enum:commandKinds", required: true),
    FieldDescriptor(record: .command, fieldID: 4, name: "characteristicPath", type: "record:characteristicPath", required: false),
    FieldDescriptor(record: .command, fieldID: 5, name: "descriptorPath", type: "record:descriptorPath", required: false),
    FieldDescriptor(record: .command, fieldID: 6, name: "binary", type: "record:binaryReference", required: false),
    FieldDescriptor(record: .command, fieldID: 7, name: "subscriptionId", type: "string", required: false),
    FieldDescriptor(record: .command, fieldID: 8, name: "cancellationCorrelation", type: "record:operationCorrelation", required: false),
    FieldDescriptor(record: .command, fieldID: 9, name: "restorationRequest", type: "record:restorationAdoptionRequest", required: false),
    FieldDescriptor(record: .command, fieldID: 10, name: "connectionPath", type: "record:connectionPath", required: false),
    FieldDescriptor(record: .command, fieldID: 11, name: "databasePath", type: "record:databasePath", required: false),
    FieldDescriptor(record: .command, fieldID: 12, name: "scanOptions", type: "record:scanOptions", required: false),
    FieldDescriptor(record: .command, fieldID: 13, name: "writeMode", type: "enum:writeModes", required: false),
    FieldDescriptor(record: .command, fieldID: 14, name: "requestedMtu", type: "uint64", required: false),
    FieldDescriptor(record: .terminal, fieldID: 1, name: "correlation", type: "record:operationCorrelation", required: true),
    FieldDescriptor(record: .terminal, fieldID: 2, name: "outcome", type: "enum:terminalOutcomes", required: true),
    FieldDescriptor(record: .terminal, fieldID: 3, name: "cause", type: "string", required: false),
    FieldDescriptor(record: .result, fieldID: 1, name: "protocolVersion", type: "uint64", required: true),
    FieldDescriptor(record: .result, fieldID: 2, name: "kind", type: "enum:resultKinds", required: true),
    FieldDescriptor(record: .result, fieldID: 3, name: "terminal", type: "record:terminal", required: true),
    FieldDescriptor(record: .result, fieldID: 4, name: "databasePath", type: "record:databasePath", required: false),
    FieldDescriptor(record: .result, fieldID: 5, name: "characteristicPath", type: "record:characteristicPath", required: false),
    FieldDescriptor(record: .result, fieldID: 6, name: "binary", type: "record:binaryReference", required: false),
    FieldDescriptor(record: .result, fieldID: 7, name: "subscriptionId", type: "string", required: false),
    FieldDescriptor(record: .result, fieldID: 8, name: "cancellationState", type: "enum:cancellationStates", required: false),
    FieldDescriptor(record: .result, fieldID: 9, name: "restoration", type: "record:restorationAdoptionResult", required: false),
    FieldDescriptor(record: .result, fieldID: 10, name: "error", type: "record:error", required: false),
    FieldDescriptor(record: .result, fieldID: 11, name: "connectionPath", type: "record:connectionPath", required: false),
    FieldDescriptor(record: .result, fieldID: 12, name: "databaseSnapshot", type: "record:databaseSnapshot", required: false),
    FieldDescriptor(record: .result, fieldID: 13, name: "rssi", type: "int64", required: false),
    FieldDescriptor(record: .result, fieldID: 14, name: "negotiatedMtu", type: "uint64", required: false),
    FieldDescriptor(record: .advertisement, fieldID: 1, name: "peerId", type: "string", required: true),
    FieldDescriptor(record: .advertisement, fieldID: 2, name: "observedAt", type: "uint64", required: true),
    FieldDescriptor(record: .advertisement, fieldID: 3, name: "ingressOrdinal", type: "uint64", required: true),
    FieldDescriptor(record: .advertisement, fieldID: 4, name: "source", type: "string", required: true),
    FieldDescriptor(record: .advertisement, fieldID: 5, name: "localName", type: "string", required: false),
    FieldDescriptor(record: .advertisement, fieldID: 6, name: "rssi", type: "int64", required: false),
    FieldDescriptor(record: .advertisement, fieldID: 7, name: "txPower", type: "int64", required: false),
    FieldDescriptor(record: .advertisement, fieldID: 8, name: "connectable", type: "boolean", required: false),
    FieldDescriptor(record: .advertisement, fieldID: 9, name: "appearance", type: "uint64", required: false),
    FieldDescriptor(record: .advertisement, fieldID: 10, name: "serviceUuids", type: "strings", required: false),
    FieldDescriptor(record: .advertisement, fieldID: 11, name: "solicitedServiceUuids", type: "strings", required: false),
    FieldDescriptor(record: .advertisement, fieldID: 12, name: "overflowServiceUuids", type: "strings", required: false),
    FieldDescriptor(record: .advertisement, fieldID: 13, name: "serviceData", type: "records:serviceDataEntry", required: false),
    FieldDescriptor(record: .advertisement, fieldID: 14, name: "manufacturerData", type: "records:manufacturerDataEntry", required: false),
    FieldDescriptor(record: .advertisement, fieldID: 15, name: "rawRecord", type: "record:binaryReference", required: false),
    FieldDescriptor(record: .advertisement, fieldID: 16, name: "scanResponseRecord", type: "record:binaryReference", required: false),
    FieldDescriptor(record: .advertisement, fieldID: 17, name: "fieldProvenance", type: "strings", required: true),
    FieldDescriptor(record: .event, fieldID: 1, name: "protocolVersion", type: "uint64", required: true),
    FieldDescriptor(record: .event, fieldID: 2, name: "eventId", type: "string", required: true),
    FieldDescriptor(record: .event, fieldID: 3, name: "kind", type: "enum:eventKinds", required: true),
    FieldDescriptor(record: .event, fieldID: 4, name: "attachment", type: "record:attachment", required: true),
    FieldDescriptor(record: .event, fieldID: 5, name: "ingressOrdinal", type: "uint64", required: true),
    FieldDescriptor(record: .event, fieldID: 6, name: "monotonicTimestamp", type: "uint64", required: true),
    FieldDescriptor(record: .event, fieldID: 7, name: "connectionPath", type: "record:connectionPath", required: false),
    FieldDescriptor(record: .event, fieldID: 8, name: "databasePath", type: "record:databasePath", required: false),
    FieldDescriptor(record: .event, fieldID: 9, name: "characteristicPath", type: "record:characteristicPath", required: false),
    FieldDescriptor(record: .event, fieldID: 10, name: "operationCorrelation", type: "record:operationCorrelation", required: false),
    FieldDescriptor(record: .event, fieldID: 11, name: "subscriptionId", type: "string", required: false),
    FieldDescriptor(record: .event, fieldID: 12, name: "advertisement", type: "record:advertisement", required: false),
    FieldDescriptor(record: .event, fieldID: 13, name: "binary", type: "record:binaryReference", required: false),
    FieldDescriptor(record: .event, fieldID: 14, name: "error", type: "record:error", required: false),
    FieldDescriptor(record: .event, fieldID: 15, name: "adapterState", type: "record:adapterStateSnapshot", required: false),
    FieldDescriptor(record: .error, fieldID: 1, name: "code", type: "string", required: true),
    FieldDescriptor(record: .error, fieldID: 2, name: "domain", type: "string", required: true),
    FieldDescriptor(record: .error, fieldID: 3, name: "operation", type: "string", required: true),
    FieldDescriptor(record: .error, fieldID: 4, name: "retryability", type: "string", required: true),
    FieldDescriptor(record: .error, fieldID: 5, name: "platformDomain", type: "string", required: false),
    FieldDescriptor(record: .error, fieldID: 6, name: "platformCode", type: "string", required: false),
    FieldDescriptor(record: .error, fieldID: 7, name: "safeMessage", type: "string", required: false),
    FieldDescriptor(record: .error, fieldID: 8, name: "androidGattStatus", type: "int64", required: false),
    FieldDescriptor(record: .error, fieldID: 9, name: "coreBluetoothDomain", type: "string", required: false),
    FieldDescriptor(record: .error, fieldID: 10, name: "coreBluetoothCode", type: "int64", required: false),
    FieldDescriptor(record: .error, fieldID: 11, name: "safeMetadata", type: "strings", required: false),
    FieldDescriptor(record: .restorationRecord, fieldID: 1, name: "recordVersion", type: "uint64", required: true),
    FieldDescriptor(record: .restorationRecord, fieldID: 2, name: "namespace", type: "string", required: true),
    FieldDescriptor(record: .restorationRecord, fieldID: 3, name: "attachment", type: "record:attachment", required: true),
    FieldDescriptor(record: .restorationRecord, fieldID: 4, name: "ordinal", type: "uint64", required: true),
    FieldDescriptor(record: .restorationRecord, fieldID: 5, name: "adoptionEpoch", type: "string", required: true),
    FieldDescriptor(record: .restorationRecord, fieldID: 6, name: "kind", type: "enum:restorationKinds", required: true),
    FieldDescriptor(record: .restorationRecord, fieldID: 7, name: "peerId", type: "string", required: false),
    FieldDescriptor(record: .restorationRecord, fieldID: 8, name: "connectionPath", type: "record:connectionPath", required: false),
    FieldDescriptor(record: .restorationRecord, fieldID: 9, name: "characteristicPath", type: "record:characteristicPath", required: false),
    FieldDescriptor(record: .restorationRecord, fieldID: 10, name: "subscriptionId", type: "string", required: false),
    FieldDescriptor(record: .restorationRecord, fieldID: 11, name: "event", type: "record:event", required: false),
    FieldDescriptor(record: .restorationAdoptionRequest, fieldID: 1, name: "namespace", type: "string", required: true),
    FieldDescriptor(record: .restorationAdoptionRequest, fieldID: 2, name: "attachmentId", type: "string", required: true),
    FieldDescriptor(record: .restorationAdoptionRequest, fieldID: 3, name: "expectedBackendInstanceId", type: "string", required: true),
    FieldDescriptor(record: .restorationAdoptionRequest, fieldID: 4, name: "expectedEpoch", type: "string", required: true),
    FieldDescriptor(record: .restorationAdoptionRequest, fieldID: 5, name: "nativeProtocolMinimum", type: "uint64", required: true),
    FieldDescriptor(record: .restorationAdoptionRequest, fieldID: 6, name: "nativeProtocolMaximum", type: "uint64", required: true),
    FieldDescriptor(record: .restorationAdoptionRequest, fieldID: 7, name: "clientId", type: "string", required: true),
    FieldDescriptor(record: .restorationAdoptionRequest, fieldID: 8, name: "hostSessionScope", type: "string", required: true),
    FieldDescriptor(record: .restorationAdoptionResult, fieldID: 1, name: "attachmentId", type: "string", required: true),
    FieldDescriptor(record: .restorationAdoptionResult, fieldID: 2, name: "receiptId", type: "string", required: true),
    FieldDescriptor(record: .restorationAdoptionResult, fieldID: 3, name: "namespace", type: "string", required: true),
    FieldDescriptor(record: .restorationAdoptionResult, fieldID: 4, name: "boundClientId", type: "string", required: true),
    FieldDescriptor(record: .restorationAdoptionResult, fieldID: 5, name: "adoptionEpoch", type: "string", required: true),
    FieldDescriptor(record: .restorationAdoptionResult, fieldID: 6, name: "outcome", type: "enum:restorationOutcomes", required: true),
    FieldDescriptor(record: .restorationAdoptionResult, fieldID: 7, name: "records", type: "records:restorationRecord", required: true)
]
