// ios/BlePlxRuntimeDispatch.h

#import <Foundation/Foundation.h>

FOUNDATION_EXPORT void BlePlxInvokeClassVoidSelector(Class targetClass, SEL selector);
FOUNDATION_EXPORT id BlePlxInvokeClassObjectSelector(Class targetClass, SEL selector);
FOUNDATION_EXPORT void BlePlxInvokeObjectVoidSelector(id target, SEL selector);
FOUNDATION_EXPORT NSInteger BlePlxInvokeObjectIntegerSelector(id target, SEL selector);
