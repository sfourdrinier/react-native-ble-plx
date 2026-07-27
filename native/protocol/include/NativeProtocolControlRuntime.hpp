// native/protocol/include/NativeProtocolControlRuntime.hpp

#pragma once

#include "NativeProtocolV1Registry.hpp"
#include "OwnedJsiBinaryTransport.hpp"

#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

namespace unified_ble::native_protocol::v1 {

class NativeProtocolControlRuntime final {
 public:
  NativeProtocolControlRuntime();
  ~NativeProtocolControlRuntime();

  NativeProtocolControlRuntime(const NativeProtocolControlRuntime&) = delete;
  NativeProtocolControlRuntime& operator=(const NativeProtocolControlRuntime&) = delete;

  NegotiatedVersions handshake(
      const NativeAttachmentIdentity& attachment,
      const std::string& ownerId,
      VersionRange nativeProtocol,
      VersionRange abi,
      VersionRange backendContract,
      VersionRange capabilitySchema,
      VersionRange eventSchema,
      VersionRange traceFormat);
  NativeCancellationState cancel(const NativeOperationIdentity& operation);
  RestorationAdoptionReceipt adopt(const NativeRestorationAdoptionRequest& request);
  void appendRestorationRecord(
      const NativeRestorationJournalAuthority& authority,
      ProtocolRecord record);
  void registerCommand(const ProtocolRecord& command, bool cancellable);
  bool rejectCommandDispatch(const ProtocolRecord& command);
  bool settleResult(const ProtocolRecord& result);
  void validateEvent(const ProtocolRecord& event) const;
  std::optional<ProtocolRecord> commandFor(
      std::uint64_t dispatchEpoch,
      const std::string& nonce) const;
  std::optional<ProtocolRecord> subscriptionCommandFor(const std::string& subscriptionId) const;
  std::optional<ProtocolRecord> pendingSubscriptionCommandFor(const std::string& subscriptionId) const;
  std::optional<ProtocolRecord> activeScanCommand() const;
  NativeAttachmentIdentity attachmentIdentity() const;
  std::vector<std::uint8_t> consumeCommandBinary(const ProtocolRecord& command);
  OwnedBinaryReference retainNativeBytes(
      const std::string& operationCorrelation,
      const std::vector<std::uint8_t>& bytes);
  OwnedBinaryReference retainUint8Array(
      facebook::jsi::Runtime& runtime,
      const std::string& operationCorrelation,
      const facebook::jsi::Value& value);
  facebook::jsi::Value copyBinary(
      facebook::jsi::Runtime& runtime,
      const OwnedBinaryReference& reference) const;
  bool releaseBinary(const OwnedBinaryReference& reference);
  std::size_t retainedBinaryBytes() const;
  std::size_t retainedBinaryPayloads() const;
  void close(const NativeAttachmentIdentity& attachment);
  bool open() const;

 private:
  std::unique_ptr<NativeOperationRegistry> operations_;
  std::unique_ptr<NativeRestorationJournal> restoration_;
  std::optional<NativeRestorationJournalAuthority> restorationAuthority_;
  std::unique_ptr<OwnedJsiBinaryTransport> binaryTransport_;
  NativeAttachmentIdentity attachment_;
  std::string ownerId_;
  mutable std::mutex commandMutex_;
  std::unordered_map<std::string, ProtocolRecord> pendingCommands_;
  std::unordered_map<std::string, ProtocolRecord> activeSubscriptionCommands_;
  std::optional<ProtocolRecord> activeScanCommand_;
};

const char* cancellationStateName(NativeCancellationState state);
const char* restorationOutcomeName(NativeRestorationOutcome outcome);

} // namespace unified_ble::native_protocol::v1
