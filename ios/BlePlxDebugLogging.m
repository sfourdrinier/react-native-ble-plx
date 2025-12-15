#import "BlePlxDebugLogging.h"

static NSString *const kBlePlxDebugLoggingInfoPlistKey = @"BlePlxDebugLogging";

BOOL BlePlxDebugLoggingEnabled(void) {
  static dispatch_once_t onceToken;
  static BOOL enabled = NO;

  dispatch_once(&onceToken, ^{
    id value = [[NSBundle mainBundle] objectForInfoDictionaryKey:kBlePlxDebugLoggingInfoPlistKey];
    if ([value respondsToSelector:@selector(boolValue)]) {
      enabled = [value boolValue];
    } else {
      enabled = NO;
    }
  });

  return enabled;
}

void BlePlxDebugLog(NSString *format, ...) {
  if (!BlePlxDebugLoggingEnabled()) {
    return;
  }

  va_list args;
  va_start(args, format);
  NSString *message = [[NSString alloc] initWithFormat:format arguments:args];
  va_end(args);

  NSLog(@"%@", message);
}

