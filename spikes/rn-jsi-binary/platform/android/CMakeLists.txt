# spikes/rn-jsi-binary/platform/android/CMakeLists.txt

cmake_minimum_required(VERSION 3.13)
project(ub4jsibinary)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# React Native's Gradle plugin supplies these three paths for every external
# native target. Retain the resolved build context so this target consumes the
# same project/runtime roots that prepared its Prefab dependencies.
set(UB4_REACT_NATIVE_PROJECT_BUILD_DIRECTORY "${PROJECT_BUILD_DIR}")
set(UB4_REACT_NATIVE_PROJECT_ROOT_DIRECTORY "${PROJECT_ROOT_DIR}")
set(UB4_REACT_NATIVE_ANDROID_DIRECTORY "${REACT_ANDROID_DIR}")

find_package(ReactAndroid REQUIRED CONFIG)
find_package(fbjni REQUIRED CONFIG)

add_library(
  ${CMAKE_PROJECT_NAME}
  SHARED
  src/Ub4JsiBinaryBootstrap.cpp
  ../../native/src/Ub4JsiBinaryBinding.cpp
  ../../native/src/Ub4JsiBinaryProtocol.cpp
)

target_include_directories(
  ${CMAKE_PROJECT_NAME}
  PRIVATE
  ../../native/include
)

target_link_libraries(
  ${CMAKE_PROJECT_NAME}
  ReactAndroid::jsi
  ReactAndroid::reactnative
  fbjni::fbjni
)

target_compile_options(
  ${CMAKE_PROJECT_NAME}
  PRIVATE
  -Wall
  -Wextra
  -Werror
)
