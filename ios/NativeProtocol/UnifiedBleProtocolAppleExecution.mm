// ios/NativeProtocol/UnifiedBleProtocolAppleExecution.mm

#import <Foundation/Foundation.h>
#import <CoreBluetooth/CoreBluetooth.h>
#import <ReactCommon/CallInvoker.h>

#if __has_include("BlePlx-Swift.h")
#import "BlePlx-Swift.h"
#endif

#include "UnifiedBleProtocolAppleExecution.hpp"
#include "UnifiedBleProtocolAppleBinaryDelivery.hpp"
#include "UnifiedBleProtocolAppleExecutionState.hpp"
#include "UnifiedBleProtocolAppleExecutionSupport.hpp"

#include <jsi/jsi.h>

#include <atomic>
#include <chrono>
#include <cstring>
#include <functional>
#include <iterator>
#include <limits>
#include <memory>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace jsi = facebook::jsi;
namespace protocol = unified_ble::native_protocol::v1;

namespace {

constexpr const char* kRuntimeName = "__unifiedBleNativeProtocolV1";

protocol::ProtocolField field(std::uint16_t id, protocol::ProtocolFieldValue value) {
  return {.id = id, .value = std::move(value)};
}

protocol::ProtocolRecordReference reference(const protocol::ProtocolRecord& record) {
  return std::make_shared<protocol::ProtocolRecord>(record);
}

const protocol::ProtocolField* findField(const protocol::ProtocolRecord& record, std::uint16_t id) {
  for (const auto& candidate : record.fields) {
    if (candidate.id == id) {
      return &candidate;
    }
  }
  return nullptr;
}

const protocol::ProtocolRecord& requiredRecord(const protocol::ProtocolRecord& record, std::uint16_t id) {
  const auto* candidate = findField(record, id);
  const auto* value = candidate == nullptr ? nullptr : std::get_if<protocol::ProtocolRecordReference>(&candidate->value);
  if (value == nullptr || !*value) {
    throw protocol::ProtocolException(protocol::ProtocolFailure::malformedRecord, "Apple native protocol record field is missing");
  }
  return **value;
}

const std::string& requiredString(const protocol::ProtocolRecord& record, std::uint16_t id) {
  const auto* candidate = findField(record, id);
  const auto* value = candidate == nullptr ? nullptr : std::get_if<std::string>(&candidate->value);
  if (value == nullptr || value->empty()) {
    throw protocol::ProtocolException(protocol::ProtocolFailure::malformedRecord, "Apple native protocol string field is missing");
  }
  return *value;
}

bool requiredBoolean(const protocol::ProtocolRecord& record, std::uint16_t id) {
  const auto* candidate = findField(record, id);
  const auto* value = candidate == nullptr ? nullptr : std::get_if<bool>(&candidate->value);
  if (value == nullptr) {
    throw protocol::ProtocolException(protocol::ProtocolFailure::malformedRecord, "Apple native protocol boolean field is missing");
  }
  return *value;
}

const protocol::ProtocolStringList& requiredStringList(const protocol::ProtocolRecord& record, std::uint16_t id) {
  const auto* candidate = findField(record, id);
  const auto* value = candidate == nullptr ? nullptr : std::get_if<protocol::ProtocolStringList>(&candidate->value);
  if (value == nullptr) {
    throw protocol::ProtocolException(protocol::ProtocolFailure::malformedRecord, "Apple native protocol string list field is missing");
  }
  return *value;
}

protocol::ProtocolRecord attachmentRecord(const protocol::NativeAttachmentIdentity& attachment) {
  return {
      .kind = protocol::RecordKind::attachment,
      .fields = {
          field(1U, attachment.attachmentId),
          field(2U, attachment.backendInstanceId),
          field(3U, attachment.backendGeneration),
          field(4U, attachment.adapterId),
          field(5U, attachment.adapterGeneration),
      },
  };
}

protocol::ProtocolRecord terminal(
    const protocol::ProtocolRecord& command,
    const std::string& outcome,
    const std::optional<std::string>& cause = std::nullopt) {
  std::vector<protocol::ProtocolField> fields{
      field(1U, reference(requiredRecord(command, 2U))),
      field(2U, outcome),
  };
  if (cause && !cause->empty()) {
    fields.push_back(field(3U, *cause));
  }
  return {.kind = protocol::RecordKind::terminal, .fields = std::move(fields)};
}

std::string resultKindFor(const std::string& commandKind) {
  if (commandKind == "scanStart") return "scanStarted";
  if (commandKind == "connect") return "connected";
  if (commandKind == "discover") return "database";
  if (commandKind == "read") return "read";
  if (commandKind == "readRssi") return "rssi";
  if (commandKind == "requestMtu") return "mtu";
  if (commandKind == "readDescriptor") return "descriptorRead";
  if (commandKind == "writeDescriptor") return "descriptorWrite";
  if (commandKind == "write") return "write";
  if (commandKind == "subscribe") return "subscribed";
  if (commandKind == "unsubscribe") return "unsubscribed";
  if (commandKind == "destroy") return "destroyed";
  return "accepted";
}

std::uint64_t monotonicMilliseconds() {
  const auto duration = std::chrono::steady_clock::now().time_since_epoch();
  const auto count = std::chrono::duration_cast<std::chrono::milliseconds>(duration).count();
  if (count < 0) {
    throw protocol::ProtocolException(protocol::ProtocolFailure::malformedRecord, "Apple monotonic clock is negative");
  }
  return static_cast<std::uint64_t>(count);
}

std::string nsString(NSString* value, const char* name) {
  if (value == nil || value.length == 0U) {
    throw protocol::ProtocolException(protocol::ProtocolFailure::malformedRecord, std::string("Apple native ") + name + " is missing");
  }
  const char* utf8 = value.UTF8String;
  if (utf8 == nullptr) {
    throw protocol::ProtocolException(protocol::ProtocolFailure::detachedPayload, std::string("Apple native ") + name + " is unavailable");
  }
  return utf8;
}

std::string errorMessage(NSError* error) {
  if (error == nil) return "Apple native operation failed";
  const auto description = error.localizedDescription;
  return description == nil ? "Apple native operation failed" : nsString(description, "error message");
}

void logNativeFailure(const char* context, const std::exception& error) {
  NSLog(@"[UnifiedBleProtocolAppleExecution] %s: %s", context, error.what());
}

} // namespace

@class OwnedCoreBluetoothProtocolRadio;

namespace unified_ble::apple_protocol {

AppleNativeProtocolExecution::State::State(
    std::shared_ptr<protocol::NativeProtocolControlRuntime> runtimeValue,
    void* radioValue)
    : runtime(std::move(runtimeValue)), radio(radioValue) {}

AppleNativeProtocolExecution::State::~State() = default;

namespace {

OwnedCoreBluetoothProtocolRadio* radioFor(const std::shared_ptr<AppleNativeProtocolExecution::State>& state) {
  return (__bridge OwnedCoreBluetoothProtocolRadio*)state->radio;
}

bool boundedBufferCanAdmit(
    const protocol::BoundedNativeEventBuffer& buffer,
    std::size_t recordBytes,
    std::size_t maximumRecords,
    std::size_t maximumBytes) {
  return !buffer.overflowed() &&
      buffer.recordCount() < maximumRecords &&
      recordBytes <= maximumBytes - buffer.byteCount();
}

void retainBinaryCleanupFailures(
    const std::shared_ptr<AppleNativeProtocolExecution::State>& state,
    const BinaryReferenceList& failures,
    const char* context) {
  if (failures.empty()) return;
  if (!state->binaryCleanupLedger.append(failures)) {
    throw std::logic_error(std::string("Apple binary cleanup ledger capacity exhausted: ") + context);
  }
}

void retryBinaryCleanupLedger(
    const std::shared_ptr<AppleNativeProtocolExecution::State>& state,
    const char* context) {
  const auto retry = state->binaryCleanupLedger.retry([&](const protocol::OwnedBinaryReference& reference) {
    try {
      if (!state->runtime->releaseBinary(reference)) {
        NSLog(@"[UnifiedBleProtocolAppleExecution] %s: cleanup reference was already released", context);
      }
      return true;
    } catch (const std::exception& error) {
      NSLog(@"[UnifiedBleProtocolAppleExecution] %s: %s", context, error.what());
      throw;
    } catch (...) {
      NSLog(@"[UnifiedBleProtocolAppleExecution] %s: cleanup release failed with an unknown exception", context);
      throw;
    }
  });
  if (retry.failed != 0U) {
    NSLog(
        @"[UnifiedBleProtocolAppleExecution] %s: %lu binary cleanup references remain retryable",
        context,
        static_cast<unsigned long>(retry.failed));
  }
}

void releaseAndLedgerBinaryReferences(
    const std::shared_ptr<AppleNativeProtocolExecution::State>& state,
    const BinaryReferenceList& references,
    const char* context) {
  const auto status = releaseBinaryReferences(state->runtime, references, context);
  retainBinaryCleanupFailures(state, status.failedReferences, context);
}

void quarantineLateCompletion(
    const std::shared_ptr<AppleNativeProtocolExecution::State>& state,
    const protocol::ProtocolRecord& result) {
  try {
    const auto& terminal = requiredRecord(result, 3U);
    const auto& correlation = requiredRecord(terminal, 1U);
    NSLog(
        @"[UnifiedBleProtocolAppleExecution] late native completion quarantined nonce=%s",
        requiredString(correlation, 3U).c_str());
  } catch (const std::exception& error) {
    logNativeFailure("late native completion quarantine", error);
  }
  static_cast<void>(state);
}

void releaseQueuedBinaryReferences(
    const std::shared_ptr<AppleNativeProtocolExecution::State>& state,
    std::vector<BinaryReferenceList>& references,
    const char* context) {
  BinaryReferenceList failures;
  for (const auto& recordReferences : references) {
    const auto status = releaseBinaryReferences(state->runtime, recordReferences, context);
    for (const auto& failure : status.failedReferences) {
      static_cast<void>(appendAppleBinaryReference(failures, failure));
    }
  }
  retainBinaryCleanupFailures(state, failures, context);
  references.clear();
}

bool enqueueBoundedRecord(
    const std::shared_ptr<AppleNativeProtocolExecution::State>& state,
    protocol::BoundedNativeEventBuffer& buffer,
    std::vector<BinaryReferenceList>& references,
    std::vector<std::uint8_t> bytes,
    std::size_t maximumRecords,
    std::size_t maximumBytes,
    const char* context,
    std::vector<std::optional<protocol::ProtocolRecord>>* terminalResults = nullptr,
    std::optional<protocol::ProtocolRecord> terminalResult = std::nullopt,
    std::vector<std::optional<protocol::ProtocolRecord>>* terminalConnectionCommands = nullptr,
    std::optional<protocol::ProtocolRecord> terminalConnectionCommand = std::nullopt) {
  if (!boundedBufferCanAdmit(buffer, bytes.size(), maximumRecords, maximumBytes)) {
    const auto rejectedBinaryReferences = binaryReferencesFromEncodedRecord(bytes);
    try {
      const auto admitted = buffer.enqueue(std::move(bytes));
      releaseAndLedgerBinaryReferences(state, rejectedBinaryReferences, context);
      releaseQueuedBinaryReferences(state, references, context);
      if (terminalResults != nullptr) terminalResults->clear();
      if (terminalConnectionCommands != nullptr) terminalConnectionCommands->clear();
      return admitted;
    } catch (...) {
      releaseAndLedgerBinaryReferences(state, rejectedBinaryReferences, context);
      releaseQueuedBinaryReferences(state, references, context);
      if (terminalResults != nullptr) terminalResults->clear();
      if (terminalConnectionCommands != nullptr) terminalConnectionCommands->clear();
      buffer.reset();
      throw;
    }
  }

  const auto binaryReferences = binaryReferencesFromEncodedRecord(bytes);
  references.push_back(binaryReferences);
  if (terminalResults != nullptr) terminalResults->push_back(std::move(terminalResult));
  if (terminalConnectionCommands != nullptr) terminalConnectionCommands->push_back(std::move(terminalConnectionCommand));
  try {
    const auto admitted = buffer.enqueue(std::move(bytes));
    if (!admitted) {
      const auto rejectedBinaryReferences = std::move(references.back());
      references.pop_back();
      if (terminalResults != nullptr) terminalResults->pop_back();
      if (terminalConnectionCommands != nullptr) terminalConnectionCommands->pop_back();
      releaseAndLedgerBinaryReferences(state, rejectedBinaryReferences, context);
      releaseQueuedBinaryReferences(state, references, context);
      if (terminalResults != nullptr) terminalResults->clear();
      if (terminalConnectionCommands != nullptr) terminalConnectionCommands->clear();
    }
    return admitted;
  } catch (...) {
    const auto rejectedBinaryReferences = std::move(references.back());
    references.pop_back();
    if (terminalResults != nullptr) terminalResults->pop_back();
    if (terminalConnectionCommands != nullptr) terminalConnectionCommands->pop_back();
    releaseAndLedgerBinaryReferences(state, rejectedBinaryReferences, context);
    releaseQueuedBinaryReferences(state, references, context);
    if (terminalResults != nullptr) terminalResults->clear();
    if (terminalConnectionCommands != nullptr) terminalConnectionCommands->clear();
    buffer.reset();
    throw;
  }
}

protocol::ProtocolRecord javaScriptEventBufferOverflow(
    const std::shared_ptr<AppleNativeProtocolExecution::State>& state,
    const protocol::BoundedNativeEventBuffer::OverflowSnapshot& counters);

bool scheduleJavaScriptEventDrain(
    const std::shared_ptr<AppleNativeProtocolExecution::State>& state,
    std::uint64_t attachmentGeneration,
    bool consumesClaimedDrainReservation);

void connectionOwnershipAfterSettlement(
    const std::shared_ptr<AppleNativeProtocolExecution::State>& state,
    const protocol::ProtocolRecord& command);

void notifyJavaScriptFatalSink(
    const std::shared_ptr<AppleNativeProtocolExecution::State>& state,
    const std::string& reason,
    std::uint64_t attachmentGeneration) noexcept {
  {
    std::scoped_lock lock(state->mutex);
    if (!state->fatalSink) {
      NSLog(@"[UnifiedBleProtocolAppleExecution] JavaScript fatal sink is unavailable: %s", reason.c_str());
      return;
    }
  }
  const auto invoker = state->callInvoker;
  if (!invoker) {
    NSLog(@"[UnifiedBleProtocolAppleExecution] JavaScript fatal sink scheduling unavailable: %s", reason.c_str());
    return;
  }
  try {
    invoker->invokeAsync([state, reason, attachmentGeneration](jsi::Runtime& runtime) {
      std::shared_ptr<jsi::Function> sink;
      {
        std::scoped_lock lock(state->mutex);
        if (
            state->closed.load(std::memory_order_acquire) ||
            !state->attachmentFatal ||
            state->attachmentGeneration != attachmentGeneration) {
          return;
        }
        sink = state->fatalSink;
      }
      if (!sink) return;
      try {
        sink->call(runtime, jsi::String::createFromUtf8(runtime, reason));
      } catch (const std::exception& error) {
        logNativeFailure("Apple JavaScript fatal sink callback", error);
      } catch (...) {
        NSLog(@"[UnifiedBleProtocolAppleExecution] Apple JavaScript fatal sink callback failed with an unknown exception");
      }
    });
  } catch (const std::exception& error) {
    logNativeFailure("Apple JavaScript fatal sink scheduling", error);
  } catch (...) {
    NSLog(@"[UnifiedBleProtocolAppleExecution] Apple JavaScript fatal sink scheduling failed with an unknown exception");
  }
}

/**
 * A result is the only completion path for a JS command.  If its terminal cannot
 * be admitted to the active sink, retaining a partially-live attachment would
 * strand every pending JS command.  Close the whole attachment and return its
 * radio resources to the process-owned retry/teardown path instead.
 */
void failAttachmentAfterTerminalAdmissionFailure(
    const std::shared_ptr<AppleNativeProtocolExecution::State>& state,
    const char* context,
    std::optional<std::uint64_t> expectedAttachmentGeneration = std::nullopt) noexcept {
  try {
    protocol::NativeAttachmentIdentity attachment;
    bool releaseRadio = false;
    std::uint64_t fatalAttachmentGeneration = 0U;
    {
      std::scoped_lock lock(state->mutex);
      if (
          state->attachmentFatal ||
          !state->attachmentActive ||
          (expectedAttachmentGeneration.has_value() &&
              state->attachmentGeneration != *expectedAttachmentGeneration)) {
        return;
      }
      attachment = state->runtime->attachmentIdentity();
      state->attachmentFatal = true;
      state->attachmentActive = false;
      state->ingressClosed = true;
      if (state->attachmentGeneration != std::numeric_limits<std::uint64_t>::max()) {
        state->attachmentGeneration += 1U;
      }
      fatalAttachmentGeneration = state->attachmentGeneration;
      releaseQueuedBinaryReferences(
          state,
          state->binaryReferencesAwaitingSink,
          "Apple terminal-admission failure pre-JavaScript discard");
      releaseQueuedBinaryReferences(
          state,
          state->binaryReferencesAwaitingJavaScript,
          "Apple terminal-admission failure JavaScript discard");
      state->terminalResultsAwaitingJavaScript.clear();
      state->terminalConnectionCommandsAwaitingJavaScript.clear();
      state->recordsAwaitingSink.reset();
      state->recordsAwaitingJavaScript.reset();
      state->drainScheduled = false;
      state->connections.clear();
      releaseRadio = state->radio != nullptr;
    }
    try {
      // This clears every pending native operation as a single fatal attachment
      // outcome; no later completion can settle an unreachable JS promise.
      state->runtime->close(attachment);
    } catch (const std::exception& error) {
      logNativeFailure("Apple terminal-admission runtime close", error);
    } catch (...) {
      NSLog(@"[UnifiedBleProtocolAppleExecution] Apple terminal-admission runtime close failed with an unknown exception");
    }
    notifyJavaScriptFatalSink(state, context, fatalAttachmentGeneration);
    if (releaseRadio) {
      @try {
        [radioFor(state) releaseProtocolClientWithCompletion:^(NSError* error) {
          if (error != nil) {
            NSLog(@"[UnifiedBleProtocolAppleExecution] %s radio release failed: %@", context, error.localizedDescription);
          }
        }];
      } @catch (NSException* exception) {
        NSLog(@"[UnifiedBleProtocolAppleExecution] %s radio release raised: %@", context, exception.reason);
      }
    }
    NSLog(@"[UnifiedBleProtocolAppleExecution] %s; attachment was fatally closed to avoid stranded terminal delivery", context);
  } catch (const std::exception& error) {
    logNativeFailure("Apple terminal-admission fatal attachment", error);
  } catch (...) {
    NSLog(@"[UnifiedBleProtocolAppleExecution] Apple terminal-admission fatal attachment failed with an unknown exception");
  }
}

bool deliverEncodedRecordToJavaScript(
    const std::shared_ptr<AppleNativeProtocolExecution::State>& state,
    jsi::Runtime& runtime,
    const std::vector<std::uint8_t>& bytes,
    std::uint64_t attachmentGeneration,
    bool allowClosedIngress = false) {
  std::scoped_lock lock(state->mutex);
  if (
      state->closed.load(std::memory_order_acquire) ||
      !state->attachmentActive ||
      state->attachmentGeneration != attachmentGeneration ||
      !state->eventSink ||
      (!allowClosedIngress && state->ingressClosed)) {
    return false;
  }
  jsi::Uint8Array output(runtime, bytes.size());
  const auto buffer = output.buffer(runtime);
  auto* destination = buffer.data(runtime);
  if (!bytes.empty() && destination == nullptr) {
    throw jsi::JSError(runtime, "Apple native protocol could not allocate event bytes");
  }
  if (!bytes.empty()) {
    std::memcpy(destination, bytes.data(), bytes.size());
  }
  state->eventSink->call(runtime, output);
  return true;
}

bool scheduleRecord(
    const std::shared_ptr<AppleNativeProtocolExecution::State>& state,
    std::vector<std::uint8_t> bytes,
    std::uint64_t attachmentGeneration,
    std::optional<protocol::ProtocolRecord> terminalResult = std::nullopt,
    std::optional<protocol::ProtocolRecord> terminalConnectionCommand = std::nullopt) {
  bool scheduleDrain = false;
  bool admitted = false;
  {
    std::scoped_lock lock(state->mutex);
    if (
        state->closed.load(std::memory_order_acquire) ||
        !state->attachmentActive ||
        state->ingressClosed ||
        state->attachmentGeneration != attachmentGeneration) {
      return false;
    }
    if (!state->eventSink) {
      if (terminalResult.has_value()) return false;
      admitted = enqueueBoundedRecord(
          state,
          state->recordsAwaitingSink,
          state->binaryReferencesAwaitingSink,
          std::move(bytes),
          AppleNativeProtocolExecution::State::kMaximumPreJavaScriptRecords,
          AppleNativeProtocolExecution::State::kMaximumPreJavaScriptBytes,
          "Apple pre-JavaScript event discard");
      if (!admitted) state->ingressClosed = true;
      return admitted;
    }
    admitted = enqueueBoundedRecord(
        state,
        state->recordsAwaitingJavaScript,
        state->binaryReferencesAwaitingJavaScript,
        std::move(bytes),
        AppleNativeProtocolExecution::State::kMaximumJavaScriptRecords,
        AppleNativeProtocolExecution::State::kMaximumJavaScriptBytes,
        "Apple JavaScript event discard",
        &state->terminalResultsAwaitingJavaScript,
        std::move(terminalResult),
        &state->terminalConnectionCommandsAwaitingJavaScript,
        std::move(terminalConnectionCommand));
    if (!admitted) {
      state->ingressClosed = true;
      return false;
    }
    if (state->callInvoker == nullptr) {
      releaseQueuedBinaryReferences(
          state,
          state->binaryReferencesAwaitingJavaScript,
          "Apple JavaScript event drain unavailable");
      state->terminalResultsAwaitingJavaScript.clear();
      state->terminalConnectionCommandsAwaitingJavaScript.clear();
      state->recordsAwaitingJavaScript.reset();
      state->ingressClosed = true;
      return false;
    }
    // Claim the only drain slot while this record is admitted.  A concurrent
    // terminal therefore queues behind this claimed invocation instead of
    // attempting to schedule a second drain or treating the claim as failure.
    if (!state->drainScheduled) {
      state->drainScheduled = true;
      scheduleDrain = true;
    }
  }
  if (scheduleDrain && !scheduleJavaScriptEventDrain(state, attachmentGeneration, true)) return false;
  return admitted;
}

struct NativeResultDeliveryStatus final {
  bool settled = false;
  bool delivered = false;
};

NativeResultDeliveryStatus deliverResult(
  const std::shared_ptr<AppleNativeProtocolExecution::State>& state,
  const protocol::ProtocolRecord& result,
  const protocol::ProtocolRecord* connectionCommand = nullptr) {
  const auto bytes = protocol::NativeProtocolV1Codec{}.encode(result);
  std::uint64_t attachmentGeneration = 0U;
  bool ingressAvailable = false;
  {
    std::scoped_lock lock(state->mutex);
    attachmentGeneration = state->attachmentGeneration;
    ingressAvailable = !state->closed.load(std::memory_order_acquire) &&
        !state->attachmentFatal &&
        state->attachmentActive &&
        !state->ingressClosed &&
        state->eventSink != nullptr &&
        state->callInvoker != nullptr;
  }
  if (!ingressAvailable || !scheduleRecord(
      state,
      bytes,
      attachmentGeneration,
      result,
      connectionCommand == nullptr
          ? std::nullopt
          : std::optional<protocol::ProtocolRecord>(*connectionCommand))) {
    failAttachmentAfterTerminalAdmissionFailure(
        state,
        "Apple native terminal could not be admitted to JavaScript",
        attachmentGeneration);
    return {};
  }
  return {.settled = false, .delivered = true};
}

bool deliverEvent(
    const std::shared_ptr<AppleNativeProtocolExecution::State>& state,
    const protocol::ProtocolRecord& event,
    std::uint64_t attachmentGeneration) {
  {
    std::scoped_lock lock(state->mutex);
    if (
        state->closed.load(std::memory_order_acquire) ||
        !state->attachmentActive ||
        state->ingressClosed ||
        state->attachmentGeneration != attachmentGeneration) {
      return false;
    }
  }
  state->runtime->validateEvent(event);
  return scheduleRecord(state, protocol::NativeProtocolV1Codec{}.encode(event), attachmentGeneration);
}

protocol::ProtocolRecord eventBufferOverflow(
    const std::shared_ptr<AppleNativeProtocolExecution::State>& state,
    const protocol::BoundedNativeEventBuffer::OverflowSnapshot& counters,
    const char* description,
    const char* streamName,
    const char* eventPrefix) {
  const auto reservation = reserveNativeIngressOrdinal(state, true);
  if (!reservation.has_value()) {
    throw std::overflow_error(
        "Apple native ingress ordinal unavailable before the event-buffer overflow terminal");
  }
  const auto ordinal = reservation->ordinal;
  const auto safeMessage =
      std::string("Native Protocol v1 ") + description + " event buffer overflowed after retaining " +
      std::to_string(counters.retainedRecordCount) + " records and " +
      std::to_string(counters.retainedByteCount) + " bytes";
  const auto error = protocol::ProtocolRecord{
      .kind = protocol::RecordKind::error,
      .fields = {
          field(1U, std::string("stream.overflow")),
          field(2U, std::string("native-protocol")),
          field(3U, std::string(streamName) + "-event-buffer"),
          field(4U, std::string("notRetryable")),
          field(7U, safeMessage),
          field(11U, protocol::ProtocolStringList{
              "retainedRecordCount=" + std::to_string(counters.retainedRecordCount),
              "retainedByteCount=" + std::to_string(counters.retainedByteCount),
              "rejectedRecordByteCount=" + std::to_string(counters.rejectedRecordByteCount),
              "droppedRecordCount=" + std::to_string(counters.droppedRecordCount),
              "droppedByteCount=" + std::to_string(counters.droppedByteCount),
              "overflowCount=" + std::to_string(counters.overflowCount),
          }),
      }};
  return {
      .kind = protocol::RecordKind::event,
      .fields = {
          field(1U, std::uint64_t{1U}),
          field(2U, std::string(eventPrefix) + ":" + std::to_string(ordinal)),
          field(3U, std::string("diagnostic")),
          field(4U, reference(attachmentRecord(state->runtime->attachmentIdentity()))),
          field(5U, ordinal),
          field(6U, monotonicMilliseconds()),
          field(14U, reference(error)),
      }};
}

protocol::ProtocolRecord preJavaScriptEventBufferOverflow(
    const std::shared_ptr<AppleNativeProtocolExecution::State>& state,
    const protocol::BoundedNativeEventBuffer::OverflowSnapshot& counters) {
  return eventBufferOverflow(state, counters, "pre-JavaScript", "pre-js", "apple-pre-js-event-buffer-overflow");
}

protocol::ProtocolRecord javaScriptEventBufferOverflow(
    const std::shared_ptr<AppleNativeProtocolExecution::State>& state,
    const protocol::BoundedNativeEventBuffer::OverflowSnapshot& counters) {
  return eventBufferOverflow(state, counters, "JavaScript", "jsi", "apple-js-event-buffer-overflow");
}

bool scheduleJavaScriptEventDrain(
    const std::shared_ptr<AppleNativeProtocolExecution::State>& state,
    std::uint64_t attachmentGeneration,
    bool consumesClaimedDrainReservation) {
  std::shared_ptr<facebook::react::CallInvoker> invoker;
  std::uint64_t scheduledGeneration = 0U;
  {
    std::scoped_lock lock(state->mutex);
    if (
        state->closed.load(std::memory_order_acquire) ||
        !state->attachmentActive ||
        !state->eventSink ||
        state->attachmentGeneration != attachmentGeneration ||
        (consumesClaimedDrainReservation && !state->drainScheduled) ||
        (!consumesClaimedDrainReservation && state->drainScheduled)) {
      return false;
    }
    invoker = state->callInvoker;
    if (!invoker) {
      state->ingressClosed = true;
      releaseQueuedBinaryReferences(
          state,
          state->binaryReferencesAwaitingJavaScript,
          "Apple JavaScript event drain unavailable");
      state->terminalResultsAwaitingJavaScript.clear();
      state->terminalConnectionCommandsAwaitingJavaScript.clear();
      state->recordsAwaitingJavaScript.reset();
      return false;
    }
    scheduledGeneration = attachmentGeneration;
    if (!consumesClaimedDrainReservation) {
      state->drainScheduled = true;
    }
  }

  try {
    invoker->invokeAsync([state, scheduledGeneration](jsi::Runtime& runtime) {
      std::vector<std::vector<std::uint8_t>> records;
      std::vector<BinaryReferenceList> binaryReferences;
      std::vector<std::optional<protocol::ProtocolRecord>> terminalResults;
      std::vector<std::optional<protocol::ProtocolRecord>> terminalConnectionCommands;
      std::optional<protocol::BoundedNativeEventBuffer::OverflowSnapshot> overflow;
      std::optional<protocol::ProtocolRecord> overflowRecord;
      std::uint64_t attachmentGeneration = 0U;
      bool overflowAccountingUnavailable = false;
      try {
        std::scoped_lock lock(state->mutex);
        if (state->attachmentGeneration != scheduledGeneration) {
          return;
        }
        if (
            state->closed.load(std::memory_order_acquire) ||
            !state->attachmentActive ||
            !state->eventSink) {
          state->drainScheduled = false;
          releaseQueuedBinaryReferences(
              state,
              state->binaryReferencesAwaitingJavaScript,
              "Apple JavaScript event generation discard");
          state->terminalResultsAwaitingJavaScript.clear();
          state->terminalConnectionCommandsAwaitingJavaScript.clear();
          state->recordsAwaitingJavaScript.reset();
          return;
        }
        attachmentGeneration = scheduledGeneration;
        if (state->recordsAwaitingJavaScript.overflowed()) {
          overflow = state->recordsAwaitingJavaScript.overflowSnapshot();
          if (!overflow.has_value()) {
            state->drainScheduled = false;
            state->ingressClosed = true;
            releaseQueuedBinaryReferences(
                state,
                state->binaryReferencesAwaitingJavaScript,
                "Apple JavaScript event overflow accounting discard");
            state->terminalResultsAwaitingJavaScript.clear();
            state->terminalConnectionCommandsAwaitingJavaScript.clear();
            state->recordsAwaitingJavaScript.reset();
            overflowAccountingUnavailable = true;
          } else {
            overflowRecord = javaScriptEventBufferOverflow(state, *overflow);
            state->runtime->validateEvent(*overflowRecord);
            releaseQueuedBinaryReferences(
                state,
                state->binaryReferencesAwaitingJavaScript,
                "Apple JavaScript event overflow discard");
            state->terminalResultsAwaitingJavaScript.clear();
            state->terminalConnectionCommandsAwaitingJavaScript.clear();
            state->recordsAwaitingJavaScript.reset();
            state->ingressClosed = true;
          }
        } else {
          records = state->recordsAwaitingJavaScript.drain();
          binaryReferences.swap(state->binaryReferencesAwaitingJavaScript);
          terminalResults.swap(state->terminalResultsAwaitingJavaScript);
          terminalConnectionCommands.swap(state->terminalConnectionCommandsAwaitingJavaScript);
        }
      }
      catch (const std::exception& error) {
        logNativeFailure("JavaScript event drain preparation", error);
        std::scoped_lock lock(state->mutex);
        if (state->attachmentGeneration != scheduledGeneration) {
          return;
        }
        state->ingressClosed = true;
        state->drainScheduled = false;
        releaseQueuedBinaryReferences(
            state,
            state->binaryReferencesAwaitingJavaScript,
            "Apple JavaScript event drain preparation discard");
        state->terminalResultsAwaitingJavaScript.clear();
        state->terminalConnectionCommandsAwaitingJavaScript.clear();
        state->recordsAwaitingJavaScript.reset();
        failAttachmentAfterTerminalAdmissionFailure(
            state,
            "Apple JavaScript event drain preparation failed",
            scheduledGeneration);
        return;
      }
      catch (...) {
        NSLog(@"[UnifiedBleProtocolAppleExecution] JavaScript event drain preparation failed with an unknown exception");
        std::scoped_lock lock(state->mutex);
        if (state->attachmentGeneration != scheduledGeneration) {
          return;
        }
        state->ingressClosed = true;
        state->drainScheduled = false;
        releaseQueuedBinaryReferences(
            state,
            state->binaryReferencesAwaitingJavaScript,
            "Apple JavaScript event drain preparation discard");
        state->terminalResultsAwaitingJavaScript.clear();
        state->terminalConnectionCommandsAwaitingJavaScript.clear();
        state->recordsAwaitingJavaScript.reset();
        failAttachmentAfterTerminalAdmissionFailure(
            state,
            "Apple JavaScript event drain preparation failed with an unknown exception",
            scheduledGeneration);
        return;
      }

      std::size_t delivered = 0U;
      try {
        if (overflowAccountingUnavailable) {
          throw std::logic_error("Apple JavaScript event buffer overflow accounting is unavailable");
        }
        if (overflowRecord.has_value()) {
          if (!deliverEncodedRecordToJavaScript(
                  state,
                  runtime,
                  protocol::NativeProtocolV1Codec{}.encode(*overflowRecord),
                  attachmentGeneration,
                  true)) {
            failAttachmentAfterTerminalAdmissionFailure(
                state,
                "Apple JavaScript overflow delivery failed after admission",
                scheduledGeneration);
            return;
          }
        } else {
          if (
              records.size() != binaryReferences.size() ||
              records.size() != terminalResults.size() ||
              records.size() != terminalConnectionCommands.size()) {
            throw std::logic_error("Apple JavaScript event binary ownership ledger is out of sync");
          }
          for (std::size_t index = 0U; index < records.size(); index += 1U) {
            if (!deliverEncodedRecordToJavaScript(
                    state,
                    runtime,
                    records[index],
                    attachmentGeneration)) {
              break;
            }
            if (terminalResults[index].has_value()) {
              if (!state->runtime->settleResult(*terminalResults[index])) {
                quarantineLateCompletion(state, *terminalResults[index]);
              } else if (terminalConnectionCommands[index].has_value()) {
                connectionOwnershipAfterSettlement(state, *terminalConnectionCommands[index]);
              }
            }
            delivered += 1U;
          }
        }
      } catch (const std::exception& error) {
        logNativeFailure("JavaScript event delivery", error);
        std::scoped_lock lock(state->mutex);
        state->ingressClosed = true;
      } catch (...) {
        NSLog(@"[UnifiedBleProtocolAppleExecution] JavaScript event delivery failed with an unknown exception");
        std::scoped_lock lock(state->mutex);
        state->ingressClosed = true;
      }

      if (!overflowRecord.has_value() && delivered < binaryReferences.size()) {
        for (std::size_t index = delivered; index < binaryReferences.size(); index += 1U) {
          releaseAndLedgerBinaryReferences(
              state,
              binaryReferences[index],
              "Apple JavaScript event delivery discard");
        }
      }

      if (!overflowRecord.has_value() && delivered < records.size()) {
        failAttachmentAfterTerminalAdmissionFailure(
            state,
            "Apple JavaScript event sink delivery failed after admission",
            scheduledGeneration);
        return;
      }

      bool scheduleNext = false;
      {
        std::scoped_lock lock(state->mutex);
        if (state->attachmentGeneration != scheduledGeneration) {
          return;
        }
        if (
            !state->ingressClosed &&
            state->attachmentActive &&
            state->eventSink &&
            state->recordsAwaitingJavaScript.recordCount() > 0U) {
          scheduleNext = true;
        } else if (state->recordsAwaitingJavaScript.overflowed()) {
          scheduleNext = true;
        } else {
          if (state->ingressClosed) {
            releaseQueuedBinaryReferences(
                state,
                state->binaryReferencesAwaitingJavaScript,
                "Apple closed JavaScript event queue discard");
            state->terminalResultsAwaitingJavaScript.clear();
            state->terminalConnectionCommandsAwaitingJavaScript.clear();
            state->recordsAwaitingJavaScript.reset();
          }
          state->drainScheduled = false;
        }
      }
      if (scheduleNext) {
        if (!scheduleJavaScriptEventDrain(state, scheduledGeneration, true)) {
          failAttachmentAfterTerminalAdmissionFailure(
              state,
              "Apple JavaScript event drain continuation scheduling failed",
              scheduledGeneration);
        }
      }
    });
  } catch (const std::exception& error) {
    logNativeFailure("JavaScript event drain scheduling", error);
    std::scoped_lock lock(state->mutex);
    if (state->attachmentGeneration != scheduledGeneration) {
      return false;
    }
    state->ingressClosed = true;
    state->drainScheduled = false;
    releaseQueuedBinaryReferences(
        state,
        state->binaryReferencesAwaitingJavaScript,
        "Apple JavaScript event drain scheduling discard");
    state->terminalResultsAwaitingJavaScript.clear();
    state->terminalConnectionCommandsAwaitingJavaScript.clear();
    state->recordsAwaitingJavaScript.reset();
    failAttachmentAfterTerminalAdmissionFailure(
        state,
        "Apple JavaScript event drain scheduling failed",
        scheduledGeneration);
    return false;
  } catch (...) {
    NSLog(@"[UnifiedBleProtocolAppleExecution] JavaScript event drain scheduling failed with an unknown exception");
    std::scoped_lock lock(state->mutex);
    if (state->attachmentGeneration != scheduledGeneration) {
      return false;
    }
    state->ingressClosed = true;
    state->drainScheduled = false;
    releaseQueuedBinaryReferences(
        state,
        state->binaryReferencesAwaitingJavaScript,
        "Apple JavaScript event drain scheduling discard");
    state->terminalResultsAwaitingJavaScript.clear();
    state->terminalConnectionCommandsAwaitingJavaScript.clear();
    state->recordsAwaitingJavaScript.reset();
    failAttachmentAfterTerminalAdmissionFailure(
        state,
        "Apple JavaScript event drain scheduling failed with an unknown exception",
        scheduledGeneration);
    return false;
  }
  return true;
}

protocol::ProtocolRecord failureResult(
    const protocol::ProtocolRecord& command,
    const std::string& code,
    const std::string& message,
    NSError* error,
    const std::string& retryability = "notRetryable",
    const protocol::ProtocolStringList& metadata = {}) {
  std::vector<protocol::ProtocolField> errorFields{
      field(1U, code),
      field(2U, std::string("corebluetooth")),
      field(3U, requiredString(command, 3U)),
      field(4U, retryability),
      field(7U, message),
  };
  if (error != nil) {
    errorFields.push_back(field(9U, nsString(error.domain, "error domain")));
    errorFields.push_back(field(10U, static_cast<std::int64_t>(error.code)));
  }
  if (!metadata.empty()) errorFields.push_back(field(11U, metadata));
  const auto failure = protocol::ProtocolRecord{.kind = protocol::RecordKind::error, .fields = std::move(errorFields)};
  return {
      .kind = protocol::RecordKind::result,
      .fields = {
          field(1U, std::uint64_t{1U}),
          field(2U, resultKindFor(requiredString(command, 3U))),
          field(3U, reference(terminal(command, "failed", code))),
          field(10U, reference(failure)),
      },
  };
}

void fail(
    const std::shared_ptr<AppleNativeProtocolExecution::State>& state,
    const protocol::ProtocolRecord& command,
    const std::string& code,
    NSError* error) {
  try {
    static_cast<void>(deliverResult(state, failureResult(command, code, errorMessage(error), error)));
  } catch (const std::exception& error) {
    logNativeFailure("terminal failure delivery", error);
  }
}

void connectionOwnershipAfterSettlement(
    const std::shared_ptr<AppleNativeProtocolExecution::State>& state,
    const protocol::ProtocolRecord& command) {
  const auto kind = requiredString(command, 3U);
  if (kind != "connect" && kind != "disconnect") return;
  const auto peer = requiredString(requiredRecord(command, 10U), 2U);
  std::scoped_lock lock(state->mutex);
  if (kind == "connect") {
    state->connections.insert_or_assign(peer, requiredRecord(command, 10U));
  } else {
    state->connections.erase(peer);
  }
}

bool success(
    const std::shared_ptr<AppleNativeProtocolExecution::State>& state,
    const protocol::ProtocolRecord& command,
    const std::vector<protocol::ProtocolField>& additions = {}) {
  std::vector<protocol::ProtocolField> fields{
      field(1U, std::uint64_t{1U}),
      field(2U, resultKindFor(requiredString(command, 3U))),
      field(3U, reference(terminal(command, "succeeded"))),
  };
  const auto kind = requiredString(command, 3U);
  if (kind == "connect") fields.push_back(field(11U, reference(requiredRecord(command, 10U))));
  if (kind == "subscribe" || kind == "unsubscribe") {
    fields.push_back(field(5U, reference(requiredRecord(command, 4U))));
    fields.push_back(field(7U, requiredString(command, 7U)));
  }
  fields.insert(fields.end(), additions.begin(), additions.end());
  const auto delivery = deliverResult(
      state,
      {.kind = protocol::RecordKind::result, .fields = std::move(fields)},
      &command);
  return delivery.delivered;
}

struct Endpoint {
  std::string peer;
  std::string serviceUuid;
  NSInteger serviceOccurrence;
  std::string characteristicUuid;
  NSInteger characteristicOccurrence;
};

Endpoint endpointFor(const protocol::ProtocolRecord& path) {
  const auto& service = requiredRecord(path, 1U);
  const auto& database = requiredRecord(service, 1U);
  const auto& connection = requiredRecord(database, 1U);
  const auto serviceOccurrence = requiredString(service, 3U);
  const auto characteristicOccurrence = requiredString(path, 3U);
  try {
    return {
        .peer = requiredString(connection, 2U),
        .serviceUuid = requiredString(service, 2U),
        .serviceOccurrence = static_cast<NSInteger>(std::stoll(serviceOccurrence)),
        .characteristicUuid = requiredString(path, 2U),
        .characteristicOccurrence = static_cast<NSInteger>(std::stoll(characteristicOccurrence)),
    };
  } catch (const std::exception&) {
    throw protocol::ProtocolException(protocol::ProtocolFailure::invalidPath, "Apple native characteristic occurrence is invalid");
  }
}

struct DescriptorEndpoint {
  Endpoint characteristic;
  std::string descriptorUuid;
  NSInteger descriptorOccurrence;
};

DescriptorEndpoint descriptorEndpointFor(const protocol::ProtocolRecord& path) {
  const auto& characteristic = requiredRecord(path, 1U);
  const auto occurrence = requiredString(path, 3U);
  try {
    return {
        .characteristic = endpointFor(characteristic),
        .descriptorUuid = requiredString(path, 2U),
        .descriptorOccurrence = static_cast<NSInteger>(std::stoll(occurrence)),
    };
  } catch (const std::exception&) {
    throw protocol::ProtocolException(protocol::ProtocolFailure::invalidPath, "Apple native descriptor occurrence is invalid");
  }
}

void dispatchCommand(
    const std::shared_ptr<AppleNativeProtocolExecution::State>& state,
    const protocol::ProtocolRecord& borrowedCommand) {
  const auto command = borrowedCommand;
  auto* radio = radioFor(state);
  if (radio == nil) {
    fail(state, command, "radioUnavailable", nil);
    return;
  }
  const auto kind = requiredString(command, 3U);
  const auto nonce = requiredString(requiredRecord(command, 2U), 3U);
  if (kind == "scanStart") {
    const auto& options = requiredRecord(command, 12U);
    const auto& values = requiredStringList(options, 1U);
    NSMutableArray<NSString*>* uuids = [NSMutableArray arrayWithCapacity:values.size()];
    for (const auto& value : values) [uuids addObject:[NSString stringWithUTF8String:value.c_str()]];
    [radio startScanWithServiceUUIDs:uuids allowDuplicates:requiredBoolean(options, 2U) operationIdentifier:[NSString stringWithUTF8String:nonce.c_str()] completion:^(NSError* error) {
      if (error == nil) static_cast<void>(success(state, command));
      else fail(state, command, "scanStartFailed", error);
    }];
    return;
  }
  if (kind == "scanStop") {
    [radio stopScanWithOperationIdentifier:[NSString stringWithUTF8String:nonce.c_str()] completion:^(NSError* error) {
      if (error == nil) static_cast<void>(success(state, command));
      else fail(state, command, "scanStopFailed", error);
    }];
    return;
  }
  if (kind == "connect" || kind == "disconnect") {
    const auto peer = requiredString(requiredRecord(command, 10U), 2U);
    const auto identifier = [NSString stringWithUTF8String:peer.c_str()];
    const auto operation = [NSString stringWithUTF8String:nonce.c_str()];
    void (^completion)(NSError*) = ^(NSError* error) {
      if (error == nil) static_cast<void>(success(state, command));
      else fail(state, command, kind == "connect" ? "connectFailed" : "disconnectFailed", error);
    };
    if (kind == "connect") [radio connectWithPeerIdentifier:identifier operationIdentifier:operation completion:completion];
    else [radio disconnectWithPeerIdentifier:identifier operationIdentifier:operation completion:completion];
    return;
  }
  if (kind == "discover") {
    const auto peer = requiredString(requiredRecord(command, 10U), 2U);
    const auto database = requiredRecord(command, 11U);
    [radio discoverWithPeerIdentifier:[NSString stringWithUTF8String:peer.c_str()] operationIdentifier:[NSString stringWithUTF8String:nonce.c_str()] completion:^(NSDictionary* snapshot, NSError* error) {
      if (error != nil || snapshot == nil) {
        fail(state, command, "discoverFailed", error);
        return;
      }
      try {
        std::vector<protocol::ProtocolRecordReference> services;
        std::vector<protocol::ProtocolRecordReference> characteristics;
        std::vector<protocol::ProtocolRecordReference> descriptors;
        NSArray* nativeServices = snapshot[@"services"];
        for (NSDictionary* service in nativeServices) {
          const auto servicePath = protocol::ProtocolRecord{.kind = protocol::RecordKind::servicePath, .fields = {
              field(1U, reference(database)), field(2U, nsString(service[@"uuid"], "service UUID")),
              field(3U, std::to_string([service[@"occurrence"] integerValue]))}};
          services.push_back(reference(servicePath));
          for (NSDictionary* characteristic in service[@"characteristics"]) {
            const auto characteristicPath = protocol::ProtocolRecord{.kind = protocol::RecordKind::characteristicPath, .fields = {
                field(1U, reference(servicePath)), field(2U, nsString(characteristic[@"uuid"], "characteristic UUID")),
                field(3U, std::to_string([characteristic[@"occurrence"] integerValue]))}};
            const auto characteristicSnapshot = protocol::ProtocolRecord{.kind = protocol::RecordKind::characteristicSnapshot, .fields = {
                field(1U, reference(characteristicPath)), field(2U, [characteristic[@"readable"] boolValue]),
                field(3U, [characteristic[@"writableWithResponse"] boolValue]),
                field(4U, [characteristic[@"writableWithoutResponse"] boolValue]),
                field(5U, [characteristic[@"notifiable"] boolValue])}};
            characteristics.push_back(reference(characteristicSnapshot));
            for (NSDictionary* descriptor in characteristic[@"descriptors"]) {
              const auto descriptorPath = protocol::ProtocolRecord{.kind = protocol::RecordKind::descriptorPath, .fields = {
                  field(1U, reference(characteristicPath)), field(2U, nsString(descriptor[@"uuid"], "descriptor UUID")),
                  field(3U, std::to_string([descriptor[@"occurrence"] integerValue]))}};
              descriptors.push_back(reference(descriptorPath));
            }
          }
        }
        const auto databaseSnapshot = protocol::ProtocolRecord{.kind = protocol::RecordKind::databaseSnapshot, .fields = {
            field(1U, reference(database)), field(2U, services), field(3U, characteristics), field(4U, descriptors)}};
        success(state, command, {field(4U, reference(database)), field(12U, reference(databaseSnapshot))});
      } catch (const std::exception& error) {
        logNativeFailure("discovery snapshot serialization", error);
        fail(state, command, "discoverSnapshotFailed", nil);
      }
    }];
    return;
  }
  if (kind == "readRssi") {
    const auto peer = requiredString(requiredRecord(command, 10U), 2U);
    [radio readRssiWithPeerIdentifier:[NSString stringWithUTF8String:peer.c_str()] operationIdentifier:[NSString stringWithUTF8String:nonce.c_str()] completion:^(NSNumber* value, NSError* error) {
      if (error != nil || value == nil) {
        fail(state, command, "readRssiFailed", error);
        return;
      }
      static_cast<void>(success(state, command, {field(13U, static_cast<std::int64_t>(value.longLongValue))}));
    }];
    return;
  }
  if (kind == "requestMtu") {
    fail(state, command, "requestMtuUnsupported", nil);
    return;
  }
  if (kind == "readDescriptor" || kind == "writeDescriptor") {
    const auto& descriptorPath = requiredRecord(command, 5U);
    const auto endpoint = descriptorEndpointFor(descriptorPath);
    const auto peer = [NSString stringWithUTF8String:endpoint.characteristic.peer.c_str()];
    const auto service = [NSString stringWithUTF8String:endpoint.characteristic.serviceUuid.c_str()];
    const auto characteristic = [NSString stringWithUTF8String:endpoint.characteristic.characteristicUuid.c_str()];
    const auto descriptor = [NSString stringWithUTF8String:endpoint.descriptorUuid.c_str()];
    const auto operation = [NSString stringWithUTF8String:nonce.c_str()];
    if (kind == "readDescriptor") {
      [radio readDescriptorWithPeerIdentifier:peer serviceUUID:service serviceOccurrence:endpoint.characteristic.serviceOccurrence characteristicUUID:characteristic characteristicOccurrence:endpoint.characteristic.characteristicOccurrence descriptorUUID:descriptor descriptorOccurrence:endpoint.descriptorOccurrence operationIdentifier:operation completion:^(NSData* value, NSError* error) {
        if (error != nil || value == nil) {
          fail(state, command, "readDescriptorFailed", error);
          return;
        }
        std::optional<protocol::OwnedBinaryReference> output;
        try {
          output = state->runtime->retainNativeBytes("apple-descriptor-read:" + nonce, bytesFromData(value));
          if (!success(state, command, {field(15U, reference(descriptorPath)), field(6U, reference(binaryReferenceRecord(*output)))})) {
            releaseAndLedgerBinaryReferences(state, BinaryReferenceList{*output}, "descriptor read binary release after non-delivery");
          }
        } catch (const std::exception& error) {
          logNativeFailure("descriptor read binary delivery", error);
          if (output) releaseAndLedgerBinaryReferences(state, BinaryReferenceList{*output}, "descriptor read binary release after delivery failure");
          fail(state, command, "readDescriptorBinaryDeliveryFailed", nil);
        }
      }];
      return;
    }
    const auto input = state->runtime->consumeCommandBinary(command);
    [radio writeDescriptorWithPeerIdentifier:peer serviceUUID:service serviceOccurrence:endpoint.characteristic.serviceOccurrence characteristicUUID:characteristic characteristicOccurrence:endpoint.characteristic.characteristicOccurrence descriptorUUID:descriptor descriptorOccurrence:endpoint.descriptorOccurrence value:dataFromBytes(input) operationIdentifier:operation completion:^(NSError* error) {
      if (error == nil) static_cast<void>(success(state, command, {field(15U, reference(descriptorPath))}));
      else fail(state, command, "writeDescriptorFailed", error);
    }];
    return;
  }
  if (kind == "destroy") {
    [radio releaseProtocolClientWithCompletion:^(NSError* error) {
      if (error == nil) static_cast<void>(success(state, command));
      else fail(state, command, "destroyFailed", error);
    }];
    return;
  }
  const auto path = requiredRecord(command, 4U);
  const auto endpoint = endpointFor(path);
  const auto peer = [NSString stringWithUTF8String:endpoint.peer.c_str()];
  const auto service = [NSString stringWithUTF8String:endpoint.serviceUuid.c_str()];
  const auto characteristic = [NSString stringWithUTF8String:endpoint.characteristicUuid.c_str()];
  const auto operation = [NSString stringWithUTF8String:nonce.c_str()];
  if (kind == "read") {
    [radio readWithPeerIdentifier:peer serviceUUID:service serviceOccurrence:endpoint.serviceOccurrence characteristicUUID:characteristic characteristicOccurrence:endpoint.characteristicOccurrence operationIdentifier:operation completion:^(NSData* value, NSError* error) {
      if (error != nil || value == nil) {
        fail(state, command, "readFailed", error);
        return;
      }
      std::optional<protocol::OwnedBinaryReference> output;
      try {
        output = state->runtime->retainNativeBytes("apple-read:" + nonce, bytesFromData(value));
        if (!success(state, command, {field(5U, reference(path)), field(6U, reference(binaryReferenceRecord(*output)))})) {
          releaseAndLedgerBinaryReferences(state, BinaryReferenceList{*output}, "read binary release after non-delivery");
        }
      } catch (const std::exception& error) {
        logNativeFailure("read binary delivery", error);
        if (output) releaseAndLedgerBinaryReferences(state, BinaryReferenceList{*output}, "read binary release after delivery failure");
        fail(state, command, "readBinaryDeliveryFailed", nil);
      }
    }];
    return;
  }
  if (kind == "write") {
    const auto input = state->runtime->consumeCommandBinary(command);
    const auto mode = requiredString(command, 13U);
    if (mode != "withResponse" && mode != "withoutResponse") {
      throw protocol::ProtocolException(protocol::ProtocolFailure::malformedRecord, "Apple native write mode is invalid");
    }
    [radio writeWithPeerIdentifier:peer serviceUUID:service serviceOccurrence:endpoint.serviceOccurrence characteristicUUID:characteristic characteristicOccurrence:endpoint.characteristicOccurrence value:dataFromBytes(input) withResponse:mode == "withResponse" operationIdentifier:operation completion:^(NSError* error) {
      if (error == nil) static_cast<void>(success(state, command));
      else fail(state, command, "writeFailed", error);
    }];
    return;
  }
  if (kind == "subscribe" || kind == "unsubscribe") {
    const auto subscription = requiredString(command, 7U);
    const auto subscriptionIdentifier = [NSString stringWithUTF8String:subscription.c_str()];
    void (^completion)(NSError*) = ^(NSError* error) {
      if (error == nil) static_cast<void>(success(state, command));
      else fail(state, command, "subscriptionFailed", error);
    };
    if (kind == "subscribe") {
      [radio subscribeWithPeerIdentifier:peer serviceUUID:service serviceOccurrence:endpoint.serviceOccurrence characteristicUUID:characteristic characteristicOccurrence:endpoint.characteristicOccurrence subscriptionIdentifier:subscriptionIdentifier operationIdentifier:operation completion:completion];
    } else {
      [radio unsubscribeWithPeerIdentifier:peer serviceUUID:service serviceOccurrence:endpoint.serviceOccurrence characteristicUUID:characteristic characteristicOccurrence:endpoint.characteristicOccurrence subscriptionIdentifier:subscriptionIdentifier operationIdentifier:operation completion:completion];
    }
    return;
  }
  fail(state, command, "unsupportedCommand", nil);
}

class BinaryRuntime final : public jsi::HostObject {
 public:
  explicit BinaryRuntime(std::shared_ptr<AppleNativeProtocolExecution::State> state) : state_(std::move(state)) {}

  jsi::Value get(jsi::Runtime& runtime, const jsi::PropNameID& name) override {
    const auto property = name.utf8(runtime);
    if (property == "retain") return retainFunction(runtime, name);
    if (property == "copy") return copyFunction(runtime, name);
    if (property == "release") return releaseFunction(runtime, name);
    if (property == "submit") return submitFunction(runtime, name);
    if (property == "setEventSink") return sinkFunction(runtime, name);
    if (property == "setFatalSink") return fatalSinkFunction(runtime, name);
    if (property == "retainedByteCount") return countFunction(runtime, name, true);
    if (property == "retainedPayloadCount") return countFunction(runtime, name, false);
    return jsi::Value::undefined();
  }

 private:
  std::shared_ptr<AppleNativeProtocolExecution::State> state_;

  std::shared_ptr<protocol::NativeProtocolControlRuntime> runtimeFor(jsi::Runtime& runtime) const {
    if (state_->closed.load(std::memory_order_acquire) || !state_->runtime->open()) {
      throw jsi::JSError(runtime, "Apple Native Protocol v1 runtime is closed");
    }
    return state_->runtime;
  }

  static std::string stringProperty(jsi::Runtime& runtime, const jsi::Object& object, const char* name) {
    const auto value = object.getProperty(runtime, name);
    if (!value.isString()) throw jsi::JSError(runtime, std::string("Native Protocol v1 requires ") + name);
    const auto result = value.asString(runtime).utf8(runtime);
    if (result.empty()) throw jsi::JSError(runtime, std::string("Native Protocol v1 rejects empty ") + name);
    return result;
  }

  static std::size_t sizeProperty(jsi::Runtime& runtime, const jsi::Object& object, const char* name) {
    const auto value = object.getProperty(runtime, name);
    if (!value.isNumber() || !std::isfinite(value.asNumber())) {
      throw jsi::JSError(runtime, std::string("Native Protocol v1 requires valid ") + name);
    }
    const auto checked = checkedAppleBinarySize(value.asNumber());
    if (!checked.has_value()) {
      throw jsi::JSError(runtime, std::string("Native Protocol v1 requires bounded safe integer ") + name);
    }
    return *checked;
  }

  static protocol::OwnedBinaryReference binaryReference(jsi::Runtime& runtime, const jsi::Value& value) {
    if (!value.isObject() || value.asObject(runtime).isArray(runtime)) throw jsi::JSError(runtime, "Native Protocol v1 requires a binary reference");
    const auto object = value.asObject(runtime);
    const auto offset = sizeProperty(runtime, object, "byteOffset");
    const auto length = sizeProperty(runtime, object, "byteLength");
    if (!checkedAppleBinaryRange(offset, length)) {
      throw jsi::JSError(runtime, "Native Protocol v1 binary reference range is invalid");
    }
    return {.ownerToken = stringProperty(runtime, object, "ownerToken"), .operationCorrelation = stringProperty(runtime, object, "operationCorrelation"), .byteOffset = offset, .byteLength = length, .ownership = stringProperty(runtime, object, "ownership")};
  }

  static std::vector<std::uint8_t> commandBytes(jsi::Runtime& runtime, const jsi::Value& value) {
    if (!value.isObject() || !value.asObject(runtime).isUint8Array(runtime)) throw jsi::JSError(runtime, "Native Protocol v1 submit requires Uint8Array");
    auto array = value.asObject(runtime).asUint8Array(runtime);
    const auto buffer = array.buffer(runtime);
    if (buffer.detached(runtime)) throw jsi::JSError(runtime, "Native Protocol v1 rejects detached command bytes");
    const auto offset = array.byteOffset(runtime);
    const auto length = array.byteLength(runtime);
    if (offset > buffer.size(runtime) || length > buffer.size(runtime) - offset || length > protocol::kMaximumControlRecordBytes) {
      throw jsi::JSError(runtime, "Native Protocol v1 command range is invalid");
    }
    const auto* source = buffer.data(runtime);
    if (length != 0U && source == nullptr) throw jsi::JSError(runtime, "Native Protocol v1 command storage is unavailable");
    return length == 0U ? std::vector<std::uint8_t>{} : std::vector<std::uint8_t>{source + offset, source + offset + length};
  }

  static jsi::Object referenceObject(jsi::Runtime& runtime, const protocol::OwnedBinaryReference& value) {
    jsi::Object result(runtime);
    result.setProperty(runtime, "ownerToken", jsi::String::createFromUtf8(runtime, value.ownerToken));
    result.setProperty(runtime, "operationCorrelation", jsi::String::createFromUtf8(runtime, value.operationCorrelation));
    result.setProperty(runtime, "byteOffset", static_cast<double>(value.byteOffset));
    result.setProperty(runtime, "byteLength", static_cast<double>(value.byteLength));
    result.setProperty(runtime, "ownership", jsi::String::createFromUtf8(runtime, value.ownership));
    return result;
  }

  jsi::Value retainFunction(jsi::Runtime& runtime, const jsi::PropNameID& name) {
    return jsi::Function::createFromHostFunction(runtime, name, 2U, [self = state_](jsi::Runtime& inner, const jsi::Value&, const jsi::Value* arguments, std::size_t count) {
      if (count != 2U || !arguments[0].isString()) throw jsi::JSError(inner, "Native Protocol v1 retain requires correlation and Uint8Array");
      if (self->closed.load(std::memory_order_acquire)) throw jsi::JSError(inner, "Native Protocol v1 runtime is closed");
      const auto retained = self->runtime->retainUint8Array(inner, arguments[0].asString(inner).utf8(inner), arguments[1]);
      return jsi::Value(inner, referenceObject(inner, retained));
    });
  }

  jsi::Value copyFunction(jsi::Runtime& runtime, const jsi::PropNameID& name) {
    return jsi::Function::createFromHostFunction(runtime, name, 1U, [self = state_](jsi::Runtime& inner, const jsi::Value&, const jsi::Value* arguments, std::size_t count) {
      if (count != 1U) throw jsi::JSError(inner, "Native Protocol v1 copy requires a binary reference");
      if (self->closed.load(std::memory_order_acquire)) throw jsi::JSError(inner, "Native Protocol v1 runtime is closed");
      return self->runtime->copyBinary(inner, binaryReference(inner, arguments[0]));
    });
  }

  jsi::Value releaseFunction(jsi::Runtime& runtime, const jsi::PropNameID& name) {
    return jsi::Function::createFromHostFunction(runtime, name, 1U, [self = state_](jsi::Runtime& inner, const jsi::Value&, const jsi::Value* arguments, std::size_t count) {
      if (count != 1U) throw jsi::JSError(inner, "Native Protocol v1 release requires a binary reference");
      if (self->closed.load(std::memory_order_acquire)) throw jsi::JSError(inner, "Native Protocol v1 runtime is closed");
      return jsi::Value(self->runtime->releaseBinary(binaryReference(inner, arguments[0])));
    });
  }

  jsi::Value submitFunction(jsi::Runtime& runtime, const jsi::PropNameID& name) {
    return jsi::Function::createFromHostFunction(runtime, name, 1U, [self = state_](jsi::Runtime& inner, const jsi::Value&, const jsi::Value* arguments, std::size_t count) {
      if (count != 1U || self->closed.load(std::memory_order_acquire)) throw jsi::JSError(inner, "Native Protocol v1 submit is unavailable");
      {
        std::scoped_lock lock(self->mutex);
        if (!self->attachmentActive || self->attachmentFatal || self->ingressClosed || !self->eventSink || !self->callInvoker) {
          throw jsi::JSError(inner, "Native Protocol v1 cannot dispatch a command before terminal delivery is admitted");
        }
      }
      const auto command = protocol::NativeProtocolV1Codec{}.decode(commandBytes(inner, arguments[0]));
      self->runtime->registerCommand(command, true);
      try {
        dispatchCommand(self, command);
      } catch (const std::exception& error) {
        fail(self, command, "invalidCommand", nil);
        throw jsi::JSError(inner, error.what());
      }
      return jsi::Value::undefined();
    });
  }

  jsi::Value sinkFunction(jsi::Runtime& runtime, const jsi::PropNameID& name) {
    return jsi::Function::createFromHostFunction(runtime, name, 1U, [self = state_](jsi::Runtime& inner, const jsi::Value&, const jsi::Value* arguments, std::size_t count) {
      if (count != 1U || !arguments[0].isObject() || !arguments[0].asObject(inner).isFunction(inner)) throw jsi::JSError(inner, "Native Protocol v1 setEventSink requires a function");
      if (self->closed.load(std::memory_order_acquire)) throw jsi::JSError(inner, "Native Protocol v1 runtime is closed");
      std::vector<std::shared_ptr<jsi::Function>> retiredSinks;
      std::vector<std::vector<std::uint8_t>> buffered;
      std::vector<BinaryReferenceList> bufferedBinaryReferences;
      try {
        std::scoped_lock lock(self->mutex);
        if (self->closed.load(std::memory_order_acquire) || self->attachmentFatal || !self->attachmentActive) {
          throw jsi::JSError(inner, "Native Protocol v1 runtime closed while installing its event sink");
        }
        if (self->eventSink) {
          self->sinksAwaitingJavaScriptRelease.push_back(std::move(self->eventSink));
        }
        retiredSinks.swap(self->sinksAwaitingJavaScriptRelease);
        self->eventSink = std::make_shared<jsi::Function>(arguments[0].asObject(inner).asFunction(inner));
        if (self->recordsAwaitingSink.overflowed()) {
          const auto& overflowSnapshot = self->recordsAwaitingSink.overflowSnapshot();
          if (!overflowSnapshot.has_value()) {
            throw jsi::JSError(inner, "Native Protocol v1 overflow accounting is unavailable");
          }
          const auto overflow = preJavaScriptEventBufferOverflow(self, *overflowSnapshot);
          self->runtime->validateEvent(overflow);
          buffered.push_back(protocol::NativeProtocolV1Codec{}.encode(overflow));
          bufferedBinaryReferences.emplace_back();
          self->ingressClosed = true;
          releaseQueuedBinaryReferences(
              self,
              self->binaryReferencesAwaitingSink,
              "Apple pre-JavaScript overflow discard");
          self->recordsAwaitingSink.reset();
        } else {
          buffered = self->recordsAwaitingSink.drain();
          bufferedBinaryReferences.swap(self->binaryReferencesAwaitingSink);
        }
        if (buffered.size() != bufferedBinaryReferences.size()) {
          throw std::logic_error("Apple pre-JavaScript event binary ownership ledger is out of sync");
        }
        const auto sink = self->eventSink;
        const auto sinkGeneration = self->attachmentGeneration;
        for (std::size_t index = 0U; index < buffered.size(); index += 1U) {
          if (
              self->closed.load(std::memory_order_acquire) ||
              !self->attachmentActive ||
              self->attachmentGeneration != sinkGeneration ||
              self->eventSink.get() != sink.get()) {
            for (std::size_t remaining = index; remaining < bufferedBinaryReferences.size(); remaining += 1U) {
              releaseAndLedgerBinaryReferences(
                  self,
                  bufferedBinaryReferences[remaining],
                  "Apple stale pre-JavaScript sink delivery discard");
            }
            bufferedBinaryReferences.clear();
            break;
          }
          try {
            jsi::Uint8Array output(inner, buffered[index].size());
            const auto buffer = output.buffer(inner);
            auto* destination = buffer.data(inner);
            if (!buffered[index].empty() && destination == nullptr) {
              throw jsi::JSError(inner, "Apple native protocol could not allocate buffered event bytes");
            }
            if (!buffered[index].empty()) std::memcpy(destination, buffered[index].data(), buffered[index].size());
            sink->call(inner, output);
          } catch (...) {
            for (std::size_t remaining = index; remaining < bufferedBinaryReferences.size(); remaining += 1U) {
              releaseAndLedgerBinaryReferences(
                  self,
                  bufferedBinaryReferences[remaining],
                  "Apple pre-JavaScript sink delivery discard");
            }
            bufferedBinaryReferences.clear();
            self->ingressClosed = true;
            throw;
          }
        }
      } catch (const std::exception& error) {
        logNativeFailure("Apple event sink installation", error);
        std::scoped_lock lock(self->mutex);
        self->ingressClosed = true;
        for (const auto& recordReferences : bufferedBinaryReferences) {
          releaseAndLedgerBinaryReferences(self, recordReferences, "Apple event sink installation discard");
        }
        bufferedBinaryReferences.clear();
        releaseQueuedBinaryReferences(
            self,
            self->binaryReferencesAwaitingSink,
            "Apple event sink installation discard");
        releaseQueuedBinaryReferences(
            self,
            self->binaryReferencesAwaitingJavaScript,
            "Apple event sink installation discard");
        self->terminalResultsAwaitingJavaScript.clear();
        self->terminalConnectionCommandsAwaitingJavaScript.clear();
        self->recordsAwaitingSink.reset();
        self->recordsAwaitingJavaScript.reset();
        failAttachmentAfterTerminalAdmissionFailure(self, "Apple event sink installation failed");
        throw;
      } catch (...) {
        NSLog(@"[UnifiedBleProtocolAppleExecution] Apple event sink installation failed with an unknown exception");
        std::scoped_lock lock(self->mutex);
        self->ingressClosed = true;
        for (const auto& recordReferences : bufferedBinaryReferences) {
          releaseAndLedgerBinaryReferences(self, recordReferences, "Apple event sink installation discard");
        }
        bufferedBinaryReferences.clear();
        releaseQueuedBinaryReferences(
            self,
            self->binaryReferencesAwaitingSink,
            "Apple event sink installation discard");
        releaseQueuedBinaryReferences(
            self,
            self->binaryReferencesAwaitingJavaScript,
            "Apple event sink installation discard");
        self->terminalResultsAwaitingJavaScript.clear();
        self->terminalConnectionCommandsAwaitingJavaScript.clear();
        self->recordsAwaitingSink.reset();
        self->recordsAwaitingJavaScript.reset();
        failAttachmentAfterTerminalAdmissionFailure(self, "Apple event sink installation failed with an unknown exception");
        throw;
      }
      return jsi::Value::undefined();
    });
  }

  jsi::Value fatalSinkFunction(jsi::Runtime& runtime, const jsi::PropNameID& name) {
    return jsi::Function::createFromHostFunction(runtime, name, 1U, [self = state_](jsi::Runtime& inner, const jsi::Value&, const jsi::Value* arguments, std::size_t count) {
      if (count != 1U || !arguments[0].isObject() || !arguments[0].asObject(inner).isFunction(inner)) {
        throw jsi::JSError(inner, "Native Protocol v1 setFatalSink requires a function");
      }
      std::scoped_lock lock(self->mutex);
      if (self->closed.load(std::memory_order_acquire) || self->attachmentFatal || !self->attachmentActive) {
        throw jsi::JSError(inner, "Native Protocol v1 attachment cannot install a fatal sink");
      }
      if (self->fatalSink) {
        self->sinksAwaitingJavaScriptRelease.push_back(std::move(self->fatalSink));
      }
      self->fatalSink = std::make_shared<jsi::Function>(arguments[0].asObject(inner).asFunction(inner));
      return jsi::Value::undefined();
    });
  }

  jsi::Value countFunction(jsi::Runtime& runtime, const jsi::PropNameID& name, bool bytes) {
    return jsi::Function::createFromHostFunction(runtime, name, 0U, [self = state_, bytes](jsi::Runtime& inner, const jsi::Value&, const jsi::Value*, std::size_t count) {
      if (count != 0U || self->closed.load(std::memory_order_acquire)) throw jsi::JSError(inner, "Native Protocol v1 retained counter is unavailable");
      return jsi::Value(static_cast<double>(bytes ? self->runtime->retainedBinaryBytes() : self->runtime->retainedBinaryPayloads()));
    });
  }
};

} // namespace

protocol::ProtocolField nativeProtocolField(std::uint16_t id, protocol::ProtocolFieldValue value) {
  return field(id, std::move(value));
}

protocol::ProtocolRecordReference nativeProtocolReference(const protocol::ProtocolRecord& record) {
  return reference(record);
}

protocol::ProtocolRecord nativeAttachmentRecord(const protocol::NativeAttachmentIdentity& attachment) {
  return attachmentRecord(attachment);
}

std::uint64_t nativeMonotonicMilliseconds() {
  return monotonicMilliseconds();
}

std::string nativeStringFromNSString(NSString* value, const char* name) {
  return nsString(value, name);
}

std::optional<AppleNativeIngressReservation> reserveNativeIngressOrdinal(
    const std::shared_ptr<AppleNativeProtocolExecution::State>& state,
    bool allowClosedIngress) {
  return state->ingressOrdinalAllocator.reserve(
      state->mutex,
      state->closed,
      state->attachmentActive,
      state->ingressClosed,
      state->attachmentGeneration,
      allowClosedIngress);
}

bool deliverNativeEvent(
    const std::shared_ptr<AppleNativeProtocolExecution::State>& state,
    const protocol::ProtocolRecord& event,
    std::uint64_t attachmentGeneration) {
  return deliverEvent(state, event, attachmentGeneration);
}

void logAppleNativeFailure(const char* context, const std::exception& error) {
  logNativeFailure(context, error);
}

AppleNativeProtocolExecution::AppleNativeProtocolExecution(
    std::shared_ptr<protocol::NativeProtocolControlRuntime> runtime,
    void* radio)
    : state_(std::make_shared<State>(std::move(runtime), radio)) {}

AppleNativeProtocolExecution::~AppleNativeProtocolExecution() {
  close();
}

void AppleNativeProtocolExecution::install(
    jsi::Runtime& runtime,
    const std::shared_ptr<facebook::react::CallInvoker>& callInvoker) {
  if (!callInvoker || state_->closed.load(std::memory_order_acquire)) {
    throw std::invalid_argument("Apple Native Protocol v1 cannot install without an active CallInvoker");
  }
  if (!runtime.global().getProperty(runtime, kRuntimeName).isUndefined()) {
    throw jsi::JSError(runtime, "A Native Protocol v1 runtime is already installed");
  }
  state_->callInvoker = callInvoker;
  runtime.global().setProperty(runtime, kRuntimeName, jsi::Object::createFromHostObject(runtime, std::make_shared<BinaryRuntime>(state_)));
}

void AppleNativeProtocolExecution::beginAttachment() {
  std::scoped_lock lock(state_->mutex);
  if (state_->closed.load(std::memory_order_acquire) || state_->attachmentActive) {
    throw std::logic_error("Apple Native Protocol v1 attachment admission is unavailable");
  }
  if (state_->attachmentGeneration == std::numeric_limits<std::uint64_t>::max()) {
    state_->ingressClosed = true;
    throw std::overflow_error("Apple Native Protocol v1 attachment generation exhausted");
  }
  state_->attachmentGeneration += 1U;
  state_->attachmentActive = true;
  state_->ingressClosed = false;
  state_->attachmentFatal = false;
  state_->ingressOrdinalAllocator.reset(state_->mutex);
  releaseQueuedBinaryReferences(
      state_,
      state_->binaryReferencesAwaitingSink,
      "Apple attachment replacement pre-JavaScript discard");
  releaseQueuedBinaryReferences(
      state_,
      state_->binaryReferencesAwaitingJavaScript,
      "Apple attachment replacement JavaScript discard");
  state_->terminalResultsAwaitingJavaScript.clear();
  state_->terminalConnectionCommandsAwaitingJavaScript.clear();
  state_->recordsAwaitingSink.reset();
  state_->recordsAwaitingJavaScript.reset();
  state_->drainScheduled = false;
}

void AppleNativeProtocolExecution::cancel(const protocol::NativeOperationIdentity& operation) {
  const auto state = state_;
  if (state->closed.load(std::memory_order_acquire)) return;
  const auto command = state->runtime->commandFor(operation.dispatchEpoch, operation.nonce);
  if (!command) return;
  [radioFor(state) cancelOperation:[NSString stringWithUTF8String:operation.nonce.c_str()] completion:^(NSDictionary* cleanup) {
    try {
      const auto cleanupState = nsString(cleanup[@"state"], "cancellation cleanup state");
      const auto cleanupFailures = [cleanup[@"failures"] isKindOfClass:[NSArray class]]
          ? static_cast<NSArray*>(cleanup[@"failures"]).count
          : 0U;
      const auto retryability = cleanupState == "released" ? "callerDecides" : "retryable";
      const auto result = failureResult(
          *command,
          "operation.aborted",
          cleanupState == "released"
              ? "Apple native operation was cancelled"
              : "Apple native operation was cancelled; radio cleanup remains retryable",
          nil,
          retryability,
          {"cleanupState=" + cleanupState, "cleanupFailureCount=" + std::to_string(cleanupFailures)});
      static_cast<void>(deliverResult(state, result));
    } catch (const std::exception& error) {
      logNativeFailure("native cancellation settlement", error);
      fail(state, *command, "operation.aborted", nil);
    }
  }];
}

void AppleNativeProtocolExecution::appendRestorationRecords(const protocol::NativeRestorationJournalAuthority& authority) {
  std::scoped_lock lock(state_->mutex);
  if (state_->restorationAppended) return;
  NSArray<NSString*>* peers = [radioFor(state_) restorationPeerIdentifiers];
  const auto adapterRecord = protocol::ProtocolRecord{.kind = protocol::RecordKind::restorationRecord, .fields = {
      field(1U, std::uint64_t{1U}), field(2U, authority.namespaceValue), field(3U, reference(attachmentRecord(authority.attachment))),
      field(4U, std::uint64_t{1U}), field(5U, authority.adoptionEpoch), field(6U, std::string("adapter"))}};
  state_->runtime->appendRestorationRecord(authority, adapterRecord);
  std::uint64_t ordinal = 2U;
  for (NSString* peer in peers) {
    const auto peerId = nsString(peer, "restored peer");
    const auto connectionPath = protocol::ProtocolRecord{
        .kind = protocol::RecordKind::connectionPath,
        .fields = {
            field(1U, reference(attachmentRecord(authority.attachment))),
            field(2U, peerId),
            field(3U, std::string("restoration-connection-") + std::to_string(ordinal)),
            field(4U, std::string("restoration-owner-") + std::to_string(ordinal)),
            field(5U, std::string("restoration-generation-") + std::to_string(ordinal)),
        },
    };
    const auto record = protocol::ProtocolRecord{.kind = protocol::RecordKind::restorationRecord, .fields = {
        field(1U, std::uint64_t{1U}), field(2U, authority.namespaceValue), field(3U, reference(attachmentRecord(authority.attachment))),
        field(4U, ordinal), field(5U, authority.adoptionEpoch), field(6U, std::string("connection")), field(7U, peerId),
        field(8U, reference(connectionPath))}};
    state_->runtime->appendRestorationRecord(authority, record);
    ordinal += 1U;
  }
  state_->restorationAppended = true;
}

void AppleNativeProtocolExecution::rollbackRestorationBootstrap() noexcept {
  std::scoped_lock lock(state_->mutex);
  state_->restorationAppended = false;
  state_->attachmentActive = false;
  state_->ingressClosed = true;
  state_->attachmentFatal = false;
  if (state_->attachmentGeneration != std::numeric_limits<std::uint64_t>::max()) {
    state_->attachmentGeneration += 1U;
  }
  state_->ingressOrdinalAllocator.reset(state_->mutex);
  releaseQueuedBinaryReferences(
      state_,
      state_->binaryReferencesAwaitingSink,
      "Apple restoration rollback pre-JavaScript discard");
  releaseQueuedBinaryReferences(
      state_,
      state_->binaryReferencesAwaitingJavaScript,
      "Apple restoration rollback JavaScript discard");
  state_->terminalResultsAwaitingJavaScript.clear();
  state_->terminalConnectionCommandsAwaitingJavaScript.clear();
  state_->recordsAwaitingSink.reset();
  state_->recordsAwaitingJavaScript.reset();
  state_->drainScheduled = false;
}

void AppleNativeProtocolExecution::detachAttachment() {
  const auto state = state_;
  if (!state || state->closed.load(std::memory_order_acquire)) return;
  std::scoped_lock lock(state->mutex);
  state->attachmentActive = false;
  state->ingressClosed = true;
  state->attachmentFatal = false;
  if (state->attachmentGeneration != std::numeric_limits<std::uint64_t>::max()) {
    state->attachmentGeneration += 1U;
  }
  releaseQueuedBinaryReferences(
      state,
      state->binaryReferencesAwaitingSink,
      "Apple attachment detach pre-JavaScript discard");
  releaseQueuedBinaryReferences(
      state,
      state->binaryReferencesAwaitingJavaScript,
      "Apple attachment detach JavaScript discard");
  state->terminalResultsAwaitingJavaScript.clear();
  state->terminalConnectionCommandsAwaitingJavaScript.clear();
  retryBinaryCleanupLedger(state, "Apple attachment detach binary cleanup retry");
  state->recordsAwaitingSink.reset();
  state->recordsAwaitingJavaScript.reset();
  state->drainScheduled = false;
  if (state->eventSink) {
    state->sinksAwaitingJavaScriptRelease.push_back(std::move(state->eventSink));
  }
  if (state->fatalSink) {
    state->sinksAwaitingJavaScriptRelease.push_back(std::move(state->fatalSink));
  }
  state->connections.clear();
  state->restorationAppended = false;
  state->ingressOrdinalAllocator.reset(state->mutex);
}

void AppleNativeProtocolExecution::receiveAdapterState(void* snapshot) {
  if (state_->closed.load(std::memory_order_acquire)) return;
  NSDictionary* value = (__bridge NSDictionary*)snapshot;
  if (![value isKindOfClass:[NSDictionary class]]) return;
  try {
    @try {
      const auto ingress = reserveNativeIngressOrdinal(state_);
      if (!ingress.has_value()) return;
      const auto ordinal = ingress->ordinal;
      const auto availability = nsString(value[@"availability"], "adapter availability");
      const auto authorization = nsString(value[@"authorization"], "adapter authorization");
      const auto power = nsString(value[@"power"], "adapter power");
      std::vector<protocol::ProtocolField> snapshotFields{
          field(1U, availability), field(2U, authorization), field(3U, power)};
      if ([value[@"safeReason"] isKindOfClass:[NSString class]]) {
        snapshotFields.push_back(field(4U, nsString(value[@"safeReason"], "adapter reason")));
      }
      const auto stateSnapshot = protocol::ProtocolRecord{
          .kind = protocol::RecordKind::adapterStateSnapshot, .fields = std::move(snapshotFields)};
      const auto event = protocol::ProtocolRecord{
          .kind = protocol::RecordKind::event,
          .fields = {
              field(1U, std::uint64_t{1U}),
              field(2U, std::string("apple-adapter-state:") + std::to_string(ordinal)),
              field(3U, std::string("adapterState")),
              field(4U, reference(attachmentRecord(state_->runtime->attachmentIdentity()))),
              field(5U, ordinal),
              field(6U, monotonicMilliseconds()),
              field(15U, reference(stateSnapshot))}};
      static_cast<void>(deliverEvent(state_, event, ingress->attachmentGeneration));
    } @catch (NSException* exception) {
      NSLog(@"[UnifiedBleProtocolAppleExecution] receiveAdapterState Objective-C serialization failed: %@", exception.reason);
    }
  } catch (const protocol::ProtocolException& error) {
    logNativeFailure("receiveAdapterState protocol serialization", error);
  } catch (const std::exception& error) {
    logNativeFailure("receiveAdapterState C++ serialization", error);
  } catch (...) {
    NSLog(@"[UnifiedBleProtocolAppleExecution] receiveAdapterState serialization failed with an unknown C++ exception");
  }
}

void AppleNativeProtocolExecution::receiveDisconnect(void* peerIdentifier, void* error) {
  if (state_->closed.load(std::memory_order_acquire)) return;
  NSString* peer = (__bridge NSString*)peerIdentifier;
  NSError* nativeError = (__bridge NSError*)error;
  if (peer == nil) return;
  try {
    const auto peerValue = nsString(peer, "disconnect peer");
    std::optional<protocol::ProtocolRecord> connection;
    {
      std::scoped_lock lock(state_->mutex);
      const auto found = state_->connections.find(peerValue);
      if (found == state_->connections.end()) return;
      connection = found->second;
      state_->connections.erase(found);
    }
    const auto ingress = reserveNativeIngressOrdinal(state_);
    if (!ingress.has_value()) return;
    const auto ordinal = ingress->ordinal;
    std::vector<protocol::ProtocolField> fields{
        field(1U, std::uint64_t{1U}), field(2U, std::string("apple-connection-lost:") + std::to_string(ordinal)),
        field(3U, std::string("connectionLost")), field(4U, reference(attachmentRecord(state_->runtime->attachmentIdentity()))),
        field(5U, ordinal), field(6U, monotonicMilliseconds()), field(7U, reference(*connection))};
    if (nativeError != nil) {
      const auto eventError = protocol::ProtocolRecord{.kind = protocol::RecordKind::error, .fields = {
          field(1U, std::string("connectionLost")), field(2U, std::string("corebluetooth")), field(3U, std::string("connectionLost")),
          field(4U, std::string("notRetryable")), field(7U, errorMessage(nativeError)), field(9U, nsString(nativeError.domain, "error domain")),
          field(10U, static_cast<std::int64_t>(nativeError.code))}};
      fields.push_back(field(14U, reference(eventError)));
    }
    static_cast<void>(deliverEvent(
        state_,
        {.kind = protocol::RecordKind::event, .fields = std::move(fields)},
        ingress->attachmentGeneration));
  } catch (const std::exception& error) {
    logNativeFailure("disconnect serialization", error);
  }
}

void AppleNativeProtocolExecution::receiveNotification(void* subscriptionIdentifier, void* value) {
  if (state_->closed.load(std::memory_order_acquire)) return;
  NSString* subscription = (__bridge NSString*)subscriptionIdentifier;
  NSData* bytes = (__bridge NSData*)value;
  if (subscription == nil || bytes == nil) return;
  std::optional<protocol::OwnedBinaryReference> output;
  try {
    const auto subscriptionValue = nsString(subscription, "subscription identifier");
    auto command = state_->runtime->subscriptionCommandFor(subscriptionValue);
    if (!command) command = state_->runtime->pendingSubscriptionCommandFor(subscriptionValue);
    if (!command) return;
    const auto ingress = reserveNativeIngressOrdinal(state_);
    if (!ingress.has_value()) return;
    const auto ordinal = ingress->ordinal;
    output = state_->runtime->retainNativeBytes(
        "apple-notification:" + subscriptionValue + ":" + std::to_string(ordinal), bytesFromData(bytes));
    const auto event = protocol::ProtocolRecord{.kind = protocol::RecordKind::event, .fields = {
        field(1U, std::uint64_t{1U}), field(2U, std::string("apple-notification:") + std::to_string(ordinal)),
        field(3U, std::string("notification")), field(4U, reference(attachmentRecord(state_->runtime->attachmentIdentity()))),
        field(5U, ordinal), field(6U, monotonicMilliseconds()), field(9U, reference(requiredRecord(*command, 4U))),
        field(10U, reference(requiredRecord(*command, 2U))), field(11U, subscriptionValue),
        field(13U, reference(binaryReferenceRecord(*output)))} };
    if (!deliverEvent(state_, event, ingress->attachmentGeneration)) {
      releaseAndLedgerBinaryReferences(state_, BinaryReferenceList{*output}, "notification binary release after non-delivery");
    }
  } catch (const std::exception& error) {
    logNativeFailure("notification serialization", error);
    if (output) {
      releaseAndLedgerBinaryReferences(state_, BinaryReferenceList{*output}, "notification binary release after delivery failure");
    }
  }
}

void AppleNativeProtocolExecution::close() {
  const auto state = state_;
  if (!state || state->closed.exchange(true, std::memory_order_acq_rel)) return;
  auto sinksToRelease = std::make_shared<std::vector<std::shared_ptr<jsi::Function>>>();
  {
    std::scoped_lock lock(state->mutex);
    state->attachmentActive = false;
    state->ingressClosed = true;
    state->attachmentFatal = true;
    if (state->attachmentGeneration != std::numeric_limits<std::uint64_t>::max()) {
      state->attachmentGeneration += 1U;
    }
    releaseQueuedBinaryReferences(
        state,
        state->binaryReferencesAwaitingSink,
        "Apple execution close pre-JavaScript discard");
    releaseQueuedBinaryReferences(
        state,
        state->binaryReferencesAwaitingJavaScript,
        "Apple execution close JavaScript discard");
    state->terminalResultsAwaitingJavaScript.clear();
    state->terminalConnectionCommandsAwaitingJavaScript.clear();
    retryBinaryCleanupLedger(state, "Apple execution close binary cleanup retry");
    state->recordsAwaitingSink.reset();
    state->recordsAwaitingJavaScript.reset();
    state->drainScheduled = false;
    sinksToRelease->swap(state->sinksAwaitingJavaScriptRelease);
    if (state->eventSink) sinksToRelease->push_back(std::move(state->eventSink));
    if (state->fatalSink) sinksToRelease->push_back(std::move(state->fatalSink));
  }
  const auto invoker = state->callInvoker;
  const auto retainUnreachableSinks = [&]() {
    std::scoped_lock lock(state->mutex);
    state->sinksAwaitingJavaScriptRelease.insert(
        state->sinksAwaitingJavaScriptRelease.end(),
        std::make_move_iterator(sinksToRelease->begin()),
        std::make_move_iterator(sinksToRelease->end()));
  };
  if (!invoker) {
    NSLog(@"[UnifiedBleProtocolAppleExecution] Apple execution close runtime-thread sink cleanup scheduling unavailable");
    retainUnreachableSinks();
    return;
  }
  try {
    invoker->invokeAsync([state, sinksToRelease](jsi::Runtime& runtime) {
      if (!runtime.global().getProperty(runtime, kRuntimeName).isUndefined()) runtime.global().deleteProperty(runtime, kRuntimeName);
      sinksToRelease->clear();
    });
  } catch (const std::exception& error) {
    logNativeFailure("Apple execution close runtime-thread sink cleanup scheduling", error);
    retainUnreachableSinks();
  } catch (...) {
    NSLog(@"[UnifiedBleProtocolAppleExecution] Apple execution close runtime-thread sink cleanup scheduling failed with an unknown exception");
    retainUnreachableSinks();
  }
}

} // namespace unified_ble::apple_protocol
