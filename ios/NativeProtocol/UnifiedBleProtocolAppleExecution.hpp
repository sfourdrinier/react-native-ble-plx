// ios/NativeProtocol/UnifiedBleProtocolAppleExecution.hpp

#pragma once

#include "../../native/protocol/include/NativeProtocolControlRuntime.hpp"

#include <memory>

namespace facebook::jsi {
class Runtime;
}

namespace facebook::react {
class CallInvoker;
}

namespace unified_ble::apple_protocol {

class AppleNativeProtocolExecution final {
 public:
  class State;

  AppleNativeProtocolExecution(
      std::shared_ptr<native_protocol::v1::NativeProtocolControlRuntime> runtime,
      void* radio);
  ~AppleNativeProtocolExecution();

  AppleNativeProtocolExecution(const AppleNativeProtocolExecution&) = delete;
  AppleNativeProtocolExecution& operator=(const AppleNativeProtocolExecution&) = delete;

  void install(
      facebook::jsi::Runtime& runtime,
      const std::shared_ptr<facebook::react::CallInvoker>& callInvoker);
  void cancel(const native_protocol::v1::NativeOperationIdentity& operation);
  void appendRestorationRecords(const native_protocol::v1::NativeRestorationJournalAuthority& authority);
  void detachAttachment();
  void receiveAdapterState(void* snapshot);
  void receiveAdvertisement(void* advertisement);
  void receiveDisconnect(void* peerIdentifier, void* error);
  void receiveNotification(void* subscriptionIdentifier, void* value);
  void close();

 private:
  std::shared_ptr<State> state_;
};

} // namespace unified_ble::apple_protocol
