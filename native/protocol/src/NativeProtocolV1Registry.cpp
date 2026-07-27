// native/protocol/src/NativeProtocolV1Registry.cpp

#include "../include/NativeProtocolV1Registry.hpp"

#include <algorithm>
#include <atomic>
#include <limits>
#include <utility>

namespace unified_ble::native_protocol::v1 {

namespace {

std::atomic<std::uint64_t> nextRestorationReceipt{1U};

bool sameAttachment(const NativeAttachmentIdentity& left, const NativeAttachmentIdentity& right) {
  return left.attachmentId == right.attachmentId &&
      left.backendInstanceId == right.backendInstanceId &&
      left.backendGeneration == right.backendGeneration &&
      left.adapterId == right.adapterId &&
      left.adapterGeneration == right.adapterGeneration;
}

void validateAttachment(const NativeAttachmentIdentity& attachment) {
  if (attachment.attachmentId.empty() ||
      attachment.backendInstanceId.empty() ||
      attachment.backendGeneration.empty() ||
      attachment.adapterId.empty() ||
      attachment.adapterGeneration.empty()) {
    throw ProtocolException(ProtocolFailure::invalidPath, "Native attachment identity is incomplete");
  }
}

const ProtocolField* protocolField(const ProtocolRecord& record, std::uint16_t id) {
  const auto found = std::find_if(
      record.fields.begin(),
      record.fields.end(),
      [id](const ProtocolField& candidate) { return candidate.id == id; });
  return found == record.fields.end() ? nullptr : &*found;
}

const std::string& requiredString(const ProtocolRecord& record, std::uint16_t id) {
  const auto* candidate = protocolField(record, id);
  const auto* value = candidate == nullptr ? nullptr : std::get_if<std::string>(&candidate->value);
  if (value == nullptr) {
    throw ProtocolException(ProtocolFailure::malformedRecord, "Restoration authority string is missing");
  }
  return *value;
}

std::uint64_t requiredUnsigned(const ProtocolRecord& record, std::uint16_t id) {
  const auto* candidate = protocolField(record, id);
  const auto* value = candidate == nullptr ? nullptr : std::get_if<std::uint64_t>(&candidate->value);
  if (value == nullptr) {
    throw ProtocolException(ProtocolFailure::malformedRecord, "Restoration authority ordinal is missing");
  }
  return *value;
}

const ProtocolRecord& requiredRecord(const ProtocolRecord& record, std::uint16_t id) {
  const auto* candidate = protocolField(record, id);
  const auto* value = candidate == nullptr ? nullptr : std::get_if<ProtocolRecordReference>(&candidate->value);
  if (value == nullptr || !*value) {
    throw ProtocolException(ProtocolFailure::malformedRecord, "Restoration authority record is missing");
  }
  return **value;
}

NativeAttachmentIdentity attachmentIdentity(const ProtocolRecord& record) {
  return {
      .attachmentId = requiredString(record, 1U),
      .backendInstanceId = requiredString(record, 2U),
      .backendGeneration = requiredString(record, 3U),
      .adapterId = requiredString(record, 4U),
      .adapterGeneration = requiredString(record, 5U),
  };
}

void requireNestedAttachment(
    const ProtocolRecord& record,
    const NativeAttachmentIdentity& expected) {
  const ProtocolRecord* cursor = &record;
  while (cursor->kind != RecordKind::attachment) {
    const auto* candidate = protocolField(*cursor, 1U);
    const auto* nested = candidate == nullptr ? nullptr : std::get_if<ProtocolRecordReference>(&candidate->value);
    if (nested == nullptr || !*nested) {
      return;
    }
    cursor = nested->get();
  }
  if (!sameAttachment(attachmentIdentity(*cursor), expected)) {
    throw ProtocolException(ProtocolFailure::stalePath, "Restoration record contains a stale nested attachment");
  }
}

} // namespace

NativeOperationRegistry::NativeOperationRegistry(
    NativeAttachmentIdentity attachment,
    std::size_t maximumOperations)
    : attachment_(std::move(attachment)), maximumOperations_(maximumOperations) {
  validateAttachment(attachment_);
  if (maximumOperations_ == 0U) {
    throw ProtocolException(ProtocolFailure::payloadTooLarge, "Native operation registry capacity must be positive");
  }
}

void NativeOperationRegistry::registerOperation(
    const NativeOperationIdentity& operation,
    bool cancellable) {
  std::scoped_lock lock(mutex_);
  requireCurrent(operation);
  if (operation.dispatchEpoch != nextDispatchEpoch_ || operation.nonce.empty()) {
    throw ProtocolException(ProtocolFailure::invalidCorrelation, "Native operation correlation is incomplete");
  }
  const auto operationKey = key(operation);
  if (pending_.contains(operationKey)) {
    throw ProtocolException(ProtocolFailure::invalidCorrelation, "Native operation correlation was already used");
  }
  if (pending_.size() >= maximumOperations_) {
    throw ProtocolException(ProtocolFailure::payloadTooLarge, "Native operation registry capacity is exhausted");
  }
  if (nextDispatchEpoch_ == std::numeric_limits<std::uint64_t>::max()) {
    throw ProtocolException(ProtocolFailure::invalidCorrelation, "Native operation dispatch epoch is exhausted");
  }
  pending_.emplace(
      operationKey,
      PendingOperation{.cancellable = cancellable, .state = NativeOperationState::registered});
  nextDispatchEpoch_ += 1U;
}

NativeCancellationState NativeOperationRegistry::cancel(const NativeOperationIdentity& operation) {
  std::scoped_lock lock(mutex_);
  requireCurrent(operation);
  const auto operationKey = key(operation);
  const auto found = pending_.find(operationKey);
  if (found == pending_.end()) {
    if (operation.dispatchEpoch < nextDispatchEpoch_) {
      return NativeCancellationState::alreadyTerminal;
    }
    throw ProtocolException(ProtocolFailure::invalidCorrelation, "Native cancellation correlation is unknown");
  }
  if (!found->second.cancellable) {
    return NativeCancellationState::notCancellable;
  }
  found->second.state = NativeOperationState::cancellationRequested;
  return NativeCancellationState::cancellationRequested;
}

bool NativeOperationRegistry::settle(
    const NativeOperationIdentity& operation,
    NativeOperationState terminal) {
  if (terminal != NativeOperationState::succeeded && terminal != NativeOperationState::failed) {
    throw ProtocolException(ProtocolFailure::malformedRecord, "Native operation settlement requires a terminal state");
  }
  std::scoped_lock lock(mutex_);
  requireCurrent(operation);
  const auto operationKey = key(operation);
  const auto found = pending_.find(operationKey);
  if (found == pending_.end()) {
    return false;
  }
  pending_.erase(found);
  return true;
}

bool NativeOperationRegistry::acceptsLateCallback(
    const NativeOperationIdentity& operation) const {
  std::scoped_lock lock(mutex_);
  if (!sameAttachment(operation.attachment, attachment_)) {
    return false;
  }
  return pending_.contains(key(operation));
}

void NativeOperationRegistry::invalidate(NativeAttachmentIdentity replacement) {
  validateAttachment(replacement);
  std::scoped_lock lock(mutex_);
  if (sameAttachment(replacement, attachment_)) {
    throw ProtocolException(ProtocolFailure::stalePath, "Native attachment replacement must advance identity");
  }
  attachment_ = std::move(replacement);
  pending_.clear();
}

std::size_t NativeOperationRegistry::pendingCount() const {
  std::scoped_lock lock(mutex_);
  return pending_.size();
}

void NativeOperationRegistry::requireCurrent(const NativeOperationIdentity& operation) const {
  if (!sameAttachment(operation.attachment, attachment_)) {
    throw ProtocolException(ProtocolFailure::stalePath, "Native operation belongs to a stale attachment generation");
  }
}

std::string NativeOperationRegistry::key(const NativeOperationIdentity& operation) {
  return std::to_string(operation.dispatchEpoch) + ":" + operation.nonce;
}

NativeRestorationJournal::NativeRestorationJournal(
    std::string namespaceValue,
    NativeAttachmentIdentity attachment,
    std::string adoptionEpoch,
    std::string authorizedClientId,
    std::string authorizedHostSessionScope,
    std::size_t recordCapacity,
    std::size_t byteCapacity)
    : namespace_(std::move(namespaceValue)),
      attachment_(std::move(attachment)),
      adoptionEpoch_(std::move(adoptionEpoch)),
      authorizedClientId_(std::move(authorizedClientId)),
      authorizedHostSessionScope_(std::move(authorizedHostSessionScope)),
      recordCapacity_(recordCapacity),
      byteCapacity_(byteCapacity) {
  validateAttachment(attachment_);
  if (namespace_.empty() ||
      adoptionEpoch_.empty() ||
      authorizedClientId_.empty() ||
      authorizedHostSessionScope_.empty() ||
      recordCapacity_ == 0U ||
      byteCapacity_ == 0U) {
    throw ProtocolException(ProtocolFailure::malformedRecord, "Native restoration journal configuration is invalid");
  }
}

void NativeRestorationJournal::append(ProtocolRecord record) {
  if (record.kind != RecordKind::restorationRecord) {
    throw ProtocolException(ProtocolFailure::invalidFieldType, "Restoration journal accepts restoration records only");
  }
  const auto encoded = codec_.encode(record);
  std::scoped_lock lock(mutex_);
  if (consumed_) {
    throw ProtocolException(ProtocolFailure::restorationConsumed, "Restoration journal was already consumed");
  }
  if (records_.size() >= recordCapacity_ ||
      encoded.size() > byteCapacity_ ||
      encoded.size() > byteCapacity_ - retainedBytes_) {
    throw ProtocolException(ProtocolFailure::payloadTooLarge, "Restoration journal capacity is exhausted");
  }
  if (requiredString(record, 2U) != namespace_ ||
      !sameAttachment(attachmentIdentity(requiredRecord(record, 3U)), attachment_) ||
      requiredUnsigned(record, 4U) != nextOrdinal_ ||
      requiredString(record, 5U) != adoptionEpoch_) {
    throw ProtocolException(ProtocolFailure::stalePath, "Restoration record authority does not match its journal");
  }
  for (const auto fieldId : {8U, 9U, 11U}) {
    const auto* candidate = protocolField(record, fieldId);
    const auto* nested = candidate == nullptr ? nullptr : std::get_if<ProtocolRecordReference>(&candidate->value);
    if (nested != nullptr && *nested) {
      requireNestedAttachment(**nested, attachment_);
    }
  }
  records_.push_back(RestorationJournalEntry{
      .ordinal = nextOrdinal_,
      .namespaceValue = namespace_,
      .attachment = attachment_,
      .adoptionEpoch = adoptionEpoch_,
      .record = std::move(record),
  });
  nextOrdinal_ += 1U;
  retainedBytes_ += encoded.size();
}

RestorationAdoptionReceipt NativeRestorationJournal::adopt(
    const NativeRestorationAdoptionRequest& request) {
  std::scoped_lock lock(mutex_);
  if (consumed_) {
    return {
        .receiptId = "",
        .outcome = NativeRestorationOutcome::alreadyConsumed,
        .boundClientId = authorizedClientId_,
        .records = {},
    };
  }
  if (request.namespaceValue != namespace_) {
    return {.receiptId = "", .outcome = NativeRestorationOutcome::namespaceMismatch, .boundClientId = "", .records = {}};
  }
  if (request.attachmentId != attachment_.attachmentId) {
    return {.receiptId = "", .outcome = NativeRestorationOutcome::attachmentMismatch, .boundClientId = "", .records = {}};
  }
  if (request.expectedBackendInstanceId != attachment_.backendInstanceId) {
    return {.receiptId = "", .outcome = NativeRestorationOutcome::backendMismatch, .boundClientId = "", .records = {}};
  }
  if (request.expectedEpoch != adoptionEpoch_) {
    return {.receiptId = "", .outcome = NativeRestorationOutcome::epochMismatch, .boundClientId = "", .records = {}};
  }
  if (request.clientId != authorizedClientId_ ||
      request.hostSessionScope != authorizedHostSessionScope_) {
    throw ProtocolException(ProtocolFailure::stalePath, "Restoration adoption client or host session is unauthorized");
  }
  static_cast<void>(NativeProtocolV1Codec::negotiate(
      {request.nativeProtocolMinimum, request.nativeProtocolMaximum},
      {kAbiVersion, kAbiVersion},
      {1U, 1U},
      {1U, 1U},
      {1U, 1U},
      {1U, 1U}));
  consumed_ = true;
  const auto receiptNumber = nextRestorationReceipt.fetch_add(1U, std::memory_order_relaxed);
  auto adoptedRecords = std::move(records_);
  retainedBytes_ = 0U;
  return {
      .receiptId = "restoration-receipt-" + std::to_string(receiptNumber),
      .outcome = NativeRestorationOutcome::adopted,
      .boundClientId = authorizedClientId_,
      .records = std::move(adoptedRecords),
  };
}

bool NativeRestorationJournal::matchesAuthority(
    const NativeRestorationJournalAuthority& authority) const {
  std::scoped_lock lock(mutex_);
  return authority.namespaceValue == namespace_ &&
      sameAttachment(authority.attachment, attachment_) &&
      authority.adoptionEpoch == adoptionEpoch_ &&
      authority.authorizedClientId == authorizedClientId_ &&
      authority.authorizedHostSessionScope == authorizedHostSessionScope_;
}

bool NativeRestorationJournal::consumed() const {
  std::scoped_lock lock(mutex_);
  return consumed_;
}

std::size_t NativeRestorationJournal::size() const {
  std::scoped_lock lock(mutex_);
  return records_.size();
}

} // namespace unified_ble::native_protocol::v1
