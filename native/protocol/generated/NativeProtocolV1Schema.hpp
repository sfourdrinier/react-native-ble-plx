// native/protocol/generated/NativeProtocolV1Schema.hpp

#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <string_view>

namespace unified_ble::native_protocol::v1 {

inline constexpr std::uint32_t kProtocolVersion = 1U;
inline constexpr std::uint32_t kAbiVersion = 1U;
inline constexpr std::size_t kMaximumControlRecordBytes = 262144U;
inline constexpr std::size_t kMaximumBinaryPayloadBytes = 524288U;

enum class RecordKind : std::uint16_t {
  attachment = 1U,
  connectionPath = 2U,
  databasePath = 3U,
  servicePath = 4U,
  characteristicPath = 5U,
  descriptorPath = 6U,
  operationCorrelation = 7U,
  binaryReference = 8U,
  serviceDataEntry = 9U,
  manufacturerDataEntry = 10U,
  scanOptions = 20U,
  adapterStateSnapshot = 23U,
  characteristicSnapshot = 22U,
  databaseSnapshot = 21U,
  command = 11U,
  terminal = 12U,
  result = 13U,
  advertisement = 14U,
  event = 15U,
  error = 16U,
  restorationRecord = 17U,
  restorationAdoptionRequest = 18U,
  restorationAdoptionResult = 19U
};

enum class CommandKinds : std::uint16_t {
  scanStart = 1U,
  scanStop = 2U,
  connect = 3U,
  disconnect = 4U,
  discover = 5U,
  read = 6U,
  write = 7U,
  subscribe = 8U,
  unsubscribe = 9U,
  cancel = 10U,
  adoptRestoration = 11U,
  destroy = 12U,
  readRssi = 13U,
  requestMtu = 14U,
  readDescriptor = 15U,
  writeDescriptor = 16U
};

enum class ResultKinds : std::uint16_t {
  accepted = 1U,
  scanStarted = 2U,
  connected = 3U,
  database = 4U,
  read = 5U,
  write = 6U,
  subscribed = 7U,
  unsubscribed = 8U,
  cancelled = 9U,
  restoration = 10U,
  destroyed = 11U,
  rssi = 12U,
  mtu = 13U,
  descriptorRead = 14U,
  descriptorWrite = 15U
};

enum class EventKinds : std::uint16_t {
  adapterState = 1U,
  advertisement = 2U,
  connectionLost = 3U,
  databaseChanged = 4U,
  notification = 5U,
  backendRestarted = 6U,
  restorationAvailable = 7U,
  diagnostic = 8U
};

enum class TerminalOutcomes : std::uint16_t {
  succeeded = 1U,
  failed = 2U
};

enum class CancellationStates : std::uint16_t {
  cancellationRequested = 1U,
  alreadyTerminal = 2U,
  notCancellable = 3U
};

enum class BinaryOwnership : std::uint16_t {
  nativeOwnedCopy = 1U,
  javascriptOwnedCopy = 2U,
  transferred = 3U
};

enum class WriteModes : std::uint16_t {
  withResponse = 1U,
  withoutResponse = 2U
};

enum class AdapterAvailability : std::uint16_t {
  available = 1U,
  unavailable = 2U,
  unsupported = 3U,
  unknown = 4U
};

enum class AdapterAuthorization : std::uint16_t {
  granted = 1U,
  denied = 2U,
  restricted = 3U,
  notDetermined = 4U,
  unavailable = 5U
};

enum class AdapterPower : std::uint16_t {
  on = 1U,
  off = 2U,
  resetting = 3U,
  unsupported = 4U,
  unknown = 5U
};

enum class RestorationKinds : std::uint16_t {
  adapter = 1U,
  connection = 2U,
  subscription = 3U,
  event = 4U
};

enum class RestorationOutcomes : std::uint16_t {
  adopted = 1U,
  alreadyConsumed = 2U,
  attachmentMismatch = 3U,
  backendMismatch = 4U,
  namespaceMismatch = 5U,
  epochMismatch = 6U
};

struct FieldDescriptor {
  RecordKind record;
  std::uint16_t fieldId;
  std::string_view name;
  std::string_view type;
  bool required;
};

struct EnumValueDescriptor {
  std::string_view type;
  std::string_view value;
};

struct RecordKindDescriptor {
  RecordKind kind;
  std::string_view name;
};

inline constexpr std::array<RecordKindDescriptor, 23> kRecordKindDescriptors{{
  RecordKindDescriptor{RecordKind::attachment, "attachment"},
  RecordKindDescriptor{RecordKind::connectionPath, "connectionPath"},
  RecordKindDescriptor{RecordKind::databasePath, "databasePath"},
  RecordKindDescriptor{RecordKind::servicePath, "servicePath"},
  RecordKindDescriptor{RecordKind::characteristicPath, "characteristicPath"},
  RecordKindDescriptor{RecordKind::descriptorPath, "descriptorPath"},
  RecordKindDescriptor{RecordKind::operationCorrelation, "operationCorrelation"},
  RecordKindDescriptor{RecordKind::binaryReference, "binaryReference"},
  RecordKindDescriptor{RecordKind::serviceDataEntry, "serviceDataEntry"},
  RecordKindDescriptor{RecordKind::manufacturerDataEntry, "manufacturerDataEntry"},
  RecordKindDescriptor{RecordKind::scanOptions, "scanOptions"},
  RecordKindDescriptor{RecordKind::adapterStateSnapshot, "adapterStateSnapshot"},
  RecordKindDescriptor{RecordKind::characteristicSnapshot, "characteristicSnapshot"},
  RecordKindDescriptor{RecordKind::databaseSnapshot, "databaseSnapshot"},
  RecordKindDescriptor{RecordKind::command, "command"},
  RecordKindDescriptor{RecordKind::terminal, "terminal"},
  RecordKindDescriptor{RecordKind::result, "result"},
  RecordKindDescriptor{RecordKind::advertisement, "advertisement"},
  RecordKindDescriptor{RecordKind::event, "event"},
  RecordKindDescriptor{RecordKind::error, "error"},
  RecordKindDescriptor{RecordKind::restorationRecord, "restorationRecord"},
  RecordKindDescriptor{RecordKind::restorationAdoptionRequest, "restorationAdoptionRequest"},
  RecordKindDescriptor{RecordKind::restorationAdoptionResult, "restorationAdoptionResult"}
}};

inline constexpr std::array<FieldDescriptor, 153> kFieldDescriptors{{
  FieldDescriptor{RecordKind::attachment, 1U, "attachmentId", "string", true},
  FieldDescriptor{RecordKind::attachment, 2U, "backendInstanceId", "string", true},
  FieldDescriptor{RecordKind::attachment, 3U, "backendGeneration", "string", true},
  FieldDescriptor{RecordKind::attachment, 4U, "adapterId", "string", true},
  FieldDescriptor{RecordKind::attachment, 5U, "adapterGeneration", "string", true},
  FieldDescriptor{RecordKind::connectionPath, 1U, "attachment", "record:attachment", true},
  FieldDescriptor{RecordKind::connectionPath, 2U, "peerId", "string", true},
  FieldDescriptor{RecordKind::connectionPath, 3U, "connectionId", "string", true},
  FieldDescriptor{RecordKind::connectionPath, 4U, "ownerLeaseId", "string", true},
  FieldDescriptor{RecordKind::connectionPath, 5U, "connectionGeneration", "string", true},
  FieldDescriptor{RecordKind::databasePath, 1U, "connection", "record:connectionPath", true},
  FieldDescriptor{RecordKind::databasePath, 2U, "databaseId", "string", true},
  FieldDescriptor{RecordKind::databasePath, 3U, "databaseGeneration", "string", true},
  FieldDescriptor{RecordKind::servicePath, 1U, "database", "record:databasePath", true},
  FieldDescriptor{RecordKind::servicePath, 2U, "serviceUuid", "string", true},
  FieldDescriptor{RecordKind::servicePath, 3U, "serviceOccurrence", "string", true},
  FieldDescriptor{RecordKind::characteristicPath, 1U, "service", "record:servicePath", true},
  FieldDescriptor{RecordKind::characteristicPath, 2U, "characteristicUuid", "string", true},
  FieldDescriptor{RecordKind::characteristicPath, 3U, "characteristicOccurrence", "string", true},
  FieldDescriptor{RecordKind::descriptorPath, 1U, "characteristic", "record:characteristicPath", true},
  FieldDescriptor{RecordKind::descriptorPath, 2U, "descriptorUuid", "string", true},
  FieldDescriptor{RecordKind::descriptorPath, 3U, "descriptorOccurrence", "string", true},
  FieldDescriptor{RecordKind::operationCorrelation, 1U, "attachment", "record:attachment", true},
  FieldDescriptor{RecordKind::operationCorrelation, 2U, "dispatchEpoch", "uint64", true},
  FieldDescriptor{RecordKind::operationCorrelation, 3U, "nonce", "string", true},
  FieldDescriptor{RecordKind::binaryReference, 1U, "ownerToken", "string", true},
  FieldDescriptor{RecordKind::binaryReference, 2U, "byteOffset", "uint64", true},
  FieldDescriptor{RecordKind::binaryReference, 3U, "byteLength", "uint64", true},
  FieldDescriptor{RecordKind::binaryReference, 4U, "ownership", "enum:binaryOwnership", true},
  FieldDescriptor{RecordKind::binaryReference, 5U, "operationCorrelation", "string", true},
  FieldDescriptor{RecordKind::serviceDataEntry, 1U, "serviceUuid", "string", true},
  FieldDescriptor{RecordKind::serviceDataEntry, 2U, "binary", "record:binaryReference", true},
  FieldDescriptor{RecordKind::manufacturerDataEntry, 1U, "companyIdentifier", "uint64", true},
  FieldDescriptor{RecordKind::manufacturerDataEntry, 2U, "binary", "record:binaryReference", true},
  FieldDescriptor{RecordKind::scanOptions, 1U, "serviceUuids", "strings", true},
  FieldDescriptor{RecordKind::scanOptions, 2U, "allowDuplicates", "boolean", true},
  FieldDescriptor{RecordKind::scanOptions, 3U, "scanMode", "int64", true},
  FieldDescriptor{RecordKind::scanOptions, 4U, "callbackType", "int64", true},
  FieldDescriptor{RecordKind::scanOptions, 5U, "legacyScan", "boolean", true},
  FieldDescriptor{RecordKind::adapterStateSnapshot, 1U, "availability", "enum:adapterAvailability", true},
  FieldDescriptor{RecordKind::adapterStateSnapshot, 2U, "authorization", "enum:adapterAuthorization", true},
  FieldDescriptor{RecordKind::adapterStateSnapshot, 3U, "power", "enum:adapterPower", true},
  FieldDescriptor{RecordKind::adapterStateSnapshot, 4U, "safeReason", "string", false},
  FieldDescriptor{RecordKind::characteristicSnapshot, 1U, "path", "record:characteristicPath", true},
  FieldDescriptor{RecordKind::characteristicSnapshot, 2U, "readable", "boolean", true},
  FieldDescriptor{RecordKind::characteristicSnapshot, 3U, "writableWithResponse", "boolean", true},
  FieldDescriptor{RecordKind::characteristicSnapshot, 4U, "writableWithoutResponse", "boolean", true},
  FieldDescriptor{RecordKind::characteristicSnapshot, 5U, "notifiable", "boolean", true},
  FieldDescriptor{RecordKind::databaseSnapshot, 1U, "databasePath", "record:databasePath", true},
  FieldDescriptor{RecordKind::databaseSnapshot, 2U, "services", "records:servicePath", true},
  FieldDescriptor{RecordKind::databaseSnapshot, 3U, "characteristics", "records:characteristicSnapshot", true},
  FieldDescriptor{RecordKind::databaseSnapshot, 4U, "descriptors", "records:descriptorPath", true},
  FieldDescriptor{RecordKind::command, 1U, "protocolVersion", "uint64", true},
  FieldDescriptor{RecordKind::command, 2U, "correlation", "record:operationCorrelation", true},
  FieldDescriptor{RecordKind::command, 3U, "kind", "enum:commandKinds", true},
  FieldDescriptor{RecordKind::command, 4U, "characteristicPath", "record:characteristicPath", false},
  FieldDescriptor{RecordKind::command, 5U, "descriptorPath", "record:descriptorPath", false},
  FieldDescriptor{RecordKind::command, 6U, "binary", "record:binaryReference", false},
  FieldDescriptor{RecordKind::command, 7U, "subscriptionId", "string", false},
  FieldDescriptor{RecordKind::command, 8U, "cancellationCorrelation", "record:operationCorrelation", false},
  FieldDescriptor{RecordKind::command, 9U, "restorationRequest", "record:restorationAdoptionRequest", false},
  FieldDescriptor{RecordKind::command, 10U, "connectionPath", "record:connectionPath", false},
  FieldDescriptor{RecordKind::command, 11U, "databasePath", "record:databasePath", false},
  FieldDescriptor{RecordKind::command, 12U, "scanOptions", "record:scanOptions", false},
  FieldDescriptor{RecordKind::command, 13U, "writeMode", "enum:writeModes", false},
  FieldDescriptor{RecordKind::command, 14U, "requestedMtu", "uint64", false},
  FieldDescriptor{RecordKind::terminal, 1U, "correlation", "record:operationCorrelation", true},
  FieldDescriptor{RecordKind::terminal, 2U, "outcome", "enum:terminalOutcomes", true},
  FieldDescriptor{RecordKind::terminal, 3U, "cause", "string", false},
  FieldDescriptor{RecordKind::result, 1U, "protocolVersion", "uint64", true},
  FieldDescriptor{RecordKind::result, 2U, "kind", "enum:resultKinds", true},
  FieldDescriptor{RecordKind::result, 3U, "terminal", "record:terminal", true},
  FieldDescriptor{RecordKind::result, 4U, "databasePath", "record:databasePath", false},
  FieldDescriptor{RecordKind::result, 5U, "characteristicPath", "record:characteristicPath", false},
  FieldDescriptor{RecordKind::result, 6U, "binary", "record:binaryReference", false},
  FieldDescriptor{RecordKind::result, 7U, "subscriptionId", "string", false},
  FieldDescriptor{RecordKind::result, 8U, "cancellationState", "enum:cancellationStates", false},
  FieldDescriptor{RecordKind::result, 9U, "restoration", "record:restorationAdoptionResult", false},
  FieldDescriptor{RecordKind::result, 10U, "error", "record:error", false},
  FieldDescriptor{RecordKind::result, 11U, "connectionPath", "record:connectionPath", false},
  FieldDescriptor{RecordKind::result, 12U, "databaseSnapshot", "record:databaseSnapshot", false},
  FieldDescriptor{RecordKind::result, 13U, "rssi", "int64", false},
  FieldDescriptor{RecordKind::result, 14U, "negotiatedMtu", "uint64", false},
  FieldDescriptor{RecordKind::result, 15U, "descriptorPath", "record:descriptorPath", false},
  FieldDescriptor{RecordKind::advertisement, 1U, "peerId", "string", true},
  FieldDescriptor{RecordKind::advertisement, 2U, "observedAt", "uint64", true},
  FieldDescriptor{RecordKind::advertisement, 3U, "ingressOrdinal", "uint64", true},
  FieldDescriptor{RecordKind::advertisement, 4U, "source", "string", true},
  FieldDescriptor{RecordKind::advertisement, 5U, "localName", "string", false},
  FieldDescriptor{RecordKind::advertisement, 6U, "rssi", "int64", false},
  FieldDescriptor{RecordKind::advertisement, 7U, "txPower", "int64", false},
  FieldDescriptor{RecordKind::advertisement, 8U, "connectable", "boolean", false},
  FieldDescriptor{RecordKind::advertisement, 9U, "appearance", "uint64", false},
  FieldDescriptor{RecordKind::advertisement, 10U, "serviceUuids", "strings", false},
  FieldDescriptor{RecordKind::advertisement, 11U, "solicitedServiceUuids", "strings", false},
  FieldDescriptor{RecordKind::advertisement, 12U, "overflowServiceUuids", "strings", false},
  FieldDescriptor{RecordKind::advertisement, 13U, "serviceData", "records:serviceDataEntry", false},
  FieldDescriptor{RecordKind::advertisement, 14U, "manufacturerData", "records:manufacturerDataEntry", false},
  FieldDescriptor{RecordKind::advertisement, 15U, "rawRecord", "record:binaryReference", false},
  FieldDescriptor{RecordKind::advertisement, 16U, "scanResponseRecord", "record:binaryReference", false},
  FieldDescriptor{RecordKind::advertisement, 17U, "fieldProvenance", "strings", true},
  FieldDescriptor{RecordKind::event, 1U, "protocolVersion", "uint64", true},
  FieldDescriptor{RecordKind::event, 2U, "eventId", "string", true},
  FieldDescriptor{RecordKind::event, 3U, "kind", "enum:eventKinds", true},
  FieldDescriptor{RecordKind::event, 4U, "attachment", "record:attachment", true},
  FieldDescriptor{RecordKind::event, 5U, "ingressOrdinal", "uint64", true},
  FieldDescriptor{RecordKind::event, 6U, "monotonicTimestamp", "uint64", true},
  FieldDescriptor{RecordKind::event, 7U, "connectionPath", "record:connectionPath", false},
  FieldDescriptor{RecordKind::event, 8U, "databasePath", "record:databasePath", false},
  FieldDescriptor{RecordKind::event, 9U, "characteristicPath", "record:characteristicPath", false},
  FieldDescriptor{RecordKind::event, 10U, "operationCorrelation", "record:operationCorrelation", false},
  FieldDescriptor{RecordKind::event, 11U, "subscriptionId", "string", false},
  FieldDescriptor{RecordKind::event, 12U, "advertisement", "record:advertisement", false},
  FieldDescriptor{RecordKind::event, 13U, "binary", "record:binaryReference", false},
  FieldDescriptor{RecordKind::event, 14U, "error", "record:error", false},
  FieldDescriptor{RecordKind::event, 15U, "adapterState", "record:adapterStateSnapshot", false},
  FieldDescriptor{RecordKind::error, 1U, "code", "string", true},
  FieldDescriptor{RecordKind::error, 2U, "domain", "string", true},
  FieldDescriptor{RecordKind::error, 3U, "operation", "string", true},
  FieldDescriptor{RecordKind::error, 4U, "retryability", "string", true},
  FieldDescriptor{RecordKind::error, 5U, "platformDomain", "string", false},
  FieldDescriptor{RecordKind::error, 6U, "platformCode", "string", false},
  FieldDescriptor{RecordKind::error, 7U, "safeMessage", "string", false},
  FieldDescriptor{RecordKind::error, 8U, "androidGattStatus", "int64", false},
  FieldDescriptor{RecordKind::error, 9U, "coreBluetoothDomain", "string", false},
  FieldDescriptor{RecordKind::error, 10U, "coreBluetoothCode", "int64", false},
  FieldDescriptor{RecordKind::error, 11U, "safeMetadata", "strings", false},
  FieldDescriptor{RecordKind::restorationRecord, 1U, "recordVersion", "uint64", true},
  FieldDescriptor{RecordKind::restorationRecord, 2U, "namespace", "string", true},
  FieldDescriptor{RecordKind::restorationRecord, 3U, "attachment", "record:attachment", true},
  FieldDescriptor{RecordKind::restorationRecord, 4U, "ordinal", "uint64", true},
  FieldDescriptor{RecordKind::restorationRecord, 5U, "adoptionEpoch", "string", true},
  FieldDescriptor{RecordKind::restorationRecord, 6U, "kind", "enum:restorationKinds", true},
  FieldDescriptor{RecordKind::restorationRecord, 7U, "peerId", "string", false},
  FieldDescriptor{RecordKind::restorationRecord, 8U, "connectionPath", "record:connectionPath", false},
  FieldDescriptor{RecordKind::restorationRecord, 9U, "characteristicPath", "record:characteristicPath", false},
  FieldDescriptor{RecordKind::restorationRecord, 10U, "subscriptionId", "string", false},
  FieldDescriptor{RecordKind::restorationRecord, 11U, "event", "record:event", false},
  FieldDescriptor{RecordKind::restorationAdoptionRequest, 1U, "namespace", "string", true},
  FieldDescriptor{RecordKind::restorationAdoptionRequest, 2U, "attachmentId", "string", true},
  FieldDescriptor{RecordKind::restorationAdoptionRequest, 3U, "expectedBackendInstanceId", "string", true},
  FieldDescriptor{RecordKind::restorationAdoptionRequest, 4U, "expectedEpoch", "string", true},
  FieldDescriptor{RecordKind::restorationAdoptionRequest, 5U, "nativeProtocolMinimum", "uint64", true},
  FieldDescriptor{RecordKind::restorationAdoptionRequest, 6U, "nativeProtocolMaximum", "uint64", true},
  FieldDescriptor{RecordKind::restorationAdoptionRequest, 7U, "clientId", "string", true},
  FieldDescriptor{RecordKind::restorationAdoptionRequest, 8U, "hostSessionScope", "string", true},
  FieldDescriptor{RecordKind::restorationAdoptionResult, 1U, "attachmentId", "string", true},
  FieldDescriptor{RecordKind::restorationAdoptionResult, 2U, "receiptId", "string", true},
  FieldDescriptor{RecordKind::restorationAdoptionResult, 3U, "namespace", "string", true},
  FieldDescriptor{RecordKind::restorationAdoptionResult, 4U, "boundClientId", "string", true},
  FieldDescriptor{RecordKind::restorationAdoptionResult, 5U, "adoptionEpoch", "string", true},
  FieldDescriptor{RecordKind::restorationAdoptionResult, 6U, "outcome", "enum:restorationOutcomes", true},
  FieldDescriptor{RecordKind::restorationAdoptionResult, 7U, "records", "records:restorationRecord", true}
}};

inline constexpr std::array<EnumValueDescriptor, 73> kEnumValueDescriptors{{
  EnumValueDescriptor{"commandKinds", "scanStart"},
  EnumValueDescriptor{"commandKinds", "scanStop"},
  EnumValueDescriptor{"commandKinds", "connect"},
  EnumValueDescriptor{"commandKinds", "disconnect"},
  EnumValueDescriptor{"commandKinds", "discover"},
  EnumValueDescriptor{"commandKinds", "read"},
  EnumValueDescriptor{"commandKinds", "write"},
  EnumValueDescriptor{"commandKinds", "subscribe"},
  EnumValueDescriptor{"commandKinds", "unsubscribe"},
  EnumValueDescriptor{"commandKinds", "cancel"},
  EnumValueDescriptor{"commandKinds", "adoptRestoration"},
  EnumValueDescriptor{"commandKinds", "destroy"},
  EnumValueDescriptor{"commandKinds", "readRssi"},
  EnumValueDescriptor{"commandKinds", "requestMtu"},
  EnumValueDescriptor{"commandKinds", "readDescriptor"},
  EnumValueDescriptor{"commandKinds", "writeDescriptor"},
  EnumValueDescriptor{"resultKinds", "accepted"},
  EnumValueDescriptor{"resultKinds", "scanStarted"},
  EnumValueDescriptor{"resultKinds", "connected"},
  EnumValueDescriptor{"resultKinds", "database"},
  EnumValueDescriptor{"resultKinds", "read"},
  EnumValueDescriptor{"resultKinds", "write"},
  EnumValueDescriptor{"resultKinds", "subscribed"},
  EnumValueDescriptor{"resultKinds", "unsubscribed"},
  EnumValueDescriptor{"resultKinds", "cancelled"},
  EnumValueDescriptor{"resultKinds", "restoration"},
  EnumValueDescriptor{"resultKinds", "destroyed"},
  EnumValueDescriptor{"resultKinds", "rssi"},
  EnumValueDescriptor{"resultKinds", "mtu"},
  EnumValueDescriptor{"resultKinds", "descriptorRead"},
  EnumValueDescriptor{"resultKinds", "descriptorWrite"},
  EnumValueDescriptor{"eventKinds", "adapterState"},
  EnumValueDescriptor{"eventKinds", "advertisement"},
  EnumValueDescriptor{"eventKinds", "connectionLost"},
  EnumValueDescriptor{"eventKinds", "databaseChanged"},
  EnumValueDescriptor{"eventKinds", "notification"},
  EnumValueDescriptor{"eventKinds", "backendRestarted"},
  EnumValueDescriptor{"eventKinds", "restorationAvailable"},
  EnumValueDescriptor{"eventKinds", "diagnostic"},
  EnumValueDescriptor{"terminalOutcomes", "succeeded"},
  EnumValueDescriptor{"terminalOutcomes", "failed"},
  EnumValueDescriptor{"cancellationStates", "cancellationRequested"},
  EnumValueDescriptor{"cancellationStates", "alreadyTerminal"},
  EnumValueDescriptor{"cancellationStates", "notCancellable"},
  EnumValueDescriptor{"binaryOwnership", "nativeOwnedCopy"},
  EnumValueDescriptor{"binaryOwnership", "javascriptOwnedCopy"},
  EnumValueDescriptor{"binaryOwnership", "transferred"},
  EnumValueDescriptor{"writeModes", "withResponse"},
  EnumValueDescriptor{"writeModes", "withoutResponse"},
  EnumValueDescriptor{"adapterAvailability", "available"},
  EnumValueDescriptor{"adapterAvailability", "unavailable"},
  EnumValueDescriptor{"adapterAvailability", "unsupported"},
  EnumValueDescriptor{"adapterAvailability", "unknown"},
  EnumValueDescriptor{"adapterAuthorization", "granted"},
  EnumValueDescriptor{"adapterAuthorization", "denied"},
  EnumValueDescriptor{"adapterAuthorization", "restricted"},
  EnumValueDescriptor{"adapterAuthorization", "notDetermined"},
  EnumValueDescriptor{"adapterAuthorization", "unavailable"},
  EnumValueDescriptor{"adapterPower", "on"},
  EnumValueDescriptor{"adapterPower", "off"},
  EnumValueDescriptor{"adapterPower", "resetting"},
  EnumValueDescriptor{"adapterPower", "unsupported"},
  EnumValueDescriptor{"adapterPower", "unknown"},
  EnumValueDescriptor{"restorationKinds", "adapter"},
  EnumValueDescriptor{"restorationKinds", "connection"},
  EnumValueDescriptor{"restorationKinds", "subscription"},
  EnumValueDescriptor{"restorationKinds", "event"},
  EnumValueDescriptor{"restorationOutcomes", "adopted"},
  EnumValueDescriptor{"restorationOutcomes", "alreadyConsumed"},
  EnumValueDescriptor{"restorationOutcomes", "attachmentMismatch"},
  EnumValueDescriptor{"restorationOutcomes", "backendMismatch"},
  EnumValueDescriptor{"restorationOutcomes", "namespaceMismatch"},
  EnumValueDescriptor{"restorationOutcomes", "epochMismatch"}
}};

} // namespace unified_ble::native_protocol::v1
