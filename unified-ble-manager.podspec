# unified-ble-manager.podspec

require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))
folly_compiler_flags = '-DFOLLY_NO_CONFIG -DFOLLY_MOBILE=1 -DFOLLY_USE_LIBCPP=1 -Wno-comma -Wno-shorten-64-to-32'

Pod::Spec.new do |s|
  s.name         = "unified-ble-manager"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => "16.4", :tvos => "16.4" }
  s.source       = { :git => "https://github.com/sfourdrinier/react-native-ble-plx.git", :tag => "v#{s.version}" }

  # The 4.0 product is the Unified BLE Protocol control module and its owned
  # CoreBluetooth radio. Keep this list explicit: the retired 3.x bridge must never
  # be pulled into an Apple target through a future glob expansion.
  s.module_name  = "BlePlx"
  s.source_files = [
    "ios/UnifiedBleProtocolControl.mm",
    "ios/Generated/**/*.swift",
    "ios/NativeProtocol/**/*.{h,m,mm}",
    "ios/Owned/OwnedCoreBluetoothCentralDelegate.swift",
    "ios/Owned/OwnedCoreBluetoothProtocolRadioDescriptors.swift",
    "ios/Owned/OwnedCoreBluetoothProtocolRadio.swift",
    "ios/Owned/OwnedCoreBluetoothProtocolRadioCancellation.swift",
    "ios/Owned/OwnedCoreBluetoothProtocolRadioSupport.swift",
    "native/protocol/src/**/*.cpp"
  ]
  s.preserve_paths = [
    "native/protocol/include/**/*.hpp",
    "native/protocol/generated/**/*.hpp"
  ]
  s.resource_bundles = { 'BlePlx' => ['ios/PrivacyInfo.xcprivacy'] }
  s.frameworks = "CoreBluetooth"
  # Do not add -fmodules/-fcxx-modules: React Native's source build owns the
  # C++ module configuration and duplicate definitions otherwise become possible.
  s.compiler_flags = "-DOWNED_COREBLUETOOTH_RADIO=1"
  s.pod_target_xcconfig = {
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++20"
  }

  # Use install_modules_dependencies helper to install the dependencies if React Native version >=0.71.0.
  if respond_to?(:install_modules_dependencies, true)
    install_modules_dependencies(s)
  else
    s.dependency "React-Core"
    s.compiler_flags = folly_compiler_flags + " -DRCT_NEW_ARCH_ENABLED=1"
    s.pod_target_xcconfig = {
      "HEADER_SEARCH_PATHS" => "\"$(PODS_ROOT)/boost\"",
      "OTHER_CPLUSPLUSFLAGS" => "-DFOLLY_NO_CONFIG -DFOLLY_MOBILE=1 -DFOLLY_USE_LIBCPP=1",
      "CLANG_CXX_LANGUAGE_STANDARD" => "c++20"
    }
    s.dependency "React-Codegen"
    s.dependency "RCT-Folly"
    s.dependency "RCTRequired"
    s.dependency "RCTTypeSafety"
    s.dependency "ReactCommon/turbomodule/core"
  end
end
