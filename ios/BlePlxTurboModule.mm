#ifdef RCT_NEW_ARCH_ENABLED

#import "BlePlx.h"

#import <memory>
#import <ReactCommon/RCTTurboModule.h>

@implementation BlePlx (TurboModule)

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeBlePlxSpecJSI>(params);
}

@end

#endif
