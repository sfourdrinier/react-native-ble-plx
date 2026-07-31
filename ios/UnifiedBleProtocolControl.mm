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
#include "../native/protocol/include/NativeRestorationConfiguration.hpp"
#include "NativeProtocol/UnifiedBleProtocolAppleExecution.hpp"

#ifdef RCT_NEW_ARCH_ENABLED
#import <UnifiedBleProtocolSpec/UnifiedBleProtocolSpec.h>
#endif

namespace {

constexpr double kProtocolVersion = 1.0;
constexpr double kMaximumSafeInteger = 9007199254740991.0;

bool validString(NSString *value) {
  return value != nil && value.length > 0;
}

NSString *configuredInfoString(NSString *key) {
  id value = [[NSBundle mainBundle] objectForInfoDictionaryKey:key];
  if (![value isKindOfClass:[NSString class]]) {
    return nil;
  }

  NSString *stringValue = value;
  return validString(stringValue) ? stringValue : nil;
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

bool hasCompleteRestorationConfiguration(
    NSString *restoreIdentifier,
    NSString *namespaceValue,
    NSString *epoch,
    NSString *clientId,
    NSString *hostSessionScope) {
  return unified_ble::native_protocol::v1::hasCompleteNativeRestorationConfiguration(
      nativeString(restoreIdentifier),
      nativeString(namespaceValue),
      nativeString(epoch),
      nativeString(clientId),
      nativeString(hostSessionScope));
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

const unified_ble::native_protocol::v1::ProtocolField* restorationField(
    const unified_ble::native_protocol::v1::ProtocolRecord& record,
    std::uint16_t id) {
  for (const auto& candidate : record.fields) {
    if (candidate.id == id) return &candidate;
  }
  return nullptr;
}

const std::string& requiredRestorationString(
    const unified_ble::native_protocol::v1::ProtocolRecord& record,
    std::uint16_t id,
    const char* name) {
  const auto* candidate = restorationField(record, id);
  const auto* value = candidate == nullptr
      ? nullptr
      : std::get_if<std::string>(&candidate->value);
  if (value == nullptr || value->empty()) {
    throw unified_ble::native_protocol::v1::ProtocolException(
        unified_ble::native_protocol::v1::ProtocolFailure::malformedRecord,
        std::string("Apple restoration record is missing ") + name);
  }
  return *value;
}

std::uint64_t requiredRestorationUnsigned(
    const unified_ble::native_protocol::v1::ProtocolRecord& record,
    std::uint16_t id,
    const char* name) {
  const auto* candidate = restorationField(record, id);
  const auto* value = candidate == nullptr
      ? nullptr
      : std::get_if<std::uint64_t>(&candidate->value);
  if (value == nullptr || *value == 0U) {
    throw unified_ble::native_protocol::v1::ProtocolException(
        unified_ble::native_protocol::v1::ProtocolFailure::malformedRecord,
        std::string("Apple restoration record is missing ") + name);
  }
  return *value;
}

const unified_ble::native_protocol::v1::ProtocolRecord& requiredRestorationRecord(
    const unified_ble::native_protocol::v1::ProtocolRecord& record,
    std::uint16_t id,
    const char* name) {
  const auto* candidate = restorationField(record, id);
  const auto* value = candidate == nullptr
      ? nullptr
      : std::get_if<unified_ble::native_protocol::v1::ProtocolRecordReference>(&candidate->value);
  if (value == nullptr || !*value) {
    throw unified_ble::native_protocol::v1::ProtocolException(
        unified_ble::native_protocol::v1::ProtocolFailure::malformedRecord,
        std::string("Apple restoration record is missing ") + name);
  }
  return **value;
}

NSString* restorationNSString(const std::string& value) {
  return [NSString stringWithUTF8String:value.c_str()];
}

NSDictionary* structuredRestorationReplayRecord(
    const unified_ble::native_protocol::v1::ProtocolRecord& record) {
  const auto recordVersion = requiredRestorationUnsigned(record, 1U, "recordVersion");
  const auto& namespaceValue = requiredRestorationString(record, 2U, "namespace");
  const auto& attachment = requiredRestorationRecord(record, 3U, "attachment");
  const auto ordinal = requiredRestorationUnsigned(record, 4U, "ordinal");
  const auto& adoptionEpoch = requiredRestorationString(record, 5U, "adoptionEpoch");
  const auto& kind = requiredRestorationString(record, 6U, "kind");
  id peerId = [NSNull null];
  id connectionId = [NSNull null];
  id ownerLeaseId = [NSNull null];
  id connectionGeneration = [NSNull null];
  if (kind == "connection") {
    peerId = restorationNSString(requiredRestorationString(record, 7U, "peerId"));
    const auto& path = requiredRestorationRecord(record, 8U, "connectionPath");
    connectionId = restorationNSString(requiredRestorationString(path, 3U, "connectionId"));
    ownerLeaseId = restorationNSString(requiredRestorationString(path, 4U, "ownerLeaseId"));
    connectionGeneration = restorationNSString(requiredRestorationString(path, 5U, "connectionGeneration"));
  } else if (kind != "adapter") {
    throw unified_ble::native_protocol::v1::ProtocolException(
        unified_ble::native_protocol::v1::ProtocolFailure::malformedRecord,
        "Apple restoration transport supports adapter and connection records only");
  }
  return @{
    @"recordVersion": @(recordVersion),
    @"namespaceValue": restorationNSString(namespaceValue),
    @"attachmentId": restorationNSString(requiredRestorationString(attachment, 1U, "attachmentId")),
    @"backendInstanceId": restorationNSString(requiredRestorationString(attachment, 2U, "backendInstanceId")),
    @"backendGeneration": restorationNSString(requiredRestorationString(attachment, 3U, "backendGeneration")),
    @"adapterId": restorationNSString(requiredRestorationString(attachment, 4U, "adapterId")),
    @"adapterGeneration": restorationNSString(requiredRestorationString(attachment, 5U, "adapterGeneration")),
    @"ordinal": @(ordinal),
    @"adoptionEpoch": restorationNSString(adoptionEpoch),
    @"kind": restorationNSString(kind),
    @"peerId": peerId,
    @"connectionId": connectionId,
    @"ownerLeaseId": ownerLeaseId,
    @"connectionGeneration": connectionGeneration,
  };
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
  NSString *_restorationRestoreIdentifier;
  NSString *_restorationNamespace;
  NSString *_restorationEpoch;
  NSString *_restorationClientId;
  NSString *_restorationHostSessionScope;
  OwnedCoreBluetoothProtocolRadio *_radio;
  UnifiedBleProtocolAppleRadioDelegate *_radioDelegate;
  BOOL _jsiInstalled;
}

RCT_EXPORT_MODULE(UnifiedBleProtocolControl)

- (instancetype)init {
  self = [super init];
  if (self != nil) {
    _runtime = std::make_shared<unified_ble::native_protocol::v1::NativeProtocolControlRuntime>();
    _restorationRestoreIdentifier = configuredInfoString(@"UnifiedBleProtocolRestoreIdentifier");
    _restorationNamespace = configuredInfoString(@"UnifiedBleProtocolRestorationNamespace");
    _restorationEpoch = configuredInfoString(@"UnifiedBleProtocolRestorationEpoch");
    _restorationClientId = configuredInfoString(@"UnifiedBleProtocolRestorationClientId");
    _restorationHostSessionScope = configuredInfoString(@"UnifiedBleProtocolRestorationHostSessionScope");
    _radio = [[OwnedCoreBluetoothProtocolRadio alloc]
        initWithRestoreIdentifierKey:(
            hasCompleteRestorationConfiguration(
                _restorationRestoreIdentifier,
                _restorationNamespace,
                _restorationEpoch,
                _restorationClientId,
                _restorationHostSessionScope)
                ? _restorationRestoreIdentifier
                : nil)];
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
  const auto attachment = nativeAttachment(
      request.attachmentId(),
      request.backendInstanceId(),
      request.backendGeneration(),
      request.adapterId(),
      request.adapterGeneration());
  const auto range = [](JS::NativeUnifiedBleProtocolControl::NativeProtocolVersionRange value) {
    return unified_ble::native_protocol::v1::VersionRange{
      .minimum = static_cast<std::uint32_t>(value.minimum()),
      .maximum = static_cast<std::uint32_t>(value.maximum()),
    };
  };
  try {
    static_cast<void>(_runtime->handshake(
        attachment,
        nativeString(request.ownerId()),
        range(request.nativeProtocol()),
        range(request.abi()),
        range(request.backendContract()),
        range(request.capabilitySchema()),
        range(request.eventSchema()),
        range(request.traceFormat())));
    _execution->beginAttachment();
  } catch (const std::exception& error) {
    rejectControl(reject, @"nativeProtocolHandshake", [NSString stringWithUTF8String:error.what()]);
    return;
  }
  if (hasCompleteRestorationConfiguration(
          _restorationRestoreIdentifier,
          _restorationNamespace,
          _restorationEpoch,
          _restorationClientId,
          _restorationHostSessionScope)) {
    try {
      _execution->appendRestorationRecords({
          .namespaceValue = nativeString(_restorationNamespace),
          .attachment = attachment,
          .adoptionEpoch = nativeString(_restorationEpoch),
          .authorizedClientId = nativeString(_restorationClientId),
          .authorizedHostSessionScope = nativeString(_restorationHostSessionScope),
          .nativeProtocol = {.minimum = 1U, .maximum = 1U},
      });
    } catch (const std::exception& error) {
      _execution->rollbackRestorationBootstrap();
      _runtime->rollbackRestorationBootstrap(attachment);
      rejectControl(reject, @"nativeProtocolHandshake", [NSString stringWithUTF8String:error.what()]);
      return;
    }
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
      !validString(request.hostSessionScope()) ||
      !hasCompleteRestorationConfiguration(
          _restorationRestoreIdentifier,
          _restorationNamespace,
          _restorationEpoch,
          _restorationClientId,
          _restorationHostSessionScope)) {
    rejectControl(reject, @"nativeRestorationAdoption", @"The restoration request is malformed");
    return;
  }
  try {
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
    if (receipt.outcome == unified_ble::native_protocol::v1::NativeRestorationOutcome::adopted) {
      [_radio consumeRestorationPeerIdentifiers];
    }
    NSMutableArray<NSDictionary*>* replayRecords =
        [NSMutableArray arrayWithCapacity:receipt.records.size()];
    for (const auto& entry : receipt.records) {
      [replayRecords addObject:structuredRestorationReplayRecord(entry.record)];
    }
    resolve(@{
      @"receiptId": [NSString stringWithUTF8String:receipt.receiptId.c_str()],
      @"outcome": [NSString stringWithUTF8String:
          unified_ble::native_protocol::v1::restorationOutcomeName(receipt.outcome)],
      @"boundClientId": [NSString stringWithUTF8String:receipt.boundClientId.c_str()],
      @"adoptionEpoch": [NSString stringWithUTF8String:receipt.adoptionEpoch.c_str()],
      @"replayRecordCount": @(receipt.records.size()),
      @"records": replayRecords,
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
    _radio.delegate = nil;
    _radioDelegate.execution = nullptr;
    _execution->detachAttachment();
    _runtime->close(nativeAttachmentValue);
    _attachment = nil;
    resolve(nil);
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
