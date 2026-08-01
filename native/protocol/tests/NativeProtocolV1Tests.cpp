// native/protocol/tests/NativeProtocolV1Tests.cpp

#include "../include/NativeProtocolV1Codec.hpp"
#include "../include/NativeProtocolControlRuntime.hpp"
#include "../include/NativeRestorationConfiguration.hpp"
#include "../include/NativeProtocolV1Registry.hpp"
#include "../include/OwnedBinaryPayloadStore.hpp"
#include "../include/BoundedNativeEventBuffer.hpp"
#include "../include/AndroidJsiEventIngressLedger.hpp"

#include <cassert>
#include <cstdint>
#include <functional>
#include <limits>
#include <memory>
#include <string>
#include <utility>
#include <vector>

namespace protocol = unified_ble::native_protocol::v1;

namespace {

protocol::ProtocolField field(std::uint16_t id, protocol::ProtocolFieldValue value) {
  return {.id = id, .value = std::move(value)};
}

protocol::ProtocolRecordReference attachment(const std::string& generation = "backend-generation-1") {
  return std::make_shared<protocol::ProtocolRecord>(protocol::ProtocolRecord{
      .kind = protocol::RecordKind::attachment,
      .fields = {
          field(1U, std::string("attachment-1")),
          field(2U, std::string("backend-1")),
          field(3U, generation),
          field(4U, std::string("adapter-1")),
          field(5U, std::string("adapter-generation-1")),
      },
  });
}

protocol::ProtocolRecordReference connection(
    const protocol::ProtocolRecordReference& attachmentValue = attachment()) {
  return std::make_shared<protocol::ProtocolRecord>(protocol::ProtocolRecord{
      .kind = protocol::RecordKind::connectionPath,
      .fields = {
          field(1U, attachmentValue),
          field(2U, std::string("peer-1")),
          field(3U, std::string("connection-1")),
          field(4U, std::string("lease-1")),
          field(5U, std::string("connection-generation-1")),
      },
  });
}

protocol::ProtocolRecordReference database(
    const protocol::ProtocolRecordReference& connectionValue = connection()) {
  return std::make_shared<protocol::ProtocolRecord>(protocol::ProtocolRecord{
      .kind = protocol::RecordKind::databasePath,
      .fields = {
          field(1U, connectionValue),
          field(2U, std::string("database-1")),
          field(3U, std::string("database-generation-1")),
      },
  });
}

protocol::ProtocolRecordReference characteristic(
    const std::string& occurrence,
    const protocol::ProtocolRecordReference& databaseValue = database()) {
  const auto service = std::make_shared<protocol::ProtocolRecord>(protocol::ProtocolRecord{
      .kind = protocol::RecordKind::servicePath,
      .fields = {
          field(1U, databaseValue),
          field(2U, std::string("0000180d-0000-1000-8000-00805f9b34fb")),
          field(3U, std::string("service-occurrence-1")),
      },
  });
  return std::make_shared<protocol::ProtocolRecord>(protocol::ProtocolRecord{
      .kind = protocol::RecordKind::characteristicPath,
      .fields = {
          field(1U, service),
          field(2U, std::string("00002a37-0000-1000-8000-00805f9b34fb")),
          field(3U, occurrence),
      },
  });
}

protocol::ProtocolRecordReference correlation(
    std::uint64_t epoch,
    const protocol::ProtocolRecordReference& attachmentValue = attachment()) {
  return std::make_shared<protocol::ProtocolRecord>(protocol::ProtocolRecord{
      .kind = protocol::RecordKind::operationCorrelation,
      .fields = {
          field(1U, attachmentValue),
          field(2U, epoch),
          field(3U, std::string("opaque-operation-") + std::to_string(epoch)),
      },
  });
}

protocol::ProtocolRecordReference binary(
    const std::string& token,
    std::uint64_t length,
    const std::string& operation = "opaque-operation-1") {
  return std::make_shared<protocol::ProtocolRecord>(protocol::ProtocolRecord{
      .kind = protocol::RecordKind::binaryReference,
      .fields = {
          field(1U, token),
          field(2U, std::uint64_t{0U}),
          field(3U, length),
          field(4U, std::string("nativeOwnedCopy")),
          field(5U, operation),
      },
  });
}

protocol::ProtocolRecord terminal(std::uint64_t epoch, const std::string& outcome, const std::string& cause = "") {
  std::vector<protocol::ProtocolField> fields{
      field(1U, correlation(epoch)),
      field(2U, outcome),
  };
  if (!cause.empty()) {
    fields.push_back(field(3U, cause));
  }
  return {.kind = protocol::RecordKind::terminal, .fields = std::move(fields)};
}

template <typename Integer>
void appendInteger(std::vector<std::uint8_t>& bytes, Integer value) {
  for (std::size_t byte = 0U; byte < sizeof(Integer); byte += 1U) {
    bytes.push_back(static_cast<std::uint8_t>((static_cast<std::uint64_t>(value) >> (byte * 8U)) & 0xFFU));
  }
}

std::vector<std::uint8_t> wrapNestedRecord(const std::vector<std::uint8_t>& nested) {
  std::vector<std::uint8_t> bytes{0x55U, 0x42U, 0x4EU, 0x31U};
  appendInteger(bytes, std::uint32_t{1U});
  appendInteger(bytes, std::uint16_t{1U});
  appendInteger(bytes, std::uint16_t{1U});
  appendInteger(bytes, std::uint16_t{1U});
  bytes.push_back(6U);
  appendInteger(bytes, static_cast<std::uint32_t>(nested.size()));
  bytes.insert(bytes.end(), nested.begin(), nested.end());
  return bytes;
}

protocol::ProtocolRecord restorationRecord() {
  return {
      .kind = protocol::RecordKind::restorationRecord,
      .fields = {
          field(1U, std::uint64_t{1U}),
          field(2U, std::string("approved.restoration")),
          field(3U, attachment()),
          field(4U, std::uint64_t{1U}),
          field(5U, std::string("restoration-epoch-1")),
          field(6U, std::string("connection")),
          field(7U, std::string("peer-1")),
          field(8U, connection()),
      },
  };
}

void expectFailure(protocol::ProtocolFailure expected, const std::function<void()>& action) {
  bool failed = false;
  try {
    action();
  } catch (const protocol::ProtocolException& error) {
    assert(error.failure() == expected);
    failed = true;
  }
  assert(failed);
}

void testVersionNegotiation() {
  const auto versions = protocol::NativeProtocolV1Codec::negotiate(
      {1U, 1U}, {1U, 1U}, {1U, 1U}, {1U, 1U}, {1U, 1U}, {1U, 1U});
  assert(versions.nativeProtocol == 1U);
  expectFailure(protocol::ProtocolFailure::incompatibleVersion, [] {
    static_cast<void>(protocol::NativeProtocolV1Codec::negotiate(
        {2U, 3U}, {1U, 1U}, {1U, 1U}, {1U, 1U}, {1U, 1U}, {1U, 1U}));
  });
}

void testPreJavaScriptEventBufferFailsClosedWithoutPartialReplay() {
  protocol::BoundedNativeEventBuffer buffer(2U, 4U);
  assert(buffer.enqueue({0x01U, 0x02U}));
  assert(buffer.enqueue({0x03U, 0x04U}));
  assert(buffer.recordCount() == 2U);
  assert(buffer.byteCount() == 4U);

  assert(!buffer.enqueue({0x05U}));
  assert(buffer.overflowed());
  assert(buffer.recordCount() == 0U);
  assert(buffer.byteCount() == 0U);
  assert(buffer.drain().empty());
  assert(buffer.overflowSnapshot().has_value());
  assert(buffer.overflowSnapshot()->retainedRecordCount == 2U);
  assert(buffer.overflowSnapshot()->retainedByteCount == 4U);
  assert(buffer.overflowSnapshot()->rejectedRecordByteCount == 1U);
  assert(buffer.overflowSnapshot()->droppedRecordCount == 3U);
  assert(buffer.overflowSnapshot()->droppedByteCount == 5U);
  assert(buffer.overflowSnapshot()->overflowCount == 1U);

  assert(!buffer.enqueue({0x06U}));
  assert(buffer.overflowed());
  assert(buffer.overflowSnapshot()->droppedRecordCount == 4U);
  assert(buffer.overflowSnapshot()->droppedByteCount == 6U);

  buffer.reset();
  assert(!buffer.overflowed());
  assert(buffer.enqueue({0x07U, 0x08U, 0x09U, 0x0AU}));
  const auto replay = buffer.drain();
  assert(replay.size() == 1U);
  assert(replay.front() == std::vector<std::uint8_t>({0x07U, 0x08U, 0x09U, 0x0AU}));
  assert(buffer.recordCount() == 0U);
  assert(buffer.byteCount() == 0U);
}

void testAndroidJsiIngressLedgerRetainsExactBinaryOwnershipCounters() {
  protocol::AndroidJsiEventIngressLedger ledger(2U, 4U);
  const auto reference = [](const std::string& owner) {
    return protocol::OwnedBinaryReference{
        .ownerToken = owner,
        .operationCorrelation = "android-ledger-test",
        .byteOffset = 0U,
        .byteLength = 1U,
        .ownership = "native-owned",
    };
  };
  assert(ledger.enqueue({{0x01U, 0x02U}, {reference("owner-1")}, 1U}));
  assert(ledger.enqueue({{0x03U, 0x04U}, {reference("owner-2")}, 1U}));
  assert(!ledger.enqueue({{0x05U}, {reference("owner-3")}, 1U}));
  assert(ledger.overflowed());
  assert(ledger.overflowSnapshot()->retainedRecordCount == 2U);
  assert(ledger.overflowSnapshot()->retainedByteCount == 4U);
  assert(ledger.overflowSnapshot()->rejectedRecordByteCount == 1U);
  assert(ledger.overflowSnapshot()->droppedRecordCount == 3U);
  assert(ledger.overflowSnapshot()->droppedByteCount == 5U);
  assert(ledger.overflowSnapshot()->overflowCount == 1U);
  assert(!ledger.enqueue({{0x06U}, {reference("owner-4")}, 1U}));
  assert(ledger.overflowSnapshot()->droppedRecordCount == 4U);
  assert(ledger.overflowSnapshot()->droppedByteCount == 6U);
  const auto discarded = ledger.takeAll();
  assert(discarded.size() == 4U);
  assert(discarded[0].binaryReferences.front().ownerToken == "owner-1");
  assert(discarded[1].binaryReferences.front().ownerToken == "owner-2");
  assert(discarded[2].binaryReferences.front().ownerToken == "owner-3");
  assert(discarded[3].binaryReferences.front().ownerToken == "owner-4");
}

void testAndroidJsiBinaryCleanupLedgerPreservesOverCapReferencesForFatalRetry() {
  protocol::AndroidJsiBinaryCleanupLedger ledger(2U);
  const auto reference = [](const std::string& owner) {
    return protocol::OwnedBinaryReference{
        .ownerToken = owner,
        .operationCorrelation = "android-cleanup-ledger-test",
        .byteOffset = 0U,
        .byteLength = 1U,
        .ownership = "native-owned",
    };
  };
  assert(ledger.retain({reference("owner-1"), reference("owner-2")}));
  assert(!ledger.overflowed());
  assert(!ledger.retain({reference("owner-3")}));
  assert(ledger.overflowed());
  assert(ledger.retryReferenceCount() == 2U);
  assert(ledger.fatalReferenceCount() == 1U);
  const auto retained = ledger.takeAll();
  assert(retained.size() == 3U);
  assert(retained[0].ownerToken == "owner-1");
  assert(retained[1].ownerToken == "owner-2");
  assert(retained[2].ownerToken == "owner-3");
  assert(!ledger.retain({reference("owner-4")}));
  assert(ledger.fatalReferenceCount() == 1U);
}

void testAndroidJsiTerminalSettlementWaitsForSinkAcceptance() {
  protocol::AndroidJsiEventIngressLedger ledger(2U, 16U);
  std::size_t settlements = 0U;
  const auto reference = protocol::OwnedBinaryReference{
      .ownerToken = "terminal-owner",
      .operationCorrelation = "terminal-operation",
      .byteOffset = 0U,
      .byteLength = 1U,
      .ownership = "native-owned",
  };
  assert(ledger.enqueue({
      {0x01U},
      {reference},
      1U,
      [&settlements] { settlements += 1U; },
  }));
  const auto sinkRejectedTerminal = ledger.takeNext();
  assert(sinkRejectedTerminal.has_value());
  // A throwing sink never invokes the post-delivery settlement callback. The
  // exact binary owner remains available to the fatal cleanup path instead.
  assert(settlements == 0U);
  assert(sinkRejectedTerminal->binaryReferences.front().ownerToken == "terminal-owner");

  assert(ledger.enqueue({
      {0x02U},
      {},
      1U,
      [&settlements] { settlements += 1U; },
  }));
  const auto acceptedTerminal = ledger.takeNext();
  assert(acceptedTerminal.has_value());
  acceptedTerminal->delivered();
  assert(settlements == 1U);
}

void testRoundTripAndAdversarialRecords() {
  protocol::NativeProtocolV1Codec codec;
  const protocol::ProtocolRecord command{
      .kind = protocol::RecordKind::command,
      .fields = {
          field(1U, std::uint64_t{1U}),
          field(2U, correlation(1U)),
          field(3U, std::string("write")),
          field(4U, characteristic("characteristic-occurrence-1")),
          field(6U, binary("binary-owner-1", 3U)),
          field(13U, std::string("withResponse")),
      },
  };
  const auto encoded = codec.encode(command);
  assert(encoded.size() > 12U);
  assert(encoded[0] == 0x55U && encoded[1] == 0x42U && encoded[2] == 0x4EU && encoded[3] == 0x31U);
  assert(codec.encode(codec.decode(encoded)) == encoded);

  const protocol::ProtocolRecord goldenAttachment{
      .kind = protocol::RecordKind::attachment,
      .fields = {
          field(1U, std::string("a")),
          field(2U, std::string("b")),
          field(3U, std::string("c")),
          field(4U, std::string("d")),
          field(5U, std::string("e")),
      },
  };
  const std::vector<std::uint8_t> goldenBytes{
      0x55U, 0x42U, 0x4EU, 0x31U, 0x01U, 0x00U, 0x00U, 0x00U, 0x01U, 0x00U, 0x05U, 0x00U,
      0x01U, 0x00U, 0x04U, 0x05U, 0x00U, 0x00U, 0x00U, 0x01U, 0x00U, 0x00U, 0x00U, 0x61U,
      0x02U, 0x00U, 0x04U, 0x05U, 0x00U, 0x00U, 0x00U, 0x01U, 0x00U, 0x00U, 0x00U, 0x62U,
      0x03U, 0x00U, 0x04U, 0x05U, 0x00U, 0x00U, 0x00U, 0x01U, 0x00U, 0x00U, 0x00U, 0x63U,
      0x04U, 0x00U, 0x04U, 0x05U, 0x00U, 0x00U, 0x00U, 0x01U, 0x00U, 0x00U, 0x00U, 0x64U,
      0x05U, 0x00U, 0x04U, 0x05U, 0x00U, 0x00U, 0x00U, 0x01U, 0x00U, 0x00U, 0x00U, 0x65U,
  };
  assert(codec.encode(goldenAttachment) == goldenBytes);

  auto truncated = encoded;
  truncated.pop_back();
  expectFailure(protocol::ProtocolFailure::malformedRecord, [&] {
    static_cast<void>(codec.decode(truncated));
  });
  auto wrongVersion = encoded;
  wrongVersion[4] = 2U;
  expectFailure(protocol::ProtocolFailure::incompatibleVersion, [&] {
    static_cast<void>(codec.decode(wrongVersion));
  });
  auto duplicate = command;
  duplicate.fields.push_back(field(3U, std::string("read")));
  expectFailure(protocol::ProtocolFailure::duplicateField, [&] { codec.validate(duplicate); });
  auto missing = command;
  missing.fields.erase(missing.fields.begin());
  expectFailure(protocol::ProtocolFailure::missingField, [&] { codec.validate(missing); });
  auto invalidEnum = command;
  invalidEnum.fields[2U] = field(3U, std::string("legacyNumericHandleRead"));
  expectFailure(protocol::ProtocolFailure::invalidEnumValue, [&] { codec.validate(invalidEnum); });
  auto incompatiblePayloadVersion = command;
  incompatiblePayloadVersion.fields[0U] = field(1U, std::uint64_t{2U});
  expectFailure(protocol::ProtocolFailure::incompatibleVersion, [&] {
    codec.validate(incompatiblePayloadVersion);
  });

  std::vector<std::uint8_t> nested{
      0x55U, 0x42U, 0x4EU, 0x31U, 0x01U, 0x00U, 0x00U, 0x00U, 0x01U, 0x00U, 0x00U, 0x00U,
  };
  for (std::size_t depth = 0U; depth < 18U; depth += 1U) {
    nested = wrapNestedRecord(nested);
  }
  expectFailure(protocol::ProtocolFailure::malformedRecord, [&] {
    static_cast<void>(codec.decode(nested));
  });

  const protocol::ProtocolRecord staleCommand{
      .kind = protocol::RecordKind::command,
      .fields = {
          field(1U, std::uint64_t{1U}),
          field(2U, correlation(2U)),
          field(3U, std::string("read")),
          field(
              4U,
              characteristic(
                  "characteristic-occurrence-1",
                  database(connection(attachment("stale-backend-generation"))))),
      },
  };
  expectFailure(protocol::ProtocolFailure::stalePath, [&] { codec.validate(staleCommand); });
  expectFailure(protocol::ProtocolFailure::malformedRecord, [&] {
    codec.validate(terminal(3U, "failed"));
  });

  const auto firstDuplicate = characteristic("characteristic-occurrence-1");
  const auto secondDuplicate = characteristic("characteristic-occurrence-2");
  assert(codec.encode(*firstDuplicate) != codec.encode(*secondDuplicate));
}

void testTerminalAndRichAdvertisementParity() {
  protocol::NativeProtocolV1Codec codec;
  const auto serviceData = std::make_shared<protocol::ProtocolRecord>(protocol::ProtocolRecord{
      .kind = protocol::RecordKind::serviceDataEntry,
      .fields = {
          field(1U, std::string("0000180d-0000-1000-8000-00805f9b34fb")),
          field(2U, binary("service-data", 4U)),
      },
  });
  const auto manufacturer = std::make_shared<protocol::ProtocolRecord>(protocol::ProtocolRecord{
      .kind = protocol::RecordKind::manufacturerDataEntry,
      .fields = {
          field(1U, std::uint64_t{76U}),
          field(2U, binary("manufacturer-data", 6U)),
      },
  });
  const protocol::ProtocolRecord advertisement{
      .kind = protocol::RecordKind::advertisement,
      .fields = {
          field(1U, std::string("peer-1")),
          field(2U, std::uint64_t{100U}),
          field(3U, std::uint64_t{7U}),
          field(4U, std::string("platform-raw")),
          field(5U, std::string("safe-local-name")),
          field(6U, std::int64_t{-55}),
          field(7U, std::int64_t{-4}),
          field(8U, true),
          field(9U, std::uint64_t{833U}),
          field(10U, protocol::ProtocolStringList{"service-a", "service-b"}),
          field(11U, protocol::ProtocolStringList{"solicited-a"}),
          field(12U, protocol::ProtocolStringList{"overflow-a"}),
          field(13U, protocol::ProtocolRecordList{serviceData}),
          field(14U, protocol::ProtocolRecordList{manufacturer}),
          field(15U, binary("raw-record", 20U)),
          field(16U, binary("scan-response", 10U)),
          field(17U, protocol::ProtocolStringList{"localName:observed", "rssi:observed", "txPower:derived"}),
      },
  };
  const auto encoded = codec.encode(advertisement);
  assert(codec.encode(codec.decode(encoded)) == encoded);

  const protocol::ProtocolRecord readResult{
      .kind = protocol::RecordKind::result,
      .fields = {
          field(1U, std::uint64_t{1U}),
          field(2U, std::string("read")),
          field(3U, std::make_shared<protocol::ProtocolRecord>(terminal(4U, "succeeded"))),
          field(5U, characteristic("read-result-occurrence")),
          field(6U, binary("read-result", 3U, "opaque-operation-4")),
      },
  };
  const protocol::ProtocolRecord unsubscribeResult{
      .kind = protocol::RecordKind::result,
      .fields = {
          field(1U, std::uint64_t{1U}),
          field(2U, std::string("unsubscribed")),
          field(3U, std::make_shared<protocol::ProtocolRecord>(terminal(5U, "succeeded"))),
          field(5U, characteristic("unsubscribe-result-occurrence")),
          field(7U, std::string("subscription-1")),
      },
  };
  codec.validate(readResult);
  codec.validate(unsubscribeResult);

  const protocol::ProtocolRecord nativeError{
      .kind = protocol::RecordKind::error,
      .fields = {
          field(1U, std::string("connectionFailed")),
          field(2U, std::string("radio")),
          field(3U, std::string("connect")),
          field(4U, std::string("notRetryable")),
          field(5U, std::string("android.bluetooth")),
          field(6U, std::string("133")),
          field(7U, std::string("Safe platform detail")),
          field(8U, std::int64_t{133}),
          field(9U, std::string("CBErrorDomain")),
          field(10U, std::int64_t{7}),
          field(11U, protocol::ProtocolStringList{"peer:redacted", "phase:connect"}),
      },
  };
  assert(codec.encode(codec.decode(codec.encode(nativeError))) == codec.encode(nativeError));
}

void testBinaryOwnership() {
  protocol::OwnedBinaryPayloadStore store(32U);
  std::vector<std::uint8_t> caller{1U, 2U, 3U, 4U};
  const auto reference = store.retainCopy(
      "opaque-operation-1",
      {.data = caller.data() + 1U, .size = 2U});
  caller[1] = 99U;
  assert(store.copy(reference) == std::vector<std::uint8_t>({2U, 3U}));
  auto delivered = store.copy(reference);
  delivered[0] = 88U;
  assert(store.copy(reference) == std::vector<std::uint8_t>({2U, 3U}));
  assert(store.take(reference) == std::vector<std::uint8_t>({2U, 3U}));
  expectFailure(protocol::ProtocolFailure::invalidCorrelation, [&] {
    static_cast<void>(store.take(reference));
  });
  assert(store.retainedBytes() == 0U);

  const auto releasedReference = store.retainCopy(
      "opaque-operation-1",
      {.data = caller.data() + 2U, .size = 2U});
  auto foreign = releasedReference;
  foreign.operationCorrelation = "opaque-operation-foreign";
  expectFailure(protocol::ProtocolFailure::invalidCorrelation, [&] {
    static_cast<void>(store.copy(foreign));
  });
  foreign = releasedReference;
  foreign.byteOffset = 1U;
  expectFailure(protocol::ProtocolFailure::invalidCorrelation, [&] {
    static_cast<void>(store.release(foreign));
  });
  assert(store.retainedBytes() == 2U);
  assert(store.release(releasedReference));
  assert(!store.release(releasedReference));
  assert(store.retainedBytes() == 0U);
  const auto empty = store.retainCopy("opaque-operation-2", {.data = nullptr, .size = 0U});
  assert(store.copy(empty).empty());
  expectFailure(protocol::ProtocolFailure::detachedPayload, [&] {
    static_cast<void>(store.retainCopy("opaque-operation-3", {.data = nullptr, .size = 1U}));
  });
  store.close();
  expectFailure(protocol::ProtocolFailure::alreadyTerminal, [&] {
    static_cast<void>(store.retainCopy("opaque-operation-4", {.data = nullptr, .size = 0U}));
  });
}

void testTypedAdapterStateEvent() {
  protocol::NativeProtocolV1Codec codec;
  const auto adapterState = std::make_shared<protocol::ProtocolRecord>(protocol::ProtocolRecord{
      .kind = protocol::RecordKind::adapterStateSnapshot,
      .fields = {
          field(1U, std::string("available")),
          field(2U, std::string("granted")),
          field(3U, std::string("on")),
      },
  });
  const protocol::ProtocolRecord event{
      .kind = protocol::RecordKind::event,
      .fields = {
          field(1U, std::uint64_t{1U}),
          field(2U, std::string("adapter-state-event-1")),
          field(3U, std::string("adapterState")),
          field(4U, attachment()),
          field(5U, std::uint64_t{1U}),
          field(6U, std::uint64_t{100U}),
          field(15U, adapterState),
      },
  };
  const auto encoded = codec.encode(event);
  assert(codec.encode(codec.decode(encoded)) == encoded);

  auto missingPayload = event;
  missingPayload.fields.pop_back();
  expectFailure(protocol::ProtocolFailure::missingField, [&] { codec.validate(missingPayload); });

  auto invalidAvailability = *adapterState;
  invalidAvailability.fields[0U] = field(1U, std::string("fabricated"));
  expectFailure(protocol::ProtocolFailure::invalidEnumValue, [&] { codec.validate(invalidAvailability); });
}

void testCancellationAndRestorationExactlyOnce() {
  const protocol::NativeAttachmentIdentity identity{
      .attachmentId = "attachment-1",
      .backendInstanceId = "backend-1",
      .backendGeneration = "backend-generation-1",
      .adapterId = "adapter-1",
      .adapterGeneration = "adapter-generation-1",
  };
  protocol::NativeOperationRegistry operations(identity, 4U);
  const protocol::NativeOperationIdentity first{
      .attachment = identity,
      .dispatchEpoch = 1U,
      .nonce = "opaque-1",
  };
  operations.registerOperation(first, true);
  assert(operations.cancel(first) == protocol::NativeCancellationState::cancellationRequested);
  assert(operations.settle(first, protocol::NativeOperationState::failed));
  assert(!operations.settle(first, protocol::NativeOperationState::succeeded));
  assert(operations.cancel(first) == protocol::NativeCancellationState::alreadyTerminal);
  assert(!operations.acceptsLateCallback(first));

  auto stale = first;
  stale.attachment.backendGeneration = "backend-generation-stale";
  expectFailure(protocol::ProtocolFailure::stalePath, [&] { static_cast<void>(operations.cancel(stale)); });

  protocol::NativeRestorationJournal journal(
      "approved.restoration",
      identity,
      "restoration-epoch-1",
      "client-1",
      "host-session-1",
      2U,
      protocol::kMaximumControlRecordBytes);
  journal.append(restorationRecord());
  const protocol::NativeRestorationAdoptionRequest request{
      .namespaceValue = "approved.restoration",
      .attachmentId = "attachment-1",
      .expectedBackendInstanceId = "backend-1",
      .expectedEpoch = "restoration-epoch-1",
      .nativeProtocolMinimum = 1U,
      .nativeProtocolMaximum = 1U,
      .clientId = "client-1",
      .hostSessionScope = "host-session-1",
  };
  auto unauthorized = request;
  unauthorized.clientId = "client-foreign";
  expectFailure(protocol::ProtocolFailure::stalePath, [&] { static_cast<void>(journal.adopt(unauthorized)); });
  assert(!journal.consumed());
  auto mismatch = request;
  mismatch.namespaceValue = "foreign.restoration";
  const auto mismatchReceipt = journal.adopt(mismatch);
  assert(mismatchReceipt.outcome == protocol::NativeRestorationOutcome::namespaceMismatch);
  assert(mismatchReceipt.adoptionEpoch == "restoration-epoch-1");
  assert(!journal.consumed());
  const auto receipt = journal.adopt(request);
  assert(!receipt.receiptId.empty());
  assert(receipt.outcome == protocol::NativeRestorationOutcome::adopted);
  assert(receipt.boundClientId == "client-1");
  assert(receipt.adoptionEpoch == "restoration-epoch-1");
  assert(receipt.records.size() == 1U);
  assert(journal.consumed());
  assert(journal.size() == 0U);
  const auto consumed = journal.adopt(request);
  assert(consumed.outcome == protocol::NativeRestorationOutcome::alreadyConsumed);
  assert(consumed.boundClientId == "client-1");
  assert(consumed.adoptionEpoch == "restoration-epoch-1");

  auto replacement = identity;
  replacement.backendGeneration = "backend-generation-2";
  operations.invalidate(replacement);
  expectFailure(protocol::ProtocolFailure::stalePath, [&] {
    operations.invalidate(replacement);
  });
}

void testNativeRestorationConfigurationRequiresEveryIdentityField() {
  const auto configured = [](const std::string& restoreIdentifier,
                             const std::string& namespaceValue,
                             const std::string& epoch,
                             const std::string& clientId,
                             const std::string& hostSessionScope) {
    return protocol::hasCompleteNativeRestorationConfiguration(
        restoreIdentifier, namespaceValue, epoch, clientId, hostSessionScope);
  };

  assert(configured(
      "com.example.ble",
      "com.example.restoration",
      "restoration-epoch-1",
      "client-1",
      "host-session-1"));
  assert(!configured(
      "",
      "com.example.restoration",
      "restoration-epoch-1",
      "client-1",
      "host-session-1"));
  assert(!configured("com.example.ble", "", "restoration-epoch-1", "client-1", "host-session-1"));
  assert(!configured("com.example.ble", "com.example.restoration", "", "client-1", "host-session-1"));
  assert(!configured(
      "com.example.ble",
      "com.example.restoration",
      "restoration-epoch-1",
      "",
      "host-session-1"));
  assert(!configured(
      "com.example.ble",
      "com.example.restoration",
      "restoration-epoch-1",
      "client-1",
      ""));
}

void testRestorationBootstrapRollbackSupportsHandshakeRetry() {
  const protocol::NativeAttachmentIdentity identity{
      .attachmentId = "attachment-rollback",
      .backendInstanceId = "backend-rollback",
      .backendGeneration = "backend-generation-rollback",
      .adapterId = "adapter-rollback",
      .adapterGeneration = "adapter-generation-rollback",
  };
  const protocol::NativeRestorationJournalAuthority authority{
      .namespaceValue = "approved.restoration.rollback",
      .attachment = identity,
      .adoptionEpoch = "restoration-epoch-rollback",
      .authorizedClientId = "client-rollback",
      .authorizedHostSessionScope = "host-session-rollback",
      .nativeProtocol = {.minimum = 1U, .maximum = 1U},
  };
  protocol::NativeProtocolControlRuntime runtime;
  const auto handshake = [&] {
    static_cast<void>(runtime.handshake(
        identity,
        "owner-rollback",
        {1U, 1U},
        {1U, 1U},
        {1U, 1U},
        {1U, 1U},
        {1U, 1U},
        {1U, 1U}));
  };

  handshake();
  auto firstRecord = restorationRecord();
  const auto rollbackAttachment = std::make_shared<protocol::ProtocolRecord>(protocol::ProtocolRecord{
      .kind = protocol::RecordKind::attachment,
      .fields = {
          field(1U, identity.attachmentId),
          field(2U, identity.backendInstanceId),
          field(3U, identity.backendGeneration),
          field(4U, identity.adapterId),
          field(5U, identity.adapterGeneration),
      },
  });
  firstRecord.fields[1U] = field(2U, authority.namespaceValue);
  firstRecord.fields[2U] = field(3U, rollbackAttachment);
  firstRecord.fields[4U] = field(5U, authority.adoptionEpoch);
  firstRecord.fields[7U] = field(8U, connection(rollbackAttachment));
  runtime.appendRestorationRecord(authority, firstRecord);
  expectFailure(protocol::ProtocolFailure::stalePath, [&] {
    runtime.appendRestorationRecord(authority, firstRecord);
  });
  assert(runtime.open());

  runtime.rollbackRestorationBootstrap(identity);
  runtime.rollbackRestorationBootstrap(identity);
  assert(!runtime.open());
  assert(runtime.retainedBinaryPayloads() == 0U);
  assert(runtime.retainedBinaryBytes() == 0U);

  handshake();
  runtime.appendRestorationRecord(authority, std::move(firstRecord));
  const auto receipt = runtime.adopt({
      .namespaceValue = authority.namespaceValue,
      .attachmentId = identity.attachmentId,
      .expectedBackendInstanceId = identity.backendInstanceId,
      .expectedEpoch = authority.adoptionEpoch,
      .nativeProtocolMinimum = 1U,
      .nativeProtocolMaximum = 1U,
      .clientId = authority.authorizedClientId,
      .hostSessionScope = authority.authorizedHostSessionScope,
  });
  assert(receipt.outcome == protocol::NativeRestorationOutcome::adopted);
  assert(receipt.records.size() == 1U);
  runtime.close(identity);
  assert(!runtime.open());
  assert(runtime.retainedBinaryPayloads() == 0U);
  assert(runtime.retainedBinaryBytes() == 0U);
}

void testOperationCapacityRejectsBeforeCommandBinaryCopyAndCallerRelease() {
  const protocol::NativeAttachmentIdentity identity{
      .attachmentId = "attachment-1",
      .backendInstanceId = "backend-1",
      .backendGeneration = "backend-generation-1",
      .adapterId = "adapter-1",
      .adapterGeneration = "adapter-generation-1",
  };
  protocol::NativeProtocolControlRuntime runtime;
  static_cast<void>(runtime.handshake(
      identity,
      "owner-1",
      {1U, 1U},
      {1U, 1U},
      {1U, 1U},
      {1U, 1U},
      {1U, 1U},
      {1U, 1U}));

  for (std::uint64_t epoch = 1U; epoch <= 1024U; epoch += 1U) {
    runtime.registerCommand(
        {.kind = protocol::RecordKind::command,
         .fields = {
             field(1U, std::uint64_t{1U}),
             field(2U, correlation(epoch)),
             field(3U, std::string("read")),
             field(4U, characteristic("characteristic-occurrence-1")),
         }},
        true);
  }

  const auto input = runtime.retainNativeBytes("opaque-operation-1025", {9U, 8U, 7U});
  expectFailure(protocol::ProtocolFailure::payloadTooLarge, [&] {
    runtime.registerCommand(
        {.kind = protocol::RecordKind::command,
         .fields = {
             field(1U, std::uint64_t{1U}),
             field(2U, correlation(1025U)),
             field(3U, std::string("write")),
             field(4U, characteristic("characteristic-occurrence-1")),
             field(6U, binary(input.ownerToken, input.byteLength, input.operationCorrelation)),
             field(13U, std::string("withResponse")),
         }},
        true);
  });
  assert(runtime.retainedBinaryPayloads() == 1U);
  assert(runtime.retainedBinaryBytes() == 3U);
  assert(runtime.releaseBinary(input));
  assert(runtime.retainedBinaryPayloads() == 0U);
  assert(runtime.retainedBinaryBytes() == 0U);
  runtime.close(identity);
}

void testRejectedAndroidDispatchReleasesRegisteredCommandBinary() {
  const protocol::NativeAttachmentIdentity identity{
      .attachmentId = "attachment-1",
      .backendInstanceId = "backend-1",
      .backendGeneration = "backend-generation-1",
      .adapterId = "adapter-1",
      .adapterGeneration = "adapter-generation-1",
  };
  protocol::NativeProtocolControlRuntime runtime;
  static_cast<void>(runtime.handshake(
      identity,
      "owner-1",
      {1U, 1U},
      {1U, 1U},
      {1U, 1U},
      {1U, 1U},
      {1U, 1U},
      {1U, 1U}));
  const auto input = runtime.retainNativeBytes("opaque-operation-1", {5U, 4U, 3U});
  const protocol::ProtocolRecord command{
      .kind = protocol::RecordKind::command,
      .fields = {
          field(1U, std::uint64_t{1U}),
          field(2U, correlation(1U)),
          field(3U, std::string("write")),
          field(4U, characteristic("characteristic-occurrence-1")),
          field(6U, binary(input.ownerToken, input.byteLength, input.operationCorrelation)),
          field(13U, std::string("withResponse")),
      },
  };
  runtime.registerCommand(command, true);
  assert(runtime.retainedBinaryPayloads() == 1U);
  assert(runtime.commandFor(1U, "opaque-operation-1").has_value());
  assert(runtime.rejectCommandDispatch(command));
  assert(!runtime.commandFor(1U, "opaque-operation-1").has_value());
  assert(runtime.retainedBinaryPayloads() == 0U);
  assert(runtime.retainedBinaryBytes() == 0U);
  assert(!runtime.rejectCommandDispatch(command));

  const protocol::ProtocolRecord scanCommand{
      .kind = protocol::RecordKind::command,
      .fields = {
          field(1U, std::uint64_t{1U}),
          field(2U, correlation(2U)),
          field(3U, std::string("scanStart")),
          field(12U, std::make_shared<protocol::ProtocolRecord>(protocol::ProtocolRecord{
              .kind = protocol::RecordKind::scanOptions,
              .fields = {
                  field(1U, protocol::ProtocolStringList{}),
                  field(2U, true),
                  field(3U, std::int64_t{2}),
                  field(4U, std::int64_t{1}),
                  field(5U, true),
              },
          })),
      },
  };
  runtime.registerCommand(scanCommand, true);
  assert(runtime.activeScanCommand().has_value());
  auto overlappingScanCommand = scanCommand;
  overlappingScanCommand.fields[1U] = field(2U, correlation(3U));
  expectFailure(protocol::ProtocolFailure::alreadyTerminal, [&] {
    runtime.registerCommand(overlappingScanCommand, true);
  });
  assert(runtime.activeScanCommand().has_value());
  assert(runtime.commandFor(2U, "opaque-operation-2").has_value());
  assert(!runtime.commandFor(3U, "opaque-operation-3").has_value());
  assert(runtime.rejectCommandDispatch(scanCommand));
  assert(!runtime.activeScanCommand().has_value());
  runtime.close(identity);
}

void testActiveScanOwnerReleasesOnlyAfterPhysicalTeardown() {
  const protocol::NativeAttachmentIdentity identity{
      .attachmentId = "attachment-1",
      .backendInstanceId = "backend-1",
      .backendGeneration = "backend-generation-1",
      .adapterId = "adapter-1",
      .adapterGeneration = "adapter-generation-1",
  };
  protocol::NativeProtocolControlRuntime runtime;
  static_cast<void>(runtime.handshake(
      identity, "owner-1", {1U, 1U}, {1U, 1U}, {1U, 1U}, {1U, 1U}, {1U, 1U}, {1U, 1U}));
  const auto scanCommand = [](std::uint64_t epoch, const std::string& kind) {
    std::vector<protocol::ProtocolField> fields{
        field(1U, std::uint64_t{1U}),
        field(2U, correlation(epoch)),
        field(3U, kind),
    };
    if (kind == "scanStart") {
      fields.push_back(field(12U, std::make_shared<protocol::ProtocolRecord>(protocol::ProtocolRecord{
          .kind = protocol::RecordKind::scanOptions,
          .fields = {
              field(1U, protocol::ProtocolStringList{}),
              field(2U, true),
              field(3U, std::int64_t{2}),
              field(4U, std::int64_t{1}),
              field(5U, true),
          },
      })));
    }
    return protocol::ProtocolRecord{
        .kind = protocol::RecordKind::command,
        .fields = std::move(fields),
    };
  };
  const auto result = [](std::uint64_t epoch, const std::string& kind, const std::string& outcome) {
    std::vector<protocol::ProtocolField> fields{
        field(1U, std::uint64_t{1U}),
        field(2U, kind),
        field(3U, std::make_shared<protocol::ProtocolRecord>(terminal(epoch, outcome, outcome == "failed" ? "cancelled" : ""))),
    };
    if (outcome == "failed") {
      fields.push_back(field(10U, std::make_shared<protocol::ProtocolRecord>(protocol::ProtocolRecord{
          .kind = protocol::RecordKind::error,
          .fields = {
              field(1U, std::string("cancelled")),
              field(2U, std::string("test")),
              field(3U, std::string("scanStart")),
              field(4U, std::string("notRetryable")),
              field(7U, std::string("Scan start cancellation is pending physical teardown")),
          },
      })));
    }
    return protocol::ProtocolRecord{
        .kind = protocol::RecordKind::result,
        .fields = std::move(fields),
    };
  };

  const auto firstStart = scanCommand(1U, "scanStart");
  runtime.registerCommand(firstStart, true);
  assert(runtime.settleResult(result(1U, "scanStarted", "succeeded")));
  assert(runtime.activeScanCommand().has_value());

  const auto firstStop = scanCommand(2U, "scanStop");
  runtime.registerCommand(firstStop, true);
  assert(runtime.settleResult(result(2U, "accepted", "succeeded")));
  assert(!runtime.activeScanCommand().has_value());

  const auto secondStart = scanCommand(3U, "scanStart");
  runtime.registerCommand(secondStart, true);
  assert(runtime.settleResult(result(3U, "scanStarted", "succeeded")));
  assert(runtime.activeScanCommand().has_value());

  const auto destroy = scanCommand(4U, "destroy");
  runtime.registerCommand(destroy, true);
  assert(runtime.settleResult(result(4U, "destroyed", "succeeded")));
  assert(!runtime.activeScanCommand().has_value());

  const auto cancelledStart = scanCommand(5U, "scanStart");
  runtime.registerCommand(cancelledStart, true);
  assert(runtime.settleResult(result(5U, "cancelled", "failed")));
  assert(runtime.activeScanCommand().has_value());
  expectFailure(protocol::ProtocolFailure::alreadyTerminal, [&] {
    runtime.registerCommand(scanCommand(6U, "scanStart"), true);
  });

  const auto cancellationTeardown = scanCommand(7U, "scanStop");
  runtime.registerCommand(cancellationTeardown, true);
  assert(runtime.settleResult(result(7U, "accepted", "succeeded")));
  assert(!runtime.activeScanCommand().has_value());
  runtime.registerCommand(scanCommand(8U, "scanStart"), true);
  assert(runtime.activeScanCommand().has_value());
  runtime.close(identity);
}

void testPendingSubscriptionRoutingAndLateOutputRelease() {
  const protocol::NativeAttachmentIdentity identity{
      .attachmentId = "attachment-1",
      .backendInstanceId = "backend-1",
      .backendGeneration = "backend-generation-1",
      .adapterId = "adapter-1",
      .adapterGeneration = "adapter-generation-1",
  };
  protocol::NativeProtocolControlRuntime runtime;
  static_cast<void>(runtime.handshake(
      identity, "owner-1", {1U, 1U}, {1U, 1U}, {1U, 1U}, {1U, 1U}, {1U, 1U}, {1U, 1U}));
  const protocol::ProtocolRecord command{
      .kind = protocol::RecordKind::command,
      .fields = {
          field(1U, std::uint64_t{1U}), field(2U, correlation(1U)), field(3U, std::string("subscribe")),
          field(4U, characteristic("pending-subscription")), field(7U, std::string("subscription-pending")),
      },
  };
  runtime.registerCommand(command, true);
  assert(runtime.pendingSubscriptionCommandFor("subscription-pending").has_value());
  assert(!runtime.subscriptionCommandFor("subscription-pending").has_value());

  const auto output = runtime.retainNativeBytes("apple-read:late", {1U, 2U, 3U});
  const protocol::ProtocolRecord result{
      .kind = protocol::RecordKind::result,
      .fields = {
          field(1U, std::uint64_t{1U}), field(2U, std::string("subscribed")),
          field(3U, std::make_shared<protocol::ProtocolRecord>(terminal(1U, "succeeded"))), field(5U, characteristic("pending-subscription")),
          field(7U, std::string("subscription-pending")),
      },
  };
  assert(runtime.settleResult(result));
  assert(!runtime.pendingSubscriptionCommandFor("subscription-pending").has_value());
  assert(runtime.subscriptionCommandFor("subscription-pending").has_value());
  assert(runtime.releaseBinary(output));
  assert(runtime.retainedBinaryPayloads() == 0U);
  assert(runtime.retainedBinaryBytes() == 0U);
  runtime.close(identity);
}

void testRuntimeRestorationAuthorityAppendAndAdoption() {
  const protocol::NativeAttachmentIdentity identity{
      .attachmentId = "attachment-1",
      .backendInstanceId = "backend-1",
      .backendGeneration = "backend-generation-1",
      .adapterId = "adapter-1",
      .adapterGeneration = "adapter-generation-1",
  };
  protocol::NativeProtocolControlRuntime runtime;
  static_cast<void>(runtime.handshake(
      identity,
      "owner-1",
      {1U, 1U},
      {1U, 1U},
      {1U, 1U},
      {1U, 1U},
      {1U, 1U},
      {1U, 1U}));

  const protocol::NativeRestorationJournalAuthority authority{
      .namespaceValue = "approved.restoration",
      .attachment = identity,
      .adoptionEpoch = "restoration-epoch-1",
      .authorizedClientId = "client-1",
      .authorizedHostSessionScope = "host-session-1",
      .nativeProtocol = {.minimum = 1U, .maximum = 1U},
  };
  runtime.appendRestorationRecord(authority, restorationRecord());

  auto duplicateOrdinal = restorationRecord();
  expectFailure(protocol::ProtocolFailure::stalePath, [&] {
    runtime.appendRestorationRecord(authority, std::move(duplicateOrdinal));
  });

  auto staleAuthority = authority;
  staleAuthority.attachment.backendGeneration = "backend-generation-stale";
  expectFailure(protocol::ProtocolFailure::stalePath, [&] {
    runtime.appendRestorationRecord(staleAuthority, restorationRecord());
  });

  const protocol::NativeRestorationAdoptionRequest request{
      .namespaceValue = "approved.restoration",
      .attachmentId = "attachment-1",
      .expectedBackendInstanceId = "backend-1",
      .expectedEpoch = "restoration-epoch-1",
      .nativeProtocolMinimum = 1U,
      .nativeProtocolMaximum = 1U,
      .clientId = "client-1",
      .hostSessionScope = "host-session-1",
  };
  auto mismatch = request;
  mismatch.expectedEpoch = "restoration-epoch-stale";
  assert(runtime.adopt(mismatch).outcome == protocol::NativeRestorationOutcome::epochMismatch);

  const auto receipt = runtime.adopt(request);
  assert(receipt.outcome == protocol::NativeRestorationOutcome::adopted);
  assert(receipt.records.size() == 1U);
  assert(receipt.records.front().ordinal == 1U);
  assert(runtime.adopt(request).outcome == protocol::NativeRestorationOutcome::alreadyConsumed);
  expectFailure(protocol::ProtocolFailure::restorationConsumed, [&] {
    runtime.appendRestorationRecord(authority, restorationRecord());
  });
  runtime.close(identity);
}

void testAndroidIngressOrdinalAllocatorExhaustsWithoutWrapOrReuse() {
  protocol::AndroidIngressOrdinalAllocator allocator(std::numeric_limits<std::uint64_t>::max() - 1U);
  assert(allocator.next() == std::numeric_limits<std::uint64_t>::max() - 1U);
  bool firstExhaustionThrew = false;
  try {
    static_cast<void>(allocator.next());
  } catch (const std::overflow_error&) {
    firstExhaustionThrew = true;
  }
  assert(firstExhaustionThrew);
  assert(allocator.exhausted());
  bool secondExhaustionThrew = false;
  try {
    static_cast<void>(allocator.next());
  } catch (const std::overflow_error&) {
    secondExhaustionThrew = true;
  }
  assert(secondExhaustionThrew);
}

} // namespace

int main() {
  testVersionNegotiation();
  testPreJavaScriptEventBufferFailsClosedWithoutPartialReplay();
  testAndroidJsiIngressLedgerRetainsExactBinaryOwnershipCounters();
  testAndroidJsiBinaryCleanupLedgerPreservesOverCapReferencesForFatalRetry();
  testAndroidJsiTerminalSettlementWaitsForSinkAcceptance();
  testRoundTripAndAdversarialRecords();
  testTerminalAndRichAdvertisementParity();
  testBinaryOwnership();
  testTypedAdapterStateEvent();
  testCancellationAndRestorationExactlyOnce();
  testNativeRestorationConfigurationRequiresEveryIdentityField();
  testRestorationBootstrapRollbackSupportsHandshakeRetry();
  testOperationCapacityRejectsBeforeCommandBinaryCopyAndCallerRelease();
  testRejectedAndroidDispatchReleasesRegisteredCommandBinary();
  testActiveScanOwnerReleasesOnlyAfterPhysicalTeardown();
  testPendingSubscriptionRoutingAndLateOutputRelease();
  testRuntimeRestorationAuthorityAppendAndAdoption();
  testAndroidIngressOrdinalAllocatorExhaustsWithoutWrapOrReuse();
  return 0;
}
