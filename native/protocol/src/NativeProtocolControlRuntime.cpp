// native/protocol/src/NativeProtocolControlRuntime.cpp

#include "../include/NativeProtocolControlRuntime.hpp"

#include <algorithm>
#include <exception>
#include <limits>
#include <utility>

namespace unified_ble::native_protocol::v1 {

namespace {

bool sameAttachment(const NativeAttachmentIdentity& left, const NativeAttachmentIdentity& right) {
  return left.attachmentId == right.attachmentId &&
      left.backendInstanceId == right.backendInstanceId &&
      left.backendGeneration == right.backendGeneration &&
      left.adapterId == right.adapterId &&
      left.adapterGeneration == right.adapterGeneration;
}

bool sameVersionRange(const VersionRange& left, const VersionRange& right) {
  return left.minimum == right.minimum && left.maximum == right.maximum;
}

bool sameRestorationAuthority(
    const NativeRestorationJournalAuthority& left,
    const NativeRestorationJournalAuthority& right) {
  return left.namespaceValue == right.namespaceValue &&
      sameAttachment(left.attachment, right.attachment) &&
      left.adoptionEpoch == right.adoptionEpoch &&
      left.authorizedClientId == right.authorizedClientId &&
      left.authorizedHostSessionScope == right.authorizedHostSessionScope &&
      sameVersionRange(left.nativeProtocol, right.nativeProtocol);
}

void validateRestorationAuthority(
    const NativeRestorationJournalAuthority& authority,
    const NativeAttachmentIdentity& activeAttachment) {
  if (!sameAttachment(authority.attachment, activeAttachment)) {
    throw ProtocolException(ProtocolFailure::stalePath, "Native restoration authority targets a stale attachment");
  }
  if (authority.namespaceValue.empty() ||
      authority.adoptionEpoch.empty() ||
      authority.authorizedClientId.empty() ||
      authority.authorizedHostSessionScope.empty()) {
    throw ProtocolException(ProtocolFailure::malformedRecord, "Native restoration authority is incomplete");
  }
  static_cast<void>(NativeProtocolV1Codec::negotiate(
      authority.nativeProtocol,
      {kAbiVersion, kAbiVersion},
      {1U, 1U},
      {1U, 1U},
      {1U, 1U},
      {1U, 1U}));
}

NativeRestorationJournalAuthority restorationAuthorityFromRequest(
    const NativeAttachmentIdentity& attachment,
    const NativeRestorationAdoptionRequest& request) {
  return {
      .namespaceValue = request.namespaceValue,
      .attachment = attachment,
      .adoptionEpoch = request.expectedEpoch,
      .authorizedClientId = request.clientId,
      .authorizedHostSessionScope = request.hostSessionScope,
      .nativeProtocol = {
          .minimum = request.nativeProtocolMinimum,
          .maximum = request.nativeProtocolMaximum,
      },
  };
}

const ProtocolField* field(const ProtocolRecord& record, std::uint16_t id) {
  const auto found = std::find_if(
      record.fields.begin(),
      record.fields.end(),
      [id](const ProtocolField& candidate) { return candidate.id == id; });
  return found == record.fields.end() ? nullptr : &*found;
}

const ProtocolRecord& requiredRecord(const ProtocolRecord& record, std::uint16_t id) {
  const auto* candidate = field(record, id);
  const auto* value = candidate == nullptr ? nullptr : std::get_if<ProtocolRecordReference>(&candidate->value);
  if (value == nullptr || !*value) {
    throw ProtocolException(ProtocolFailure::malformedRecord, "Native protocol record field is missing");
  }
  return **value;
}

const std::string& requiredString(const ProtocolRecord& record, std::uint16_t id) {
  const auto* candidate = field(record, id);
  const auto* value = candidate == nullptr ? nullptr : std::get_if<std::string>(&candidate->value);
  if (value == nullptr || value->empty()) {
    throw ProtocolException(ProtocolFailure::invalidCorrelation, "Native protocol string field is missing");
  }
  return *value;
}

std::uint64_t requiredUnsigned(const ProtocolRecord& record, std::uint16_t id) {
  const auto* candidate = field(record, id);
  const auto* value = candidate == nullptr ? nullptr : std::get_if<std::uint64_t>(&candidate->value);
  if (value == nullptr) {
    throw ProtocolException(ProtocolFailure::invalidCorrelation, "Native protocol unsigned field is missing");
  }
  return *value;
}

NativeAttachmentIdentity attachmentFromRecord(const ProtocolRecord& record) {
  if (record.kind != RecordKind::attachment) {
    throw ProtocolException(ProtocolFailure::invalidPath, "Native protocol operation attachment has an invalid kind");
  }
  return {
      .attachmentId = requiredString(record, 1U),
      .backendInstanceId = requiredString(record, 2U),
      .backendGeneration = requiredString(record, 3U),
      .adapterId = requiredString(record, 4U),
      .adapterGeneration = requiredString(record, 5U),
  };
}

NativeOperationIdentity operationFromCorrelation(const ProtocolRecord& correlation) {
  if (correlation.kind != RecordKind::operationCorrelation) {
    throw ProtocolException(ProtocolFailure::invalidCorrelation, "Native protocol operation correlation has an invalid kind");
  }
  return {
      .attachment = attachmentFromRecord(requiredRecord(correlation, 1U)),
      .dispatchEpoch = requiredUnsigned(correlation, 2U),
      .nonce = requiredString(correlation, 3U),
  };
}

bool terminalSucceeded(const ProtocolRecord& terminal) {
  if (terminal.kind != RecordKind::terminal) {
    throw ProtocolException(ProtocolFailure::malformedRecord, "Native protocol result terminal has an invalid kind");
  }
  return requiredString(terminal, 2U) == "succeeded";
}

std::string operationKey(std::uint64_t dispatchEpoch, const std::string& nonce) {
  return std::to_string(dispatchEpoch) + ":" + nonce;
}

OwnedBinaryReference binaryReferenceFromRecord(const ProtocolRecord& record) {
  if (record.kind != RecordKind::binaryReference) {
    throw ProtocolException(ProtocolFailure::invalidFieldType, "Native protocol binary reference has an invalid kind");
  }
  const auto byteOffset = requiredUnsigned(record, 2U);
  const auto byteLength = requiredUnsigned(record, 3U);
  if (byteOffset > std::numeric_limits<std::size_t>::max() ||
      byteLength > std::numeric_limits<std::size_t>::max()) {
    throw ProtocolException(ProtocolFailure::payloadTooLarge, "Native protocol binary reference exceeds the native address range");
  }
  return {
      .ownerToken = requiredString(record, 1U),
      .operationCorrelation = requiredString(record, 5U),
      .byteOffset = static_cast<std::size_t>(byteOffset),
      .byteLength = static_cast<std::size_t>(byteLength),
      .ownership = requiredString(record, 4U),
  };
}

} // namespace

NativeProtocolControlRuntime::NativeProtocolControlRuntime()
    : binaryTransport_(std::make_unique<OwnedJsiBinaryTransport>()) {}

NativeProtocolControlRuntime::~NativeProtocolControlRuntime() {
  if (binaryTransport_) {
    binaryTransport_->close();
  }
}

NegotiatedVersions NativeProtocolControlRuntime::handshake(
    const NativeAttachmentIdentity& attachment,
    const std::string& ownerId,
    VersionRange nativeProtocol,
    VersionRange abi,
    VersionRange backendContract,
    VersionRange capabilitySchema,
    VersionRange eventSchema,
    VersionRange traceFormat) {
  if (ownerId.empty()) {
    throw ProtocolException(ProtocolFailure::invalidPath, "Native protocol owner is empty");
  }
  const auto versions = NativeProtocolV1Codec::negotiate(
      nativeProtocol,
      abi,
      backendContract,
      capabilitySchema,
      eventSchema,
      traceFormat);
  if (operations_) {
    if (!sameAttachment(attachment_, attachment) || ownerId_ != ownerId) {
      throw ProtocolException(ProtocolFailure::stalePath, "A different attachment already owns the native protocol");
    }
    return versions;
  }
  attachment_ = attachment;
  ownerId_ = ownerId;
  if (!binaryTransport_) {
    binaryTransport_ = std::make_unique<OwnedJsiBinaryTransport>();
  }
  operations_ = std::make_unique<NativeOperationRegistry>(attachment_);
  {
    std::scoped_lock lock(commandMutex_);
    pendingCommands_.clear();
    activeSubscriptionCommands_.clear();
    activeScanCommand_.reset();
  }
  return versions;
}

NativeCancellationState NativeProtocolControlRuntime::cancel(
    const NativeOperationIdentity& operation) {
  if (!operations_) {
    throw ProtocolException(ProtocolFailure::alreadyTerminal, "Native protocol attachment is closed");
  }
  return operations_->cancel(operation);
}

RestorationAdoptionReceipt NativeProtocolControlRuntime::adopt(
    const NativeRestorationAdoptionRequest& request) {
  if (!operations_) {
    throw ProtocolException(ProtocolFailure::alreadyTerminal, "Native protocol attachment is closed");
  }
  if (!restoration_) {
    const auto authority = restorationAuthorityFromRequest(attachment_, request);
    validateRestorationAuthority(authority, attachment_);
    restoration_ = std::make_unique<NativeRestorationJournal>(
        authority.namespaceValue,
        authority.attachment,
        authority.adoptionEpoch,
        authority.authorizedClientId,
        authority.authorizedHostSessionScope,
        1024U,
        kMaximumControlRecordBytes);
    restorationAuthority_ = authority;
  }
  return restoration_->adopt(request);
}

void NativeProtocolControlRuntime::appendRestorationRecord(
    const NativeRestorationJournalAuthority& authority,
    ProtocolRecord record) {
  if (!operations_) {
    throw ProtocolException(ProtocolFailure::alreadyTerminal, "Native protocol attachment is closed");
  }
  validateRestorationAuthority(authority, attachment_);
  NativeProtocolV1Codec{}.validate(record);
  if (!restoration_) {
    restoration_ = std::make_unique<NativeRestorationJournal>(
        authority.namespaceValue,
        authority.attachment,
        authority.adoptionEpoch,
        authority.authorizedClientId,
        authority.authorizedHostSessionScope,
        1024U,
        kMaximumControlRecordBytes);
    restorationAuthority_ = authority;
  } else if (!restorationAuthority_.has_value() ||
      !sameRestorationAuthority(*restorationAuthority_, authority) ||
      !restoration_->matchesAuthority(authority)) {
    throw ProtocolException(
        ProtocolFailure::stalePath,
        "Native restoration append authority does not match the owned journal");
  }
  restoration_->append(std::move(record));
}

void NativeProtocolControlRuntime::registerCommand(const ProtocolRecord& command, bool cancellable) {
  if (!operations_) {
    throw ProtocolException(ProtocolFailure::alreadyTerminal, "Native protocol attachment is closed");
  }
  NativeProtocolV1Codec{}.validate(command);
  if (command.kind != RecordKind::command) {
    throw ProtocolException(ProtocolFailure::invalidFieldType, "Native protocol dispatch requires a command record");
  }
  const auto operation = operationFromCorrelation(requiredRecord(command, 2U));
  operations_->registerOperation(operation, cancellable);
  try {
    if (const auto* inputBinary = field(command, 6U); inputBinary != nullptr) {
      const auto* inputReference = std::get_if<ProtocolRecordReference>(&inputBinary->value);
      if (inputReference == nullptr || !*inputReference || !binaryTransport_) {
        throw ProtocolException(ProtocolFailure::invalidFieldType, "Native protocol command binary reference is malformed");
      }
      static_cast<void>(binaryTransport_->copyForNative(binaryReferenceFromRecord(**inputReference)));
    }
    std::scoped_lock lock(commandMutex_);
    pendingCommands_.emplace(operationKey(operation.dispatchEpoch, operation.nonce), command);
  } catch (...) {
    static_cast<void>(operations_->settle(operation, NativeOperationState::failed));
    throw;
  }
}

bool NativeProtocolControlRuntime::rejectCommandDispatch(const ProtocolRecord& command) {
  if (!operations_) {
    return false;
  }
  const auto operation = operationFromCorrelation(requiredRecord(command, 2U));
  const auto key = operationKey(operation.dispatchEpoch, operation.nonce);
  std::optional<ProtocolRecord> pendingCommand;
  {
    std::scoped_lock lock(commandMutex_);
    const auto pending = pendingCommands_.find(key);
    if (pending == pendingCommands_.end()) {
      return false;
    }
    pendingCommand = pending->second;
  }
  if (!operations_->settle(operation, NativeOperationState::failed)) {
    return false;
  }
  std::optional<OwnedBinaryReference> inputBinary;
  if (const auto* binaryField = field(*pendingCommand, 6U); binaryField != nullptr) {
    const auto* binaryRecord = std::get_if<ProtocolRecordReference>(&binaryField->value);
    if (binaryRecord == nullptr || !*binaryRecord) {
      throw ProtocolException(ProtocolFailure::invalidFieldType, "Native protocol command binary reference is malformed");
    }
    inputBinary = binaryReferenceFromRecord(**binaryRecord);
  }
  {
    std::scoped_lock lock(commandMutex_);
    pendingCommands_.erase(key);
  }
  if (inputBinary && binaryTransport_ && !binaryTransport_->release(*inputBinary)) {
    throw ProtocolException(ProtocolFailure::invalidCorrelation, "Native protocol command binary was already released");
  }
  return true;
}

bool NativeProtocolControlRuntime::settleResult(const ProtocolRecord& result) {
  if (!operations_) {
    return false;
  }
  NativeProtocolV1Codec{}.validate(result);
  if (result.kind != RecordKind::result) {
    throw ProtocolException(ProtocolFailure::invalidFieldType, "Native protocol settlement requires a result record");
  }
  const auto& terminal = requiredRecord(result, 3U);
  const auto operation = operationFromCorrelation(requiredRecord(terminal, 1U));
  const bool terminalIsSuccess = terminalSucceeded(terminal);
  const auto key = operationKey(operation.dispatchEpoch, operation.nonce);
  const auto* resultKind = field(result, 2U);
  const auto* kind = resultKind == nullptr ? nullptr : std::get_if<std::string>(&resultKind->value);
  std::optional<ProtocolRecord> pendingCommand;
  {
    std::scoped_lock lock(commandMutex_);
    const auto command = pendingCommands_.find(key);
    if (command != pendingCommands_.end()) {
      pendingCommand = command->second;
    }
  }
  std::optional<std::string> subscriptionId;
  if (terminalIsSuccess && pendingCommand && kind != nullptr && (*kind == "subscribed" || *kind == "unsubscribed")) {
    subscriptionId = requiredString(*pendingCommand, 7U);
  }
  std::optional<OwnedBinaryReference> inputBinary;
  if (pendingCommand) {
    const auto* binaryField = field(*pendingCommand, 6U);
    if (binaryField != nullptr) {
      const auto* binaryRecord = std::get_if<ProtocolRecordReference>(&binaryField->value);
      if (binaryRecord == nullptr || !*binaryRecord) {
        throw ProtocolException(ProtocolFailure::invalidFieldType, "Native protocol command binary reference is malformed");
      }
      inputBinary = binaryReferenceFromRecord(**binaryRecord);
    }
  }
  const bool settled = operations_->settle(
      operation,
      terminalIsSuccess ? NativeOperationState::succeeded : NativeOperationState::failed);
  if (settled) {
    std::scoped_lock lock(commandMutex_);
    if (pendingCommand && kind != nullptr && subscriptionId) {
      if (*kind == "subscribed") {
        activeSubscriptionCommands_.insert_or_assign(*subscriptionId, *pendingCommand);
      } else if (*kind == "unsubscribed") {
        activeSubscriptionCommands_.erase(*subscriptionId);
      }
    }
    if (pendingCommand && terminalIsSuccess) {
      const auto& commandKind = requiredString(*pendingCommand, 3U);
      if (commandKind == "scanStart" && kind != nullptr && *kind == "scanStarted") {
        activeScanCommand_ = *pendingCommand;
      } else if (commandKind == "scanStop" || commandKind == "destroy") {
        activeScanCommand_.reset();
      }
    }
    pendingCommands_.erase(key);
    if (inputBinary && binaryTransport_) {
      static_cast<void>(binaryTransport_->release(*inputBinary));
    }
  }
  return settled;
}

std::optional<ProtocolRecord> NativeProtocolControlRuntime::commandFor(
    std::uint64_t dispatchEpoch,
    const std::string& nonce) const {
  std::scoped_lock lock(commandMutex_);
  const auto found = pendingCommands_.find(operationKey(dispatchEpoch, nonce));
  if (found == pendingCommands_.end()) {
    return std::nullopt;
  }
  return found->second;
}

std::optional<ProtocolRecord> NativeProtocolControlRuntime::subscriptionCommandFor(
    const std::string& subscriptionId) const {
  std::scoped_lock lock(commandMutex_);
  const auto found = activeSubscriptionCommands_.find(subscriptionId);
  if (found == activeSubscriptionCommands_.end()) {
    return std::nullopt;
  }
  return found->second;
}

std::optional<ProtocolRecord> NativeProtocolControlRuntime::pendingSubscriptionCommandFor(
    const std::string& subscriptionId) const {
  std::scoped_lock lock(commandMutex_);
  for (const auto& entry : pendingCommands_) {
    if (requiredString(entry.second, 3U) == "subscribe" &&
        requiredString(entry.second, 7U) == subscriptionId) {
      return entry.second;
    }
  }
  return std::nullopt;
}

std::optional<ProtocolRecord> NativeProtocolControlRuntime::activeScanCommand() const {
  std::scoped_lock lock(commandMutex_);
  return activeScanCommand_;
}

NativeAttachmentIdentity NativeProtocolControlRuntime::attachmentIdentity() const {
  if (!operations_) {
    throw ProtocolException(ProtocolFailure::alreadyTerminal, "Native protocol attachment is closed");
  }
  return attachment_;
}

std::vector<std::uint8_t> NativeProtocolControlRuntime::consumeCommandBinary(
    const ProtocolRecord& command) {
  if (!operations_ || !binaryTransport_) {
    throw ProtocolException(ProtocolFailure::alreadyTerminal, "Native protocol attachment is closed");
  }
  if (command.kind != RecordKind::command) {
    throw ProtocolException(ProtocolFailure::invalidFieldType, "Only a command can own an input binary reference");
  }
  return binaryTransport_->takeForNative(binaryReferenceFromRecord(requiredRecord(command, 6U)));
}

OwnedBinaryReference NativeProtocolControlRuntime::retainNativeBytes(
    const std::string& operationCorrelation,
    const std::vector<std::uint8_t>& bytes) {
  if (!operations_ || !binaryTransport_) {
    throw ProtocolException(ProtocolFailure::alreadyTerminal, "Native protocol attachment is closed");
  }
  return binaryTransport_->retainCopy(
      operationCorrelation,
      BorrowedByteView{.data = bytes.empty() ? nullptr : bytes.data(), .size = bytes.size()});
}

void NativeProtocolControlRuntime::validateEvent(const ProtocolRecord& event) const {
  if (!operations_) {
    throw ProtocolException(ProtocolFailure::alreadyTerminal, "Native protocol attachment is closed");
  }
  NativeProtocolV1Codec{}.validate(event);
  if (event.kind != RecordKind::event) {
    throw ProtocolException(ProtocolFailure::invalidFieldType, "Native protocol delivery requires an event record");
  }
}

OwnedBinaryReference NativeProtocolControlRuntime::retainUint8Array(
    facebook::jsi::Runtime& runtime,
    const std::string& operationCorrelation,
    const facebook::jsi::Value& value) {
  if (!operations_ || !binaryTransport_) {
    throw ProtocolException(ProtocolFailure::alreadyTerminal, "Native protocol attachment is closed");
  }
  return binaryTransport_->retainUint8Array(runtime, operationCorrelation, value);
}

facebook::jsi::Value NativeProtocolControlRuntime::copyBinary(
    facebook::jsi::Runtime& runtime,
    const OwnedBinaryReference& reference) const {
  if (!operations_ || !binaryTransport_) {
    throw ProtocolException(ProtocolFailure::alreadyTerminal, "Native protocol attachment is closed");
  }
  return binaryTransport_->deliverUint8ArrayCopy(runtime, reference);
}

bool NativeProtocolControlRuntime::releaseBinary(const OwnedBinaryReference& reference) {
  if (!operations_ || !binaryTransport_) {
    throw ProtocolException(ProtocolFailure::alreadyTerminal, "Native protocol attachment is closed");
  }
  return binaryTransport_->release(reference);
}

std::size_t NativeProtocolControlRuntime::retainedBinaryBytes() const {
  if (!operations_ || !binaryTransport_) {
    return 0U;
  }
  return binaryTransport_->retainedBytes();
}

std::size_t NativeProtocolControlRuntime::retainedBinaryPayloads() const {
  if (!operations_ || !binaryTransport_) {
    return 0U;
  }
  return binaryTransport_->retainedPayloads();
}

void NativeProtocolControlRuntime::rollbackRestorationBootstrap(
    const NativeAttachmentIdentity& attachment) noexcept {
  if (!operations_) {
    return;
  }
  if (!sameAttachment(attachment_, attachment)) {
    std::terminate();
  }
  close(attachment);
}

void NativeProtocolControlRuntime::close(const NativeAttachmentIdentity& attachment) {
  if (!operations_ || !sameAttachment(attachment_, attachment)) {
    throw ProtocolException(ProtocolFailure::stalePath, "Native protocol close targets a stale attachment");
  }
  binaryTransport_->close();
  binaryTransport_.reset();
  restoration_.reset();
  restorationAuthority_.reset();
  operations_.reset();
  {
    std::scoped_lock lock(commandMutex_);
    pendingCommands_.clear();
    activeSubscriptionCommands_.clear();
    activeScanCommand_.reset();
  }
  attachment_ = {};
  ownerId_.clear();
}

bool NativeProtocolControlRuntime::open() const {
  return operations_ != nullptr;
}

const char* cancellationStateName(NativeCancellationState state) {
  switch (state) {
    case NativeCancellationState::cancellationRequested:
      return "cancellationRequested";
    case NativeCancellationState::alreadyTerminal:
      return "alreadyTerminal";
    case NativeCancellationState::notCancellable:
      return "notCancellable";
  }
  throw ProtocolException(ProtocolFailure::malformedRecord, "Native cancellation state is unknown");
}

const char* restorationOutcomeName(NativeRestorationOutcome outcome) {
  switch (outcome) {
    case NativeRestorationOutcome::adopted:
      return "adopted";
    case NativeRestorationOutcome::alreadyConsumed:
      return "alreadyConsumed";
    case NativeRestorationOutcome::attachmentMismatch:
      return "attachmentMismatch";
    case NativeRestorationOutcome::backendMismatch:
      return "backendMismatch";
    case NativeRestorationOutcome::namespaceMismatch:
      return "namespaceMismatch";
    case NativeRestorationOutcome::epochMismatch:
      return "epochMismatch";
  }
  throw ProtocolException(ProtocolFailure::malformedRecord, "Native restoration outcome is unknown");
}

} // namespace unified_ble::native_protocol::v1
