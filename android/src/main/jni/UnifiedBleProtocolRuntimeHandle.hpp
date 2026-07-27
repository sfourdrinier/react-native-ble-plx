// android/src/main/jni/UnifiedBleProtocolRuntimeHandle.hpp

#pragma once

#include "../../../../native/protocol/include/NativeProtocolControlRuntime.hpp"

#include <jni.h>

#include <memory>

std::weak_ptr<unified_ble::native_protocol::v1::NativeProtocolControlRuntime>
unifiedBleProtocolRuntimeLease(jlong handle);
