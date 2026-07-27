# android/src/main/jni/CMakeLists.txt

cmake_minimum_required(VERSION 3.20)
project(unified_ble_native_protocol LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

set(UNIFIED_BLE_PROJECT_BUILD_DIRECTORY "${PROJECT_BUILD_DIR}")
set(UNIFIED_BLE_PROJECT_ROOT_DIRECTORY "${PROJECT_ROOT_DIR}")
set(UNIFIED_BLE_REACT_ANDROID_DIRECTORY "${REACT_ANDROID_DIR}")

find_package(ReactAndroid REQUIRED CONFIG)
find_package(fbjni REQUIRED CONFIG)

add_library(
  ${CMAKE_PROJECT_NAME}
  SHARED
  ../../../../native/protocol/src/NativeProtocolV1Codec.cpp
  ../../../../native/protocol/src/NativeProtocolControlRuntime.cpp
  ../../../../native/protocol/src/NativeProtocolV1Registry.cpp
  ../../../../native/protocol/src/OwnedBinaryPayloadStore.cpp
  ../../../../native/protocol/src/OwnedJsiBinaryTransport.cpp
  UnifiedBleProtocolControlJni.cpp
  UnifiedBleProtocolJsiBinding.cpp
)

target_include_directories(
  ${CMAKE_PROJECT_NAME}
  PRIVATE
  ../../../../native/protocol/include
  ../../../../native/protocol/generated
)

target_link_libraries(
  ${CMAKE_PROJECT_NAME}
  ReactAndroid::jsi
  ReactAndroid::reactnative
  fbjni::fbjni
  log
)

target_compile_options(
  ${CMAKE_PROJECT_NAME}
  PRIVATE
  -Wall
  -Wextra
  -Werror
)
