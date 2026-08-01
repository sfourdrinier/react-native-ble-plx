# native/protocol/CMakeLists.txt

cmake_minimum_required(VERSION 3.20)
project(unified_ble_native_protocol_v1 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

set(
  UNIFIED_BLE_NATIVE_PROTOCOL_CORE_SOURCES
  src/NativeProtocolV1Codec.cpp
  src/NativeProtocolControlRuntime.cpp
  src/NativeProtocolV1Registry.cpp
  src/OwnedBinaryPayloadStore.cpp
)

add_library(
  unified_ble_native_protocol_v1
  STATIC
  ${UNIFIED_BLE_NATIVE_PROTOCOL_CORE_SOURCES}
  src/OwnedJsiBinaryTransport.cpp
)

target_include_directories(
  unified_ble_native_protocol_v1
  PUBLIC
  include
  generated
  ../../node_modules/react-native/ReactCommon/jsi
)

function(unified_ble_enable_strict_warnings target)
  if(MSVC)
    target_compile_options(${target} PRIVATE /W4 /WX)
  else()
    target_compile_options(${target} PRIVATE -Wall -Wextra -Werror)
  endif()
endfunction()

unified_ble_enable_strict_warnings(unified_ble_native_protocol_v1)

option(UNIFIED_BLE_NATIVE_PROTOCOL_BUILD_TESTS "Build Native Protocol v1 tests" ON)

if(UNIFIED_BLE_NATIVE_PROTOCOL_BUILD_TESTS)
  enable_testing()
  add_library(
    unified_ble_native_protocol_v1_host_test_runtime
    STATIC
    ${UNIFIED_BLE_NATIVE_PROTOCOL_CORE_SOURCES}
    tests/OwnedJsiBinaryTransportHostStub.cpp
  )
  target_include_directories(
    unified_ble_native_protocol_v1_host_test_runtime
    PUBLIC
    include
    generated
    ../../node_modules/react-native/ReactCommon/jsi
  )
  unified_ble_enable_strict_warnings(unified_ble_native_protocol_v1_host_test_runtime)
  add_executable(
    unified_ble_native_protocol_v1_tests
    tests/NativeProtocolV1Tests.cpp
  )
  target_link_libraries(
    unified_ble_native_protocol_v1_tests
    PRIVATE
    unified_ble_native_protocol_v1_host_test_runtime
  )
  unified_ble_enable_strict_warnings(unified_ble_native_protocol_v1_tests)
  add_test(
    NAME unified_ble_native_protocol_v1
    COMMAND unified_ble_native_protocol_v1_tests
  )
endif()

option(UNIFIED_BLE_NATIVE_PROTOCOL_BUILD_BENCHMARKS "Build Native Protocol v1 host benchmarks" OFF)

if(UNIFIED_BLE_NATIVE_PROTOCOL_BUILD_BENCHMARKS)
  if(NOT TARGET unified_ble_native_protocol_v1_host_test_runtime)
    add_library(
      unified_ble_native_protocol_v1_host_test_runtime
      STATIC
      ${UNIFIED_BLE_NATIVE_PROTOCOL_CORE_SOURCES}
      tests/OwnedJsiBinaryTransportHostStub.cpp
    )
    target_include_directories(
      unified_ble_native_protocol_v1_host_test_runtime
      PUBLIC
      include
      generated
      ../../node_modules/react-native/ReactCommon/jsi
    )
    unified_ble_enable_strict_warnings(unified_ble_native_protocol_v1_host_test_runtime)
  endif()
  add_executable(
    unified_ble_native_protocol_v1_benchmark
    performance/NativeOwnedPayloadBenchmark.cpp
  )
  target_link_libraries(
    unified_ble_native_protocol_v1_benchmark
    PRIVATE
    unified_ble_native_protocol_v1_host_test_runtime
  )
  unified_ble_enable_strict_warnings(unified_ble_native_protocol_v1_benchmark)
endif()
