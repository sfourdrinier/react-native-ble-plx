// ios/UnifiedBleProtocolControl.mm

#import <Foundation/Foundation.h>
#import <CoreBluetooth/CoreBluetooth.h>
#import <React/RCTLog.h>
#import <ReactCommon/RCTTurboModule.h>
#import <ReactCommon/RCTTurboModuleWithJSIBindings.h>

#if __has_include("BlePlx-Swift.h")
#import "BlePlx-Swift.h"
#endif

#include <cmath>
#include "../native/protocol/include/NativeProtocolControlRuntime.hpp"
#include "NativeProtocol/UnifiedBleProtocolAppleExecution.hpp"

#ifdef RCT_NEW_ARCH_ENABLED
#import <BlePlxSpec/BlePlxSpec.h>
#endif

namespace {

constexpr double kProtocolVersion = 1.0;
constexpr double kMaximumSafeInteger = 9007199254740991.0;

bool validString(NSString *value) {
  return value != nil && value.length > 0;
}

bool validInteger(double value) {
  return std::isfinite(value) && value >= 1.0 && value <= kMaximumSafeInteger && std::trunc(value) == value;
}

bool compatibleRange(double minimum, double maximum) {
  return validInteger(minimum) &&
      validInteger(maximum) &&
      minimum <= maximum &&
      minimum <= kProtocolVersion &&
      maximum >= kProtocolVersion;
}

NSDictionary *attachmentDictionary(
    NSString *attachmentId,
    NSString *backendInstanceId,
    NSString *backendGeneration,
    NSString *adapterId,
    NSString *adapterGeneration) {
  if (!validString(attachmentId) ||
      !validString(backendInstanceId) ||
      !validString(backendGeneration) ||
      !validString(adapterId) ||
      !validString(adapterGeneration)) {
    return nil;
  }
  return @{
    @"attachmentId": attachmentId,
    @"backendInstanceId": backendInstanceId,
    @"backendGeneration": backendGeneration,
    @"adapterId": adapterId,
    @"adapterGeneration": adapterGeneration,
  };
}

std::string nativeString(NSString *value) {
  return value == nil ? std::string{} : std::string(value.UTF8String);
}

unified_ble::native_protocol::v1::NativeAttachmentIdentity nativeAttachment(
    NSString *attachmentId,
    NSString *backendInstanceId,
    NSString *backendGeneration,
    NSString *adapterId,
    NSString *adapterGeneration) {
  return {
    .attachmentId = nativeString(attachmentId),
    .backendInstanceId = nativeString(backendInstanceId),
    .backendGeneration = nativeString(backendGeneration),
    .adapterId = nativeString(adapterId),
    .adapterGeneration = nativeString(adapterGeneration),
  };
}

void rejectControl(RCTPromiseRejectBlock reject, NSString *code, NSString *message) {
  RCTLogError(@"[UnifiedBleProtocolControl] %@ failed: %@", code, message);
  reject(code, message, nil);
}

} // namespace

#ifdef RCT_NEW_ARCH_ENABLED

@interface UnifiedBleProtocolAppleRadioDelegate : NSObject <OwnedCoreBluetoothProtocolRadioDelegate>
@property(nonatomic, assign) unified_ble::apple_protocol::AppleNativeProtocolExecution *execution;
@end

@interface UnifiedBleProtocolControl : NSObject <NativeUnifiedBleProtocolControlSpec, RCTTurboModuleWithJSIBindings>
@end

@implementation UnifiedBleProtocolControl {
  std::shared_ptr<unified_ble::native_protocol::v1::NativeProtocolControlRuntime> _runtime;
  std::shared_ptr<unified_ble::apple_protocol::AppleNativeProtocolExecution> _execution;
  NSDictionary *_attachment;
  OwnedCoreBluetoothProtocolRadio *_radio;
  UnifiedBleProtocolAppleRadioDelegate *_radioDelegate;
  BOOL _jsiInstalled;
}

RCT_EXPORT_MODULE(UnifiedBleProtocolControl)

- (instancetype)init {
  self = [super init];
  if (self != nil) {
    _runtime = std::make_shared<unified_ble::native_protocol::v1::NativeProtocolControlRuntime>();
    id configuredIdentifier = [[NSBundle mainBundle] objectForInfoDictionaryKey:@"BlePlxRestoreIdentifier"];
    NSString *restoreIdentifier = [configuredIdentifier isKindOfClass:[NSString class]] ? configuredIdentifier : nil;
    _radio = [[OwnedCoreBluetoothProtocolRadio alloc] initWithRestoreIdentifierKey:restoreIdentifier];
    _execution = std::make_shared<unified_ble::apple_protocol::AppleNativeProtocolExecution>(
        _runtime,
        (__bridge void *)_radio);
    _radioDelegate = [UnifiedBleProtocolAppleRadioDelegate new];
    _radioDelegate.execution = _execution.get();
  }
  return self;
}

- (void)installJSIBindingsWithRuntime:(facebook::jsi::Runtime &)runtime
                          callInvoker:(const std::shared_ptr<facebook::react::CallInvoker> &)callInvoker {
  if (_jsiInstalled) {
    return;
  }
  try {
    _execution->install(runtime, callInvoker);
    _jsiInstalled = YES;
  } catch (const std::exception& error) {
    NSLog(@"[UnifiedBleProtocolControl] JSI installation failed: %s", error.what());
  }
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeUnifiedBleProtocolControlSpecJSI>(params);
}

- (void)handshake:(JS::NativeUnifiedBleProtocolControl::NativeProtocolHandshakeRequest &)request
          resolve:(RCTPromiseResolveBlock)resolve
           reject:(RCTPromiseRejectBlock)reject {
  const auto rangesCompatible =
      compatibleRange(request.nativeProtocol().minimum(), request.nativeProtocol().maximum()) &&
      compatibleRange(request.abi().minimum(), request.abi().maximum()) &&
      compatibleRange(request.backendContract().minimum(), request.backendContract().maximum()) &&
      compatibleRange(request.capabilitySchema().minimum(), request.capabilitySchema().maximum()) &&
      compatibleRange(request.eventSchema().minimum(), request.eventSchema().maximum()) &&
      compatibleRange(request.traceFormat().minimum(), request.traceFormat().maximum());
  NSDictionary *requestedAttachment = attachmentDictionary(
      request.attachmentId(),
      request.backendInstanceId(),
      request.backendGeneration(),
      request.adapterId(),
      request.adapterGeneration());
  if (!rangesCompatible || requestedAttachment == nil || !validString(request.ownerId())) {
    rejectControl(reject, @"nativeProtocolHandshake", @"The handshake request is malformed or incompatible");
    return;
  }
  try {
    const auto range = [](JS::NativeUnifiedBleProtocolControl::NativeProtocolVersionRange value) {
      return unified_ble::native_protocol::v1::VersionRange{
        .minimum = static_cast<std::uint32_t>(value.minimum()),
        .maximum = static_cast<std::uint32_t>(value.maximum()),
      };
    };
    static_cast<void>(_runtime->handshake(
        nativeAttachment(
            request.attachmentId(),
            request.backendInstanceId(),
            request.backendGeneration(),
            request.adapterId(),
            request.adapterGeneration()),
        nativeString(request.ownerId()),
        range(request.nativeProtocol()),
        range(request.abi()),
        range(request.backendContract()),
        range(request.capabilitySchema()),
        range(request.eventSchema()),
        range(request.traceFormat())));
  } catch (const std::exception& error) {
    rejectControl(reject, @"nativeProtocolHandshake", [NSString stringWithUTF8String:error.what()]);
    return;
  }
  _attachment = [requestedAttachment copy];
  _radio.delegate = _radioDelegate;
  _execution->receiveAdapterState((__bridge void *)[_radio adapterSnapshot]);
  resolve(@{
    @"nativeProtocol": @1,
    @"abi": @1,
    @"backendContract": @1,
    @"capabilitySchema": @1,
    @"eventSchema": @1,
    @"traceFormat": @1,
    @"maximumControlRecordBytes": @262144,
    @"maximumBinaryPayloadBytes": @524288,
  });
}

- (void)installExecutionRuntime:(RCTPromiseResolveBlock)resolve
                         reject:(RCTPromiseRejectBlock)reject {
  if (_attachment == nil) {
    rejectControl(reject, @"nativeProtocolJsiInstall", @"The native protocol attachment is not open");
    return;
  }
  if (!_jsiInstalled) {
    rejectControl(reject, @"nativeProtocolJsiInstall", @"The React Native JSI runtime is unavailable for this module");
    return;
  }
  resolve(nil);
}

- (void)cancelOperation:(JS::NativeUnifiedBleProtocolControl::NativeOperationCorrelation &)correlation
                resolve:(RCTPromiseResolveBlock)resolve
                 reject:(RCTPromiseRejectBlock)reject {
  auto attachment = correlation.attachment();
  NSDictionary *requestedAttachment = attachmentDictionary(
      attachment.attachmentId(),
      attachment.backendInstanceId(),
      attachment.backendGeneration(),
      attachment.adapterId(),
      attachment.adapterGeneration());
  if (_attachment == nil ||
      requestedAttachment == nil ||
      ![_attachment isEqualToDictionary:requestedAttachment] ||
      !validInteger(correlation.dispatchEpoch()) ||
      !validString(correlation.nonce())) {
    rejectControl(reject, @"invalidCorrelation", @"The cancellation correlation is malformed or stale");
    return;
  }
  try {
    const auto operation = unified_ble::native_protocol::v1::NativeOperationIdentity{
      .attachment = nativeAttachment(
          attachment.attachmentId(),
          attachment.backendInstanceId(),
          attachment.backendGeneration(),
          attachment.adapterId(),
          attachment.adapterGeneration()),
      .dispatchEpoch = static_cast<std::uint64_t>(correlation.dispatchEpoch()),
      .nonce = nativeString(correlation.nonce()),
    };
    const auto state = _runtime->cancel(operation);
    if (state == unified_ble::native_protocol::v1::NativeCancellationState::cancellationRequested) {
      _execution->cancel(operation);
    }
    resolve(@{@"state": [NSString stringWithUTF8String:
        unified_ble::native_protocol::v1::cancellationStateName(state)]});
  } catch (const std::exception& error) {
    rejectControl(reject, @"invalidCorrelation", [NSString stringWithUTF8String:error.what()]);
  }
}

- (void)adoptRestoration:(JS::NativeUnifiedBleProtocolControl::NativeRestorationAdoptionRequest &)request
                 resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject {
  if (_attachment == nil ||
      !compatibleRange(request.nativeProtocolMinimum(), request.nativeProtocolMaximum()) ||
      !validString(request.namespaceValue()) ||
      !validString(request.expectedEpoch()) ||
      !validString(request.clientId()) ||
      !validString(request.hostSessionScope())) {
    rejectControl(reject, @"nativeRestorationAdoption", @"The restoration request is malformed");
    return;
  }
  try {
    const auto attachment = _runtime->attachmentIdentity();
    if (nativeString(request.attachmentId()) != attachment.attachmentId ||
        nativeString(request.expectedBackendInstanceId()) != attachment.backendInstanceId) {
      rejectControl(reject, @"nativeRestorationAdoption", @"The restoration request targets a stale attachment");
      return;
    }
    const auto authority = unified_ble::native_protocol::v1::NativeRestorationJournalAuthority{
        .namespaceValue = nativeString(request.namespaceValue()),
        .attachment = attachment,
        .adoptionEpoch = nativeString(request.expectedEpoch()),
        .authorizedClientId = nativeString(request.clientId()),
        .authorizedHostSessionScope = nativeString(request.hostSessionScope()),
        .nativeProtocol = {
            .minimum = static_cast<std::uint32_t>(request.nativeProtocolMinimum()),
            .maximum = static_cast<std::uint32_t>(request.nativeProtocolMaximum()),
        },
    };
    _execution->appendRestorationRecords(authority);
    const auto receipt = _runtime->adopt({
      .namespaceValue = nativeString(request.namespaceValue()),
      .attachmentId = nativeString(request.attachmentId()),
      .expectedBackendInstanceId = nativeString(request.expectedBackendInstanceId()),
      .expectedEpoch = nativeString(request.expectedEpoch()),
      .nativeProtocolMinimum = static_cast<std::uint32_t>(request.nativeProtocolMinimum()),
      .nativeProtocolMaximum = static_cast<std::uint32_t>(request.nativeProtocolMaximum()),
      .clientId = nativeString(request.clientId()),
      .hostSessionScope = nativeString(request.hostSessionScope()),
    });
    resolve(@{
      @"receiptId": [NSString stringWithUTF8String:receipt.receiptId.c_str()],
      @"outcome": [NSString stringWithUTF8String:
          unified_ble::native_protocol::v1::restorationOutcomeName(receipt.outcome)],
      @"replayRecordCount": @(receipt.records.size()),
    });
  } catch (const std::exception& error) {
    rejectControl(reject, @"nativeRestorationAdoption", [NSString stringWithUTF8String:error.what()]);
  }
}

- (void)closeAttachment:(JS::NativeUnifiedBleProtocolControl::NativeAttachmentIdentity &)attachment
                resolve:(RCTPromiseResolveBlock)resolve
                 reject:(RCTPromiseRejectBlock)reject {
  NSDictionary *requestedAttachment = attachmentDictionary(
      attachment.attachmentId(),
      attachment.backendInstanceId(),
      attachment.backendGeneration(),
      attachment.adapterId(),
      attachment.adapterGeneration());
  if (_attachment == nil || requestedAttachment == nil || ![_attachment isEqualToDictionary:requestedAttachment]) {
    rejectControl(reject, @"nativeProtocolClose", @"The attachment close request is stale");
    return;
  }
  try {
    const auto nativeAttachmentValue = nativeAttachment(
        attachment.attachmentId(),
        attachment.backendInstanceId(),
        attachment.backendGeneration(),
        attachment.adapterId(),
        attachment.adapterGeneration());
    [_radio destroyWithCompletion:^(NSError *error) {
      if (error != nil) {
        rejectControl(reject, @"nativeProtocolClose", error.localizedDescription);
        return;
      }
      try {
        self->_radio.delegate = nil;
        self->_radioDelegate.execution = nullptr;
        self->_execution->close();
        self->_runtime->close(nativeAttachmentValue);
        self->_attachment = nil;
        resolve(nil);
      } catch (const std::exception& innerError) {
        rejectControl(reject, @"nativeProtocolClose", [NSString stringWithUTF8String:innerError.what()]);
      }
    }];
  } catch (const std::exception& error) {
    rejectControl(reject, @"nativeProtocolClose", [NSString stringWithUTF8String:error.what()]);
  }
}

- (void)invalidate {
  _radio.delegate = nil;
  _radioDelegate.execution = nullptr;
  _execution->close();
  [_radio destroyWithCompletion:^(NSError *error) {
    if (error != nil) {
      NSLog(@"[UnifiedBleProtocolControl] radio destruction during invalidation failed: %@", error.localizedDescription);
    }
  }];
  _attachment = nil;
}

@end

@implementation UnifiedBleProtocolAppleRadioDelegate

- (void)protocolRadioDidUpdateAdapterState:(NSDictionary *)snapshot {
  if (_execution != nullptr) {
    _execution->receiveAdapterState((__bridge void *)snapshot);
  }
}

- (void)protocolRadioDidReceiveAdvertisement:(NSDictionary *)advertisement {
  if (_execution != nullptr) {
    _execution->receiveAdvertisement((__bridge void *)advertisement);
  }
}

- (void)protocolRadioDidDisconnectPeer:(NSString *)peerIdentifier error:(NSError *)error {
  if (_execution != nullptr) {
    _execution->receiveDisconnect((__bridge void *)peerIdentifier, (__bridge void *)error);
  }
}

- (void)protocolRadioDidReceiveNotification:(NSString *)subscriptionIdentifier value:(NSData *)value {
  if (_execution != nullptr) {
    _execution->receiveNotification((__bridge void *)subscriptionIdentifier, (__bridge void *)value);
  }
}

@end

#endif
