// spikes/rn-jsi-binary/native/include/Ub4JsiBinaryProtocol.h

#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <vector>

namespace ub4::rnjsispike {

inline constexpr std::uint32_t kBinaryProtocolVersion = 1;
inline constexpr std::uint32_t kBinaryProtocolAbiVersion = 1;
inline constexpr std::uint32_t kBackendContractVersion = 1;
inline constexpr std::uint32_t kCapabilitySchemaVersion = 1;
inline constexpr std::uint32_t kEventSchemaVersion = 1;
inline constexpr std::uint32_t kTraceFormatVersion = 1;
inline constexpr std::size_t kDefaultMaximumPayloadBytes = 64U * 1024U;
inline constexpr std::size_t kMaximumPendingRequests = 1024U;

enum class ProtocolErrorCode {
  incompatibleVersion,
  inactive,
  duplicateHandshake,
  invalidInput,
  payloadTooLarge,
  tooManyPendingRequests,
  invalidCorrelation,
};

class ProtocolError final : public std::runtime_error {
 public:
  ProtocolError(ProtocolErrorCode code, const char* message);
  ProtocolErrorCode code() const noexcept;

 private:
  ProtocolErrorCode code_;
};

struct VersionRange {
  std::uint32_t minimum;
  std::uint32_t maximum;
};

struct HandshakeOffer {
  VersionRange nativeProtocol;
  VersionRange abi;
  VersionRange backendContract;
  VersionRange capabilitySchema;
  VersionRange eventSchema;
  VersionRange traceFormat;
  std::string owner;
  std::uint64_t backendGeneration;
};

struct HandshakeResult {
  std::uint32_t nativeProtocol;
  std::uint32_t abi;
  std::uint32_t backendContract;
  std::uint32_t capabilitySchema;
  std::uint32_t eventSchema;
  std::uint32_t traceFormat;
  std::size_t maximumPayloadBytes;
};

struct AttachmentTuple {
  std::string runtimeAttachment;
  std::string owner;
  std::uint64_t backendGeneration;
};

struct OperationCorrelation {
  AttachmentTuple attachment;
  std::uint64_t dispatchEpoch;
  std::string nonce;
};

using OperationReference = std::shared_ptr<const OperationCorrelation>;

struct ByteView {
  const std::uint8_t* data;
  std::size_t byteLength;
};

struct NativeNotification {
  OperationReference operation;
  std::vector<std::uint8_t> payload;
};

class BinaryProtocol final {
 public:
  explicit BinaryProtocol(AttachmentTuple attachment, std::size_t maximumPayloadBytes = kDefaultMaximumPayloadBytes);

  HandshakeResult activate(const HandshakeOffer& offer);
  OperationReference submit(ByteView payload);
  std::optional<std::vector<std::uint8_t>> copyPendingPayload(const OperationReference& operation) const;
  bool settleComplete(const OperationReference& operation);
  bool cancel(const OperationReference& operation);
  std::optional<NativeNotification> prepareNativeNotification(
      const OperationReference& operation,
      ByteView payload);
  bool canDeliver(const NativeNotification& notification) const;
  void closeAdmission();
  bool isActive() const;

 private:
  struct PendingRequest {
    OperationReference correlation;
    std::vector<std::uint8_t> payload;
  };

  static std::uint32_t selectVersion(const VersionRange& range, std::uint32_t supported, const char* name);
  static std::string createNonce();
  void requireActiveLocked() const;
  void requireOwnedCorrelationLocked(const OperationReference& operation) const;
  std::vector<std::uint8_t> copyPayload(ByteView payload) const;

  const AttachmentTuple attachment_;
  const std::size_t maximumPayloadBytes_;
  mutable std::mutex mutex_;
  bool active_ = false;
  bool handshakeComplete_ = false;
  std::uint64_t nextDispatchEpoch_ = 1;
  std::unordered_map<std::string, PendingRequest> pendingRequests_;
};

} // namespace ub4::rnjsispike
