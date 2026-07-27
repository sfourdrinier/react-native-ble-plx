// spikes/rn-jsi-binary/native/src/Ub4JsiBinaryProtocol.cpp

#include "Ub4JsiBinaryProtocol.h"

#include <array>
#include <atomic>
#include <iomanip>
#include <sstream>
#include <utility>

namespace ub4::rnjsispike {

namespace {

std::atomic<std::uint64_t> nextNonce{1U};

} // namespace

ProtocolError::ProtocolError(ProtocolErrorCode code, const char* message)
    : std::runtime_error(message), code_(code) {}

ProtocolErrorCode ProtocolError::code() const noexcept {
  return code_;
}

BinaryProtocol::BinaryProtocol(AttachmentTuple attachment, std::size_t maximumPayloadBytes)
    : attachment_(std::move(attachment)), maximumPayloadBytes_(maximumPayloadBytes) {
  if (attachment_.runtimeAttachment.empty() || attachment_.owner.empty() || attachment_.backendGeneration == 0U) {
    throw ProtocolError(ProtocolErrorCode::invalidInput, "A binary binding requires a complete runtime attachment");
  }
  if (maximumPayloadBytes_ == 0U) {
    throw ProtocolError(ProtocolErrorCode::invalidInput, "A binary binding requires a positive payload limit");
  }
}

HandshakeResult BinaryProtocol::activate(const HandshakeOffer& offer) {
  std::scoped_lock lock(mutex_);
  if (handshakeComplete_) {
    throw ProtocolError(ProtocolErrorCode::duplicateHandshake, "The binary binding handshake is already complete");
  }
  if (offer.owner.empty() || offer.owner != attachment_.owner || offer.backendGeneration != attachment_.backendGeneration) {
    throw ProtocolError(ProtocolErrorCode::invalidInput, "The handshake attachment does not match this runtime binding");
  }

  const HandshakeResult result{
      .nativeProtocol = selectVersion(offer.nativeProtocol, kBinaryProtocolVersion, "native protocol"),
      .abi = selectVersion(offer.abi, kBinaryProtocolAbiVersion, "ABI"),
      .backendContract = selectVersion(offer.backendContract, kBackendContractVersion, "backend contract"),
      .capabilitySchema = selectVersion(offer.capabilitySchema, kCapabilitySchemaVersion, "capability schema"),
      .eventSchema = selectVersion(offer.eventSchema, kEventSchemaVersion, "event schema"),
      .traceFormat = selectVersion(offer.traceFormat, kTraceFormatVersion, "trace format"),
      .maximumPayloadBytes = maximumPayloadBytes_,
  };
  handshakeComplete_ = true;
  active_ = true;
  return result;
}

OperationReference BinaryProtocol::submit(ByteView payload) {
  std::scoped_lock lock(mutex_);
  requireActiveLocked();
  if (pendingRequests_.size() >= kMaximumPendingRequests) {
    throw ProtocolError(ProtocolErrorCode::tooManyPendingRequests, "Too many pending binary protocol requests");
  }

  const auto correlation = std::make_shared<OperationCorrelation>(OperationCorrelation{
      .attachment = attachment_,
      .dispatchEpoch = nextDispatchEpoch_,
      .nonce = createNonce(),
  });
  nextDispatchEpoch_ += 1U;
  const auto [_, inserted] = pendingRequests_.emplace(
      correlation->nonce,
      PendingRequest{.correlation = correlation, .payload = copyPayload(payload)});
  if (!inserted) {
    throw ProtocolError(ProtocolErrorCode::invalidCorrelation, "The binary binding generated a duplicate operation correlation");
  }
  return correlation;
}

std::optional<std::vector<std::uint8_t>> BinaryProtocol::copyPendingPayload(const OperationReference& operation) const {
  std::scoped_lock lock(mutex_);
  requireActiveLocked();
  requireOwnedCorrelationLocked(operation);
  const auto pendingRequest = pendingRequests_.find(operation->nonce);
  if (pendingRequest == pendingRequests_.end()) {
    return std::nullopt;
  }

  return pendingRequest->second.payload;
}

bool BinaryProtocol::settleComplete(const OperationReference& operation) {
  std::scoped_lock lock(mutex_);
  requireActiveLocked();
  requireOwnedCorrelationLocked(operation);
  return pendingRequests_.erase(operation->nonce) == 1U;
}

bool BinaryProtocol::cancel(const OperationReference& operation) {
  std::scoped_lock lock(mutex_);
  requireActiveLocked();
  requireOwnedCorrelationLocked(operation);
  return pendingRequests_.erase(operation->nonce) == 1U;
}

std::optional<NativeNotification> BinaryProtocol::prepareNativeNotification(
    const OperationReference& operation,
    ByteView payload) {
  std::scoped_lock lock(mutex_);
  requireActiveLocked();
  if (operation) {
    requireOwnedCorrelationLocked(operation);
    if (!pendingRequests_.contains(operation->nonce)) {
      return std::nullopt;
    }
  }
  return NativeNotification{.operation = operation, .payload = copyPayload(payload)};
}

bool BinaryProtocol::canDeliver(const NativeNotification& notification) const {
  std::scoped_lock lock(mutex_);
  if (!active_) {
    return false;
  }
  if (!notification.operation) {
    return true;
  }
  if (notification.operation->attachment.runtimeAttachment != attachment_.runtimeAttachment ||
      notification.operation->attachment.owner != attachment_.owner ||
      notification.operation->attachment.backendGeneration != attachment_.backendGeneration) {
    return false;
  }
  return pendingRequests_.contains(notification.operation->nonce);
}

void BinaryProtocol::closeAdmission() {
  std::scoped_lock lock(mutex_);
  active_ = false;
  pendingRequests_.clear();
}

bool BinaryProtocol::isActive() const {
  std::scoped_lock lock(mutex_);
  return active_;
}

std::uint32_t BinaryProtocol::selectVersion(const VersionRange& range, std::uint32_t supported, const char* name) {
  if (range.minimum == 0U || range.minimum > range.maximum || range.minimum > supported || range.maximum < supported) {
    throw ProtocolError(ProtocolErrorCode::incompatibleVersion, name);
  }
  return supported;
}

std::string BinaryProtocol::createNonce() {
  const auto value = nextNonce.fetch_add(1U, std::memory_order_relaxed);
  std::ostringstream stream;
  stream << "op-" << std::hex << value;
  return stream.str();
}

void BinaryProtocol::requireActiveLocked() const {
  if (!active_ || !handshakeComplete_) {
    throw ProtocolError(ProtocolErrorCode::inactive, "Binary protocol admission is closed");
  }
}

void BinaryProtocol::requireOwnedCorrelationLocked(const OperationReference& operation) const {
  if (!operation || operation->attachment.runtimeAttachment != attachment_.runtimeAttachment ||
      operation->attachment.owner != attachment_.owner ||
      operation->attachment.backendGeneration != attachment_.backendGeneration) {
    throw ProtocolError(ProtocolErrorCode::invalidCorrelation, "The operation does not belong to this runtime attachment");
  }
}

std::vector<std::uint8_t> BinaryProtocol::copyPayload(ByteView payload) const {
  if (payload.byteLength > maximumPayloadBytes_) {
    throw ProtocolError(ProtocolErrorCode::payloadTooLarge, "Binary payload exceeds the protocol limit");
  }
  if (payload.byteLength > 0U && payload.data == nullptr) {
    throw ProtocolError(ProtocolErrorCode::invalidInput, "Binary payload has a null data pointer");
  }
  if (payload.byteLength == 0U) {
    return {};
  }
  return {payload.data, payload.data + payload.byteLength};
}

} // namespace ub4::rnjsispike
