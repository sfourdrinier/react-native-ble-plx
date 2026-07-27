// android/src/main/java/com/sfourdrinier/unifiedblemanager/protocol/generated/NativeProtocolV1Schema.kt

package com.sfourdrinier.unifiedblemanager.protocol.generated

const val NATIVE_PROTOCOL_VERSION: Int = 1
const val NATIVE_PROTOCOL_ABI_VERSION: Int = 1
const val MAXIMUM_CONTROL_RECORD_BYTES: Int = 262144
const val MAXIMUM_BINARY_PAYLOAD_BYTES: Int = 524288

enum class RecordKind(val wireValue: Int) {
  ATTACHMENT(1),
  CONNECTION_PATH(2),
  DATABASE_PATH(3),
  SERVICE_PATH(4),
  CHARACTERISTIC_PATH(5),
  DESCRIPTOR_PATH(6),
  OPERATION_CORRELATION(7),
  BINARY_REFERENCE(8),
  SERVICE_DATA_ENTRY(9),
  MANUFACTURER_DATA_ENTRY(10),
  SCAN_OPTIONS(20),
  ADAPTER_STATE_SNAPSHOT(23),
  CHARACTERISTIC_SNAPSHOT(22),
  DATABASE_SNAPSHOT(21),
  COMMAND(11),
  TERMINAL(12),
  RESULT(13),
  ADVERTISEMENT(14),
  EVENT(15),
  ERROR(16),
  RESTORATION_RECORD(17),
  RESTORATION_ADOPTION_REQUEST(18),
  RESTORATION_ADOPTION_RESULT(19)
}

enum class CommandKinds(val wireValue: Int) {
  SCAN_START(1),
  SCAN_STOP(2),
  CONNECT(3),
  DISCONNECT(4),
  DISCOVER(5),
  READ(6),
  WRITE(7),
  SUBSCRIBE(8),
  UNSUBSCRIBE(9),
  CANCEL(10),
  ADOPT_RESTORATION(11),
  DESTROY(12),
  READ_RSSI(13),
  REQUEST_MTU(14)
}

enum class ResultKinds(val wireValue: Int) {
  ACCEPTED(1),
  SCAN_STARTED(2),
  CONNECTED(3),
  DATABASE(4),
  READ(5),
  WRITE(6),
  SUBSCRIBED(7),
  UNSUBSCRIBED(8),
  CANCELLED(9),
  RESTORATION(10),
  DESTROYED(11),
  RSSI(12),
  MTU(13)
}

enum class EventKinds(val wireValue: Int) {
  ADAPTER_STATE(1),
  ADVERTISEMENT(2),
  CONNECTION_LOST(3),
  DATABASE_CHANGED(4),
  NOTIFICATION(5),
  BACKEND_RESTARTED(6),
  RESTORATION_AVAILABLE(7),
  DIAGNOSTIC(8)
}

enum class TerminalOutcomes(val wireValue: Int) {
  SUCCEEDED(1),
  FAILED(2)
}

enum class CancellationStates(val wireValue: Int) {
  CANCELLATION_REQUESTED(1),
  ALREADY_TERMINAL(2),
  NOT_CANCELLABLE(3)
}

enum class BinaryOwnership(val wireValue: Int) {
  NATIVE_OWNED_COPY(1),
  JAVASCRIPT_OWNED_COPY(2),
  TRANSFERRED(3)
}

enum class WriteModes(val wireValue: Int) {
  WITH_RESPONSE(1),
  WITHOUT_RESPONSE(2)
}

enum class AdapterAvailability(val wireValue: Int) {
  AVAILABLE(1),
  UNAVAILABLE(2),
  UNSUPPORTED(3),
  UNKNOWN(4)
}

enum class AdapterAuthorization(val wireValue: Int) {
  GRANTED(1),
  DENIED(2),
  RESTRICTED(3),
  NOT_DETERMINED(4),
  UNAVAILABLE(5)
}

enum class AdapterPower(val wireValue: Int) {
  ON(1),
  OFF(2),
  RESETTING(3),
  UNSUPPORTED(4),
  UNKNOWN(5)
}

enum class RestorationKinds(val wireValue: Int) {
  ADAPTER(1),
  CONNECTION(2),
  SUBSCRIPTION(3),
  EVENT(4)
}

enum class RestorationOutcomes(val wireValue: Int) {
  ADOPTED(1),
  ALREADY_CONSUMED(2),
  ATTACHMENT_MISMATCH(3),
  BACKEND_MISMATCH(4),
  NAMESPACE_MISMATCH(5),
  EPOCH_MISMATCH(6)
}

data class FieldDescriptor(
  val record: RecordKind,
  val fieldId: Int,
  val name: String,
  val type: String,
  val required: Boolean
)

val NATIVE_PROTOCOL_FIELDS: List<FieldDescriptor> = listOf(
    FieldDescriptor(RecordKind.ATTACHMENT, 1, "attachmentId", "string", true),
    FieldDescriptor(RecordKind.ATTACHMENT, 2, "backendInstanceId", "string", true),
    FieldDescriptor(RecordKind.ATTACHMENT, 3, "backendGeneration", "string", true),
    FieldDescriptor(RecordKind.ATTACHMENT, 4, "adapterId", "string", true),
    FieldDescriptor(RecordKind.ATTACHMENT, 5, "adapterGeneration", "string", true),
    FieldDescriptor(RecordKind.CONNECTION_PATH, 1, "attachment", "record:attachment", true),
    FieldDescriptor(RecordKind.CONNECTION_PATH, 2, "peerId", "string", true),
    FieldDescriptor(RecordKind.CONNECTION_PATH, 3, "connectionId", "string", true),
    FieldDescriptor(RecordKind.CONNECTION_PATH, 4, "ownerLeaseId", "string", true),
    FieldDescriptor(RecordKind.CONNECTION_PATH, 5, "connectionGeneration", "string", true),
    FieldDescriptor(RecordKind.DATABASE_PATH, 1, "connection", "record:connectionPath", true),
    FieldDescriptor(RecordKind.DATABASE_PATH, 2, "databaseId", "string", true),
    FieldDescriptor(RecordKind.DATABASE_PATH, 3, "databaseGeneration", "string", true),
    FieldDescriptor(RecordKind.SERVICE_PATH, 1, "database", "record:databasePath", true),
    FieldDescriptor(RecordKind.SERVICE_PATH, 2, "serviceUuid", "string", true),
    FieldDescriptor(RecordKind.SERVICE_PATH, 3, "serviceOccurrence", "string", true),
    FieldDescriptor(RecordKind.CHARACTERISTIC_PATH, 1, "service", "record:servicePath", true),
    FieldDescriptor(RecordKind.CHARACTERISTIC_PATH, 2, "characteristicUuid", "string", true),
    FieldDescriptor(RecordKind.CHARACTERISTIC_PATH, 3, "characteristicOccurrence", "string", true),
    FieldDescriptor(RecordKind.DESCRIPTOR_PATH, 1, "characteristic", "record:characteristicPath", true),
    FieldDescriptor(RecordKind.DESCRIPTOR_PATH, 2, "descriptorUuid", "string", true),
    FieldDescriptor(RecordKind.DESCRIPTOR_PATH, 3, "descriptorOccurrence", "string", true),
    FieldDescriptor(RecordKind.OPERATION_CORRELATION, 1, "attachment", "record:attachment", true),
    FieldDescriptor(RecordKind.OPERATION_CORRELATION, 2, "dispatchEpoch", "uint64", true),
    FieldDescriptor(RecordKind.OPERATION_CORRELATION, 3, "nonce", "string", true),
    FieldDescriptor(RecordKind.BINARY_REFERENCE, 1, "ownerToken", "string", true),
    FieldDescriptor(RecordKind.BINARY_REFERENCE, 2, "byteOffset", "uint64", true),
    FieldDescriptor(RecordKind.BINARY_REFERENCE, 3, "byteLength", "uint64", true),
    FieldDescriptor(RecordKind.BINARY_REFERENCE, 4, "ownership", "enum:binaryOwnership", true),
    FieldDescriptor(RecordKind.BINARY_REFERENCE, 5, "operationCorrelation", "string", true),
    FieldDescriptor(RecordKind.SERVICE_DATA_ENTRY, 1, "serviceUuid", "string", true),
    FieldDescriptor(RecordKind.SERVICE_DATA_ENTRY, 2, "binary", "record:binaryReference", true),
    FieldDescriptor(RecordKind.MANUFACTURER_DATA_ENTRY, 1, "companyIdentifier", "uint64", true),
    FieldDescriptor(RecordKind.MANUFACTURER_DATA_ENTRY, 2, "binary", "record:binaryReference", true),
    FieldDescriptor(RecordKind.SCAN_OPTIONS, 1, "serviceUuids", "strings", true),
    FieldDescriptor(RecordKind.SCAN_OPTIONS, 2, "allowDuplicates", "boolean", true),
    FieldDescriptor(RecordKind.SCAN_OPTIONS, 3, "scanMode", "int64", true),
    FieldDescriptor(RecordKind.SCAN_OPTIONS, 4, "callbackType", "int64", true),
    FieldDescriptor(RecordKind.SCAN_OPTIONS, 5, "legacyScan", "boolean", true),
    FieldDescriptor(RecordKind.ADAPTER_STATE_SNAPSHOT, 1, "availability", "enum:adapterAvailability", true),
    FieldDescriptor(RecordKind.ADAPTER_STATE_SNAPSHOT, 2, "authorization", "enum:adapterAuthorization", true),
    FieldDescriptor(RecordKind.ADAPTER_STATE_SNAPSHOT, 3, "power", "enum:adapterPower", true),
    FieldDescriptor(RecordKind.ADAPTER_STATE_SNAPSHOT, 4, "safeReason", "string", false),
    FieldDescriptor(RecordKind.CHARACTERISTIC_SNAPSHOT, 1, "path", "record:characteristicPath", true),
    FieldDescriptor(RecordKind.CHARACTERISTIC_SNAPSHOT, 2, "readable", "boolean", true),
    FieldDescriptor(RecordKind.CHARACTERISTIC_SNAPSHOT, 3, "writableWithResponse", "boolean", true),
    FieldDescriptor(RecordKind.CHARACTERISTIC_SNAPSHOT, 4, "writableWithoutResponse", "boolean", true),
    FieldDescriptor(RecordKind.CHARACTERISTIC_SNAPSHOT, 5, "notifiable", "boolean", true),
    FieldDescriptor(RecordKind.DATABASE_SNAPSHOT, 1, "databasePath", "record:databasePath", true),
    FieldDescriptor(RecordKind.DATABASE_SNAPSHOT, 2, "services", "records:servicePath", true),
    FieldDescriptor(RecordKind.DATABASE_SNAPSHOT, 3, "characteristics", "records:characteristicSnapshot", true),
    FieldDescriptor(RecordKind.DATABASE_SNAPSHOT, 4, "descriptors", "records:descriptorPath", true),
    FieldDescriptor(RecordKind.COMMAND, 1, "protocolVersion", "uint64", true),
    FieldDescriptor(RecordKind.COMMAND, 2, "correlation", "record:operationCorrelation", true),
    FieldDescriptor(RecordKind.COMMAND, 3, "kind", "enum:commandKinds", true),
    FieldDescriptor(RecordKind.COMMAND, 4, "characteristicPath", "record:characteristicPath", false),
    FieldDescriptor(RecordKind.COMMAND, 5, "descriptorPath", "record:descriptorPath", false),
    FieldDescriptor(RecordKind.COMMAND, 6, "binary", "record:binaryReference", false),
    FieldDescriptor(RecordKind.COMMAND, 7, "subscriptionId", "string", false),
    FieldDescriptor(RecordKind.COMMAND, 8, "cancellationCorrelation", "record:operationCorrelation", false),
    FieldDescriptor(RecordKind.COMMAND, 9, "restorationRequest", "record:restorationAdoptionRequest", false),
    FieldDescriptor(RecordKind.COMMAND, 10, "connectionPath", "record:connectionPath", false),
    FieldDescriptor(RecordKind.COMMAND, 11, "databasePath", "record:databasePath", false),
    FieldDescriptor(RecordKind.COMMAND, 12, "scanOptions", "record:scanOptions", false),
    FieldDescriptor(RecordKind.COMMAND, 13, "writeMode", "enum:writeModes", false),
    FieldDescriptor(RecordKind.COMMAND, 14, "requestedMtu", "uint64", false),
    FieldDescriptor(RecordKind.TERMINAL, 1, "correlation", "record:operationCorrelation", true),
    FieldDescriptor(RecordKind.TERMINAL, 2, "outcome", "enum:terminalOutcomes", true),
    FieldDescriptor(RecordKind.TERMINAL, 3, "cause", "string", false),
    FieldDescriptor(RecordKind.RESULT, 1, "protocolVersion", "uint64", true),
    FieldDescriptor(RecordKind.RESULT, 2, "kind", "enum:resultKinds", true),
    FieldDescriptor(RecordKind.RESULT, 3, "terminal", "record:terminal", true),
    FieldDescriptor(RecordKind.RESULT, 4, "databasePath", "record:databasePath", false),
    FieldDescriptor(RecordKind.RESULT, 5, "characteristicPath", "record:characteristicPath", false),
    FieldDescriptor(RecordKind.RESULT, 6, "binary", "record:binaryReference", false),
    FieldDescriptor(RecordKind.RESULT, 7, "subscriptionId", "string", false),
    FieldDescriptor(RecordKind.RESULT, 8, "cancellationState", "enum:cancellationStates", false),
    FieldDescriptor(RecordKind.RESULT, 9, "restoration", "record:restorationAdoptionResult", false),
    FieldDescriptor(RecordKind.RESULT, 10, "error", "record:error", false),
    FieldDescriptor(RecordKind.RESULT, 11, "connectionPath", "record:connectionPath", false),
    FieldDescriptor(RecordKind.RESULT, 12, "databaseSnapshot", "record:databaseSnapshot", false),
    FieldDescriptor(RecordKind.RESULT, 13, "rssi", "int64", false),
    FieldDescriptor(RecordKind.RESULT, 14, "negotiatedMtu", "uint64", false),
    FieldDescriptor(RecordKind.ADVERTISEMENT, 1, "peerId", "string", true),
    FieldDescriptor(RecordKind.ADVERTISEMENT, 2, "observedAt", "uint64", true),
    FieldDescriptor(RecordKind.ADVERTISEMENT, 3, "ingressOrdinal", "uint64", true),
    FieldDescriptor(RecordKind.ADVERTISEMENT, 4, "source", "string", true),
    FieldDescriptor(RecordKind.ADVERTISEMENT, 5, "localName", "string", false),
    FieldDescriptor(RecordKind.ADVERTISEMENT, 6, "rssi", "int64", false),
    FieldDescriptor(RecordKind.ADVERTISEMENT, 7, "txPower", "int64", false),
    FieldDescriptor(RecordKind.ADVERTISEMENT, 8, "connectable", "boolean", false),
    FieldDescriptor(RecordKind.ADVERTISEMENT, 9, "appearance", "uint64", false),
    FieldDescriptor(RecordKind.ADVERTISEMENT, 10, "serviceUuids", "strings", false),
    FieldDescriptor(RecordKind.ADVERTISEMENT, 11, "solicitedServiceUuids", "strings", false),
    FieldDescriptor(RecordKind.ADVERTISEMENT, 12, "overflowServiceUuids", "strings", false),
    FieldDescriptor(RecordKind.ADVERTISEMENT, 13, "serviceData", "records:serviceDataEntry", false),
    FieldDescriptor(RecordKind.ADVERTISEMENT, 14, "manufacturerData", "records:manufacturerDataEntry", false),
    FieldDescriptor(RecordKind.ADVERTISEMENT, 15, "rawRecord", "record:binaryReference", false),
    FieldDescriptor(RecordKind.ADVERTISEMENT, 16, "scanResponseRecord", "record:binaryReference", false),
    FieldDescriptor(RecordKind.ADVERTISEMENT, 17, "fieldProvenance", "strings", true),
    FieldDescriptor(RecordKind.EVENT, 1, "protocolVersion", "uint64", true),
    FieldDescriptor(RecordKind.EVENT, 2, "eventId", "string", true),
    FieldDescriptor(RecordKind.EVENT, 3, "kind", "enum:eventKinds", true),
    FieldDescriptor(RecordKind.EVENT, 4, "attachment", "record:attachment", true),
    FieldDescriptor(RecordKind.EVENT, 5, "ingressOrdinal", "uint64", true),
    FieldDescriptor(RecordKind.EVENT, 6, "monotonicTimestamp", "uint64", true),
    FieldDescriptor(RecordKind.EVENT, 7, "connectionPath", "record:connectionPath", false),
    FieldDescriptor(RecordKind.EVENT, 8, "databasePath", "record:databasePath", false),
    FieldDescriptor(RecordKind.EVENT, 9, "characteristicPath", "record:characteristicPath", false),
    FieldDescriptor(RecordKind.EVENT, 10, "operationCorrelation", "record:operationCorrelation", false),
    FieldDescriptor(RecordKind.EVENT, 11, "subscriptionId", "string", false),
    FieldDescriptor(RecordKind.EVENT, 12, "advertisement", "record:advertisement", false),
    FieldDescriptor(RecordKind.EVENT, 13, "binary", "record:binaryReference", false),
    FieldDescriptor(RecordKind.EVENT, 14, "error", "record:error", false),
    FieldDescriptor(RecordKind.EVENT, 15, "adapterState", "record:adapterStateSnapshot", false),
    FieldDescriptor(RecordKind.ERROR, 1, "code", "string", true),
    FieldDescriptor(RecordKind.ERROR, 2, "domain", "string", true),
    FieldDescriptor(RecordKind.ERROR, 3, "operation", "string", true),
    FieldDescriptor(RecordKind.ERROR, 4, "retryability", "string", true),
    FieldDescriptor(RecordKind.ERROR, 5, "platformDomain", "string", false),
    FieldDescriptor(RecordKind.ERROR, 6, "platformCode", "string", false),
    FieldDescriptor(RecordKind.ERROR, 7, "safeMessage", "string", false),
    FieldDescriptor(RecordKind.ERROR, 8, "androidGattStatus", "int64", false),
    FieldDescriptor(RecordKind.ERROR, 9, "coreBluetoothDomain", "string", false),
    FieldDescriptor(RecordKind.ERROR, 10, "coreBluetoothCode", "int64", false),
    FieldDescriptor(RecordKind.ERROR, 11, "safeMetadata", "strings", false),
    FieldDescriptor(RecordKind.RESTORATION_RECORD, 1, "recordVersion", "uint64", true),
    FieldDescriptor(RecordKind.RESTORATION_RECORD, 2, "namespace", "string", true),
    FieldDescriptor(RecordKind.RESTORATION_RECORD, 3, "attachment", "record:attachment", true),
    FieldDescriptor(RecordKind.RESTORATION_RECORD, 4, "ordinal", "uint64", true),
    FieldDescriptor(RecordKind.RESTORATION_RECORD, 5, "adoptionEpoch", "string", true),
    FieldDescriptor(RecordKind.RESTORATION_RECORD, 6, "kind", "enum:restorationKinds", true),
    FieldDescriptor(RecordKind.RESTORATION_RECORD, 7, "peerId", "string", false),
    FieldDescriptor(RecordKind.RESTORATION_RECORD, 8, "connectionPath", "record:connectionPath", false),
    FieldDescriptor(RecordKind.RESTORATION_RECORD, 9, "characteristicPath", "record:characteristicPath", false),
    FieldDescriptor(RecordKind.RESTORATION_RECORD, 10, "subscriptionId", "string", false),
    FieldDescriptor(RecordKind.RESTORATION_RECORD, 11, "event", "record:event", false),
    FieldDescriptor(RecordKind.RESTORATION_ADOPTION_REQUEST, 1, "namespace", "string", true),
    FieldDescriptor(RecordKind.RESTORATION_ADOPTION_REQUEST, 2, "attachmentId", "string", true),
    FieldDescriptor(RecordKind.RESTORATION_ADOPTION_REQUEST, 3, "expectedBackendInstanceId", "string", true),
    FieldDescriptor(RecordKind.RESTORATION_ADOPTION_REQUEST, 4, "expectedEpoch", "string", true),
    FieldDescriptor(RecordKind.RESTORATION_ADOPTION_REQUEST, 5, "nativeProtocolMinimum", "uint64", true),
    FieldDescriptor(RecordKind.RESTORATION_ADOPTION_REQUEST, 6, "nativeProtocolMaximum", "uint64", true),
    FieldDescriptor(RecordKind.RESTORATION_ADOPTION_REQUEST, 7, "clientId", "string", true),
    FieldDescriptor(RecordKind.RESTORATION_ADOPTION_REQUEST, 8, "hostSessionScope", "string", true),
    FieldDescriptor(RecordKind.RESTORATION_ADOPTION_RESULT, 1, "attachmentId", "string", true),
    FieldDescriptor(RecordKind.RESTORATION_ADOPTION_RESULT, 2, "receiptId", "string", true),
    FieldDescriptor(RecordKind.RESTORATION_ADOPTION_RESULT, 3, "namespace", "string", true),
    FieldDescriptor(RecordKind.RESTORATION_ADOPTION_RESULT, 4, "boundClientId", "string", true),
    FieldDescriptor(RecordKind.RESTORATION_ADOPTION_RESULT, 5, "adoptionEpoch", "string", true),
    FieldDescriptor(RecordKind.RESTORATION_ADOPTION_RESULT, 6, "outcome", "enum:restorationOutcomes", true),
    FieldDescriptor(RecordKind.RESTORATION_ADOPTION_RESULT, 7, "records", "records:restorationRecord", true)
)
