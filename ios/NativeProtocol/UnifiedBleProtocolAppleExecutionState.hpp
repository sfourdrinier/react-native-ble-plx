// ios/NativeProtocol/UnifiedBleProtocolAppleExecutionState.hpp

#pragma once

#include "UnifiedBleProtocolAppleExecution.hpp"
#include "UnifiedBleProtocolAppleBinaryDelivery.hpp"
#include "UnifiedBleProtocolAppleBinaryLedger.hpp"
#include "UnifiedBleProtocolAppleIngress.hpp"
#include "../../native/protocol/include/BoundedNativeEventBuffer.hpp"

#include <atomic>
#include <cstdint>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

namespace facebook::jsi {
class Function;
}

namespace unified_ble::apple_protocol {

class AppleNativeProtocolExecution::State final : public std::enable_shared_from_this<State> {
 public:
  static constexpr std::size_t kMaximumPreJavaScriptRecords = 64U;
  static constexpr std::size_t kMaximumPreJavaScriptBytes = 256U * 1024U;
  static constexpr std::size_t kMaximumJavaScriptRecords = 64U;
  static constexpr std::size_t kMaximumJavaScriptBytes = 256U * 1024U;

  State(std::shared_ptr<native_protocol::v1::NativeProtocolControlRuntime> runtimeValue, void* radioValue);
  ~State();

  std::shared_ptr<native_protocol::v1::NativeProtocolControlRuntime> runtime;
  void* radio;
  std::shared_ptr<facebook::react::CallInvoker> callInvoker;
  std::shared_ptr<facebook::jsi::Function> eventSink;
  std::shared_ptr<facebook::jsi::Function> fatalSink;
  std::vector<std::shared_ptr<facebook::jsi::Function>> sinksAwaitingJavaScriptRelease;
  native_protocol::v1::BoundedNativeEventBuffer recordsAwaitingSink{
      kMaximumPreJavaScriptRecords, kMaximumPreJavaScriptBytes};
  std::vector<BinaryReferenceList> binaryReferencesAwaitingSink;
  AppleBinaryCleanupLedger binaryCleanupLedger;
  native_protocol::v1::BoundedNativeEventBuffer recordsAwaitingJavaScript{
      kMaximumJavaScriptRecords, kMaximumJavaScriptBytes};
  std::vector<BinaryReferenceList> binaryReferencesAwaitingJavaScript;
  /// Kept index-aligned with JavaScript records: terminal settlement is valid
  /// only after the corresponding sink call has succeeded.
  std::vector<std::optional<native_protocol::v1::ProtocolRecord>> terminalResultsAwaitingJavaScript;
  std::vector<std::optional<native_protocol::v1::ProtocolRecord>> terminalConnectionCommandsAwaitingJavaScript;
  bool drainScheduled = false;
  std::atomic<bool> closed{false};
  AppleNativeIngressOrdinalAllocator ingressOrdinalAllocator;
  std::recursive_mutex mutex;
  std::uint64_t attachmentGeneration = 0U;
  bool attachmentActive = false;
  bool ingressClosed = false;
  /// Set when a terminal can no longer be admitted to JavaScript.  No command
  /// may outlive this state: the attachment is torn down as one fatal unit.
  bool attachmentFatal = false;
  bool restorationAppended = false;
  std::unordered_map<std::string, native_protocol::v1::ProtocolRecord> connections;
};

} // namespace unified_ble::apple_protocol
