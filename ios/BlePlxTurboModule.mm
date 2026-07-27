// ios/BlePlxTurboModule.mm

#import "BlePlxRuntimeDispatch.h"

void BlePlxInvokeClassVoidSelector(Class targetClass, SEL selector) {
    IMP implementation = [targetClass methodForSelector:selector];
    if (implementation == NULL) {
        return;
    }
    void (*function)(id, SEL) = (void (*)(id, SEL))implementation;
    function(targetClass, selector);
}

id BlePlxInvokeClassObjectSelector(Class targetClass, SEL selector) {
    IMP implementation = [targetClass methodForSelector:selector];
    if (implementation == NULL) {
        return nil;
    }
    id (*function)(id, SEL) = (id (*)(id, SEL))implementation;
    return function(targetClass, selector);
}

void BlePlxInvokeObjectVoidSelector(id target, SEL selector) {
    IMP implementation = [target methodForSelector:selector];
    if (implementation == NULL) {
        return;
    }
    void (*function)(id, SEL) = (void (*)(id, SEL))implementation;
    function(target, selector);
}

NSInteger BlePlxInvokeObjectIntegerSelector(id target, SEL selector) {
    IMP implementation = [target methodForSelector:selector];
    if (implementation == NULL) {
        return 0;
    }
    NSInteger (*function)(id, SEL) = (NSInteger (*)(id, SEL))implementation;
    return function(target, selector);
}
