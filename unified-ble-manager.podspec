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

  # 4.0 GA: default radio is owned CoreBluetooth (ios/Owned) + thin BleAdapter protocol.
  # Legacy MultiplatformBleAdapter/RxBluetoothKit sources remain under ios/vendor for
  # archaeology but are NOT compiled on the default product path.
  s.module_name  = "BlePlx"
  s.source_files = [
    "ios/*.{h,m,mm}",
    "ios/Generated/**/*.swift",
    "ios/NativeProtocol/**/*.{h,m,mm}",
    "ios/Owned/**/*.swift",
    "native/protocol/src/**/*.cpp",
    "ios/vendor/MultiplatformBleAdapter/classes/BleAdapter.swift",
    "ios/vendor/MultiplatformBleAdapter/classes/BleAdapterFactory.swift",
    "ios/vendor/MultiplatformBleAdapter/classes/BleEvent.swift",
    # SafePromise only — DisposableMap is RxSwift-era and is not used by Owned radio.
    "ios/vendor/MultiplatformBleAdapter/classes/Utils/SafePromise.swift"
  ]
  s.preserve_paths = [
    "native/protocol/include/**/*.hpp",
    "native/protocol/generated/**/*.hpp"
  ]
  s.exclude_files = [
    "ios/vendor/MultiplatformBleAdapter/classes/BleModule.swift",
    "ios/vendor/MultiplatformBleAdapter/classes/Utils/DisposableMap.swift",
    "ios/vendor/MultiplatformBleAdapter/RxBluetoothKit/**/*",
    "ios/vendor/MultiplatformBleAdapter/RxSwift/**/*"
  ]
  s.resource_bundles = { 'BlePlx' => ['ios/PrivacyInfo.xcprivacy'] }
  s.frameworks = "CoreBluetooth"
  # Do not add -fmodules/-fcxx-modules: under -fcxx-modules, clang can emit fmt
  # inline functions (via RCT-Folly) as strong definitions in BlePlx.o /
  # BlePlxTurboModule.o, causing duplicate-symbol link failures when RN is built
  # from source (libfmt.a). See #31.
  s.compiler_flags = "-DOWNED_COREBLUETOOTH_RADIO=1"
  s.pod_target_xcconfig = {
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++20"
  }

  # Without :none, CocoaPods treats ALL subspecs as default dependencies of the root pod,
  # so `pod 'react-native-ble-plx'` would always link Restoration (#32). Keep Restoration
  # truly opt-in via `pod 'unified-ble-manager/Restoration'` (Expo plugin injects that line).
  s.default_subspecs = :none

  # Optional BLE state restoration support (opt-in only). iOS-only: CoreBluetooth
  # state restoration APIs are API_UNAVAILABLE(tvos). The iOS-only platform on this
  # subspec keeps it out of the tvOS build.
  s.subspec "Restoration" do |ss|
    ss.platforms = { :ios => "16.4" }
    ss.source_files = "ios/Restoration/**/*.{h,m,mm,swift}"
    # No external dependency - BleRestorationRegistry is now bundled
  end

  # Use install_modules_dependencies helper to install the dependencies if React Native version >=0.71.0.
  if respond_to?(:install_modules_dependencies, true)
    install_modules_dependencies(s)
  else
    s.dependency "React-Core"
    s.compiler_flags = folly_compiler_flags + " -DRCT_NEW_ARCH_ENABLED=1 -DMULTIPLATFORM_BLE_ADAPTER"
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
