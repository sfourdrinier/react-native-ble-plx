// native/protocol/include/NativeProtocolV1Registry.hpp

#pragma once

#include "NativeProtocolV1Codec.hpp"

#include <cstddef>
#include <cstdint>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

namespace unified_ble::native_protocol::v1 {

struct NativeAttachmentIdentity {
  std::string attachmentId;
  std::string backendInstanceId;
  std::string backendGeneration;
  std::string adapterId;
  std::string adapterGeneration;
};

struct NativeOperationIdentity {
  NativeAttachmentIdentity attachment;
  std::uint64_t dispatchEpoch;
  std::string nonce;
};

enum class NativeOperationState {
  registered,
  cancellationRequested,
  succeeded,
  failed,
};

enum class NativeCancellationState {
  cancellationRequested,
  alreadyTerminal,
  notCancellable,
};

enum class NativeRestorationOutcome {
  adopted,
  alreadyConsumed,
  attachmentMismatch,
  backendMismatch,
  namespaceMismatch,
  epochMismatch,
};

class NativeOperationRegistry final {
 public:
  explicit NativeOperationRegistry(NativeAttachmentIdentity attachment, std::size_t maximumOperations = 1024U);

  void registerOperation(const NativeOperationIdentity& operation, bool cancellable);
  NativeCancellationState cancel(const NativeOperationIdentity& operation);
  bool settle(const NativeOperationIdentity& operation, NativeOperationState terminal);
  bool acceptsLateCallback(const NativeOperationIdentity& operation) const;
  void invalidate(NativeAttachmentIdentity replacement);
  std::size_t pendingCount() const;

 private:
  struct PendingOperation {
    bool cancellable;
    NativeOperationState state;
  };

  void requireCurrent(const NativeOperationIdentity& operation) const;
  static std::string key(const NativeOperationIdentity& operation);

  mutable std::mutex mutex_;
  NativeAttachmentIdentity attachment_;
  const std::size_t maximumOperations_;
  std::unordered_map<std::string, PendingOperation> pending_;
  std::uint64_t nextDispatchEpoch_ = 1U;
};

struct RestorationJournalEntry {
  std::uint64_t ordinal;
  std::string namespaceValue;
  NativeAttachmentIdentity attachment;
  std::string adoptionEpoch;
  ProtocolRecord record;
};

struct RestorationAdoptionReceipt {
  std::string receiptId;
  NativeRestorationOutcome outcome;
  std::string boundClientId;
  std::vector<RestorationJournalEntry> records;
};

struct NativeRestorationAdoptionRequest {
  std::string namespaceValue;
  std::string attachmentId;
  std::string expectedBackendInstanceId;
  std::string expectedEpoch;
  std::uint32_t nativeProtocolMinimum;
  std::uint32_t nativeProtocolMaximum;
  std::string clientId;
  std::string hostSessionScope;
};

/**
 * Immutable authority issued to the one native early-restoration owner.
 * It binds all journal appends to one attachment, epoch, and authenticated
 * future adopter without creating a parallel restoration journal.
 */
struct NativeRestorationJournalAuthority {
  std::string namespaceValue;
  NativeAttachmentIdentity attachment;
  std::string adoptionEpoch;
  std::string authorizedClientId;
  std::string authorizedHostSessionScope;
  VersionRange nativeProtocol;
};

class NativeRestorationJournal final {
 public:
  NativeRestorationJournal(
      std::string namespaceValue,
      NativeAttachmentIdentity attachment,
      std::string adoptionEpoch,
      std::string authorizedClientId,
      std::string authorizedHostSessionScope,
      std::size_t recordCapacity,
      std::size_t byteCapacity);

  void append(ProtocolRecord record);
  RestorationAdoptionReceipt adopt(const NativeRestorationAdoptionRequest& request);
  bool matchesAuthority(const NativeRestorationJournalAuthority& authority) const;
  bool consumed() const;
  std::size_t size() const;

 private:
  const std::string namespace_;
  const NativeAttachmentIdentity attachment_;
  const std::string adoptionEpoch_;
  const std::string authorizedClientId_;
  const std::string authorizedHostSessionScope_;
  const std::size_t recordCapacity_;
  const std::size_t byteCapacity_;
  NativeProtocolV1Codec codec_;
  mutable std::mutex mutex_;
  std::vector<RestorationJournalEntry> records_;
  std::size_t retainedBytes_ = 0U;
  std::uint64_t nextOrdinal_ = 1U;
  bool consumed_ = false;
};

} // namespace unified_ble::native_protocol::v1
