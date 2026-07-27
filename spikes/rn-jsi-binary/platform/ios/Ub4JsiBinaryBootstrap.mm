// spikes/rn-jsi-binary/platform/ios/Ub4JsiBinaryBootstrap.mm

#import <React/RCTBridgeModule.h>
#import <ReactCommon/RCTInteropTurboModule.h>
#import <ReactCommon/RCTTurboModule.h>
#import <ReactCommon/RCTTurboModuleWithJSIBindings.h>

#include "../../native/include/Ub4JsiBinaryBinding.h"

#include <atomic>
#include <cmath>
#include <memory>
#include <limits>
#include <stdexcept>
#include <string>

namespace {

constexpr const char* kOwner = "ub4-phase0-example";
std::atomic<std::uint64_t> nextRuntimeAttachment{1U};

ub4::rnjsispike::VersionRange versionRange(NSDictionary *request, NSString *key) {
  id rawRange = request[key];
  if (![rawRange isKindOfClass:[NSDictionary class]]) {
    throw std::invalid_argument("A required handshake range is missing");
  }
  NSDictionary *range = (NSDictionary *)rawRange;
  id rawMinimum = range[@"minimum"];
  id rawMaximum = range[@"maximum"];
  if (![rawMinimum isKindOfClass:[NSNumber class]] || ![rawMaximum isKindOfClass:[NSNumber class]]) {
    throw std::invalid_argument("A handshake range must contain numeric bounds");
  }
  const double minimum = [(NSNumber *)rawMinimum doubleValue];
  const double maximum = [(NSNumber *)rawMaximum doubleValue];
  if (!std::isfinite(minimum) || !std::isfinite(maximum) || std::floor(minimum) != minimum ||
      std::floor(maximum) != maximum || minimum < 1.0 || minimum > maximum ||
      maximum > static_cast<double>(std::numeric_limits<std::uint32_t>::max())) {
    throw std::invalid_argument("A handshake range is malformed");
  }
  return {
      .minimum = static_cast<std::uint32_t>(minimum),
      .maximum = static_cast<std::uint32_t>(maximum),
  };
}

ub4::rnjsispike::HandshakeOffer handshakeOffer(NSDictionary *request) {
  id rawOwner = request[@"owner"];
  id rawGeneration = request[@"backendGeneration"];
  const double generation = [rawGeneration isKindOfClass:[NSNumber class]]
      ? [(NSNumber *)rawGeneration doubleValue]
      : 0.0;
  if (![rawOwner isKindOfClass:[NSString class]] ||
      ![(NSString *)rawOwner isEqualToString:[NSString stringWithUTF8String:kOwner]] ||
      ![rawGeneration isKindOfClass:[NSNumber class]] || !std::isfinite(generation) ||
      std::floor(generation) != generation || generation != 1.0) {
    throw std::invalid_argument("The handshake attachment is invalid");
  }
  return {
      .nativeProtocol = versionRange(request, @"nativeProtocol"),
      .abi = versionRange(request, @"abi"),
      .backendContract = versionRange(request, @"backendContract"),
      .capabilitySchema = versionRange(request, @"capabilitySchema"),
      .eventSchema = versionRange(request, @"eventSchema"),
      .traceFormat = versionRange(request, @"traceFormat"),
      .owner = kOwner,
      .backendGeneration = 1U,
  };
}

NSDictionary *handshakeResult(ub4::rnjsispike::HandshakeResult result) {
  return @{
    @"nativeProtocol" : @(result.nativeProtocol),
    @"abi" : @(result.abi),
    @"backendContract" : @(result.backendContract),
    @"capabilitySchema" : @(result.capabilitySchema),
    @"eventSchema" : @(result.eventSchema),
    @"traceFormat" : @(result.traceFormat),
    @"maximumPayloadBytes" : @(result.maximumPayloadBytes),
  };
}

} // namespace

@interface Ub4JsiBinaryBootstrap : NSObject <RCTBridgeModule, RCTTurboModule, RCTTurboModuleWithJSIBindings>
@end

@implementation Ub4JsiBinaryBootstrap {
  std::shared_ptr<ub4::rnjsispike::BinaryJsiBinding> _binding;
}

RCT_EXPORT_MODULE(Ub4JsiBinaryBootstrap)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::ObjCInteropTurboModule>(params);
}

- (void)installJSIBindingsWithRuntime:(facebook::jsi::Runtime &)runtime
                          callInvoker:(const std::shared_ptr<facebook::react::CallInvoker> &)callInvoker
{
  if (_binding) {
    return;
  }
  const auto attachmentNumber = nextRuntimeAttachment.fetch_add(1U, std::memory_order_relaxed);
  _binding = ub4::rnjsispike::BinaryJsiBinding::install(
      runtime,
      callInvoker,
      ub4::rnjsispike::AttachmentTuple{
          .runtimeAttachment = "ios-runtime-" + std::to_string(attachmentNumber),
          .owner = kOwner,
          .backendGeneration = 1U,
      });
}

RCT_EXPORT_METHOD(handshake:(NSDictionary *)request
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
  if (_binding == nullptr) {
    reject(@"E_BINARY_HANDSHAKE", @"The binary binding is unavailable", nil);
    return;
  }
  try {
    resolve(handshakeResult(_binding->activate(handshakeOffer(request))));
  } catch (const ub4::rnjsispike::ProtocolError& error) {
    reject(@"E_BINARY_HANDSHAKE", [NSString stringWithUTF8String:error.what()], nil);
  } catch (const std::exception& error) {
    reject(@"E_BINARY_HANDSHAKE", [NSString stringWithUTF8String:error.what()], nil);
  }
}

RCT_EXPORT_METHOD(emitProbe:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
  if (_binding == nullptr || !_binding->tryEmitProbe()) {
    reject(@"E_BINARY_PROBE", @"The binary probe cannot emit after binding admission closes", nil);
    return;
  }
  resolve(nil);
}

- (void)invalidate
{
  const auto binding = std::move(_binding);
  if (binding) {
    binding->closeAdmission();
    binding->scheduleJavaScriptTeardown();
  }
}

@end
