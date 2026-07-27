# spikes/rn-jsi-binary/CMakeLists.txt

cmake_minimum_required(VERSION 3.24)

project(ub4_rn_jsi_binary_spike LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

get_filename_component(REPOSITORY_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../.." ABSOLUTE)
set(REACT_NATIVE_ROOT "${REPOSITORY_ROOT}/node_modules/react-native")

find_package(Threads REQUIRED)

add_library(ub4_jsi_binary_protocol STATIC
  native/src/Ub4JsiBinaryProtocol.cpp
)
target_include_directories(ub4_jsi_binary_protocol PUBLIC native/include)
target_compile_options(ub4_jsi_binary_protocol PRIVATE -Wall -Wextra -Werror)

add_library(ub4_jsi_binary_binding OBJECT
  native/src/Ub4JsiBinaryBinding.cpp
)
target_include_directories(ub4_jsi_binary_binding PRIVATE
  native/include
  "${REACT_NATIVE_ROOT}/ReactCommon/jsi"
  "${REACT_NATIVE_ROOT}/ReactCommon/callinvoker"
  "${REACT_NATIVE_ROOT}/ReactCommon"
)
target_compile_options(ub4_jsi_binary_binding PRIVATE -Wall -Wextra -Werror)

add_executable(ub4_jsi_binary_protocol_test
  tests/ub4_jsi_binary_protocol_test.cpp
)
target_link_libraries(ub4_jsi_binary_protocol_test PRIVATE ub4_jsi_binary_protocol Threads::Threads)
target_compile_options(ub4_jsi_binary_protocol_test PRIVATE -Wall -Wextra -Werror)

enable_testing()
add_test(NAME ub4_jsi_binary_protocol_test COMMAND ub4_jsi_binary_protocol_test)
