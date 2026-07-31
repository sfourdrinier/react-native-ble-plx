// ios/NativeProtocol/UnifiedBleProtocolAppleExecutionState.hpp

#pragma once

#include "UnifiedBleProtocolAppleExecution.hpp"
#include "../../native/protocol/include/BoundedNativeEventBuffer.hpp"

#include <atomic>
#include <cstdint>
#include <memory>
#include <mutex>
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

  State(std::shared_ptr<native_protocol::v1::NativeProtocolControlRuntime> runtimeValue, void* radioValue);
  ~State();

  std::shared_ptr<native_protocol::v1::NativeProtocolControlRuntime> runtime;
  void* radio;
  std::shared_ptr<facebook::react::CallInvoker> callInvoker;
  std::shared_ptr<facebook::jsi::Function> eventSink;
  std::vector<std::shared_ptr<facebook::jsi::Function>> eventSinksAwaitingJavaScriptRelease;
  native_protocol::v1::BoundedNativeEventBuffer recordsAwaitingSink{
      kMaximumPreJavaScriptRecords, kMaximumPreJavaScriptBytes};
  std::atomic<bool> closed{false};
  std::uint64_t nextIngressOrdinal = 1U;
  std::recursive_mutex mutex;
  std::uint64_t attachmentGeneration = 0U;
  bool attachmentActive = false;
  bool ingressClosed = false;
  bool restorationAppended = false;
  std::unordered_map<std::string, native_protocol::v1::ProtocolRecord> connections;
};

} // namespace unified_ble::apple_protocol
