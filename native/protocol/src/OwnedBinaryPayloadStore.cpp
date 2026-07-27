// native/protocol/src/OwnedBinaryPayloadStore.cpp

#include "../include/OwnedBinaryPayloadStore.hpp"

#include <array>
#include <iomanip>
#include <random>
#include <sstream>
#include <utility>

namespace unified_ble::native_protocol::v1 {

namespace {

std::string createOwnerToken() {
  std::random_device source;
  std::array<std::uint32_t, 8> entropy{};
  for (auto& value : entropy) {
    value = source();
  }
  std::ostringstream token;
  token << "binary-owner-";
  for (const auto value : entropy) {
    token << std::hex << std::setw(8) << std::setfill('0') << value;
  }
  return token.str();
}

} // namespace

OwnedBinaryPayloadStore::OwnedBinaryPayloadStore(std::size_t maximumRetainedBytes)
    : maximumRetainedBytes_(maximumRetainedBytes) {
  if (maximumRetainedBytes_ == 0U) {
    throw ProtocolException(ProtocolFailure::payloadTooLarge, "Binary transport retention limit must be positive");
  }
}

OwnedBinaryReference OwnedBinaryPayloadStore::retainCopy(
    const std::string& operationCorrelation,
    BorrowedByteView bytes) {
  if (operationCorrelation.empty()) {
    throw ProtocolException(ProtocolFailure::invalidCorrelation, "Binary payload requires an opaque correlation");
  }
  if (bytes.size > 0U && bytes.data == nullptr) {
    throw ProtocolException(ProtocolFailure::detachedPayload, "Binary payload storage is unavailable");
  }
  std::scoped_lock lock(mutex_);
  if (!admissionOpen_) {
    throw ProtocolException(ProtocolFailure::alreadyTerminal, "Binary transport admission is closed");
  }
  if (bytes.size > maximumRetainedBytes_ || bytes.size > maximumRetainedBytes_ - retainedBytes_) {
    throw ProtocolException(ProtocolFailure::payloadTooLarge, "Binary payload exceeds retained-byte capacity");
  }
  auto token = createOwnerToken();
  while (retained_.contains(token)) {
    token = createOwnerToken();
  }
  std::vector<std::uint8_t> owned;
  if (bytes.size > 0U) {
    owned.assign(bytes.data, bytes.data + bytes.size);
  }
  const auto [found, inserted] = retained_.emplace(
      token,
      RetainedPayload{.operationCorrelation = operationCorrelation, .bytes = std::move(owned)});
  if (!inserted) {
    throw ProtocolException(ProtocolFailure::invalidCorrelation, "Binary owner token collided");
  }
  retainedBytes_ += found->second.bytes.size();
  return {
      .ownerToken = token,
      .operationCorrelation = operationCorrelation,
      .byteOffset = 0U,
      .byteLength = found->second.bytes.size(),
      .ownership = "nativeOwnedCopy",
  };
}

std::vector<std::uint8_t> OwnedBinaryPayloadStore::copy(
    const OwnedBinaryReference& reference) const {
  std::scoped_lock lock(mutex_);
  return requireOwnedLocked(reference).bytes;
}

std::vector<std::uint8_t> OwnedBinaryPayloadStore::take(
    const OwnedBinaryReference& reference) {
  std::scoped_lock lock(mutex_);
  const auto found = retained_.find(reference.ownerToken);
  if (found == retained_.end()) {
    throw ProtocolException(ProtocolFailure::invalidCorrelation, "Binary reference is stale or foreign");
  }
  static_cast<void>(requireOwnedLocked(reference));
  auto bytes = std::move(found->second.bytes);
  retainedBytes_ -= bytes.size();
  retained_.erase(found);
  return bytes;
}

bool OwnedBinaryPayloadStore::release(const OwnedBinaryReference& reference) {
  std::scoped_lock lock(mutex_);
  const auto found = retained_.find(reference.ownerToken);
  if (found == retained_.end()) {
    return false;
  }
  static_cast<void>(requireOwnedLocked(reference));
  retainedBytes_ -= found->second.bytes.size();
  retained_.erase(found);
  return true;
}

void OwnedBinaryPayloadStore::close() {
  std::scoped_lock lock(mutex_);
  admissionOpen_ = false;
  retained_.clear();
  retainedBytes_ = 0U;
}

std::size_t OwnedBinaryPayloadStore::retainedBytes() const {
  std::scoped_lock lock(mutex_);
  return retainedBytes_;
}

std::size_t OwnedBinaryPayloadStore::retainedPayloads() const {
  std::scoped_lock lock(mutex_);
  return retained_.size();
}

const OwnedBinaryPayloadStore::RetainedPayload& OwnedBinaryPayloadStore::requireOwnedLocked(
    const OwnedBinaryReference& reference) const {
  const auto found = retained_.find(reference.ownerToken);
  if (found == retained_.end() ||
      found->second.operationCorrelation != reference.operationCorrelation ||
      reference.byteOffset != 0U ||
      found->second.bytes.size() != reference.byteLength ||
      reference.ownership != "nativeOwnedCopy") {
    throw ProtocolException(ProtocolFailure::invalidCorrelation, "Binary reference is stale or foreign");
  }
  return found->second;
}

} // namespace unified_ble::native_protocol::v1
