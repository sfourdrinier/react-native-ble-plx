require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))
folly_compiler_flags = '-DFOLLY_NO_CONFIG -DFOLLY_MOBILE=1 -DFOLLY_USE_LIBCPP=1 -Wno-comma -Wno-shorten-64-to-32'

Pod::Spec.new do |s|
  s.name         = "react-native-ble-plx"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => "16.4", :tvos => "16.4" }
  s.source       = { :git => "https://github.com/sfourdrinier/react-native-ble-plx.git", :tag => "v#{s.version}" }

  # MultiplatformBleAdapter (0.2.0) is vendored under ios/vendor and compiled into this
  # pod's own Swift module (module_name "BlePlx", matching the "BlePlx-Swift.h" import in
  # BlePlx.mm) instead of being an external, iOS-only pod dependency. This lets BLE build
  # for both iOS and tvOS. CoreBluetooth central (scan/connect/GATT) is available on tvOS;
  # only state restoration is not, and is guarded with #if os(iOS).
  s.module_name  = "BlePlx"
  s.source_files = "ios/*.{h,m,mm}", "ios/vendor/MultiplatformBleAdapter/**/*.swift"
  s.resource_bundles = { 'BlePlx' => ['ios/PrivacyInfo.xcprivacy'] }
  s.compiler_flags = "-DMULTIPLATFORM_BLE_ADAPTER -fmodules -fcxx-modules"

  # Without :none, CocoaPods treats ALL subspecs as default dependencies of the root pod,
  # so `pod 'react-native-ble-plx'` would always link Restoration (#32). Keep Restoration
  # truly opt-in via `pod 'react-native-ble-plx/Restoration'` (Expo plugin injects that line).
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
    s.compiler_flags = folly_compiler_flags + " -DRCT_NEW_ARCH_ENABLED=1 -DMULTIPLATFORM_BLE_ADAPTER -fmodules -fcxx-modules"
    s.pod_target_xcconfig = {
      "HEADER_SEARCH_PATHS" => "\"$(PODS_ROOT)/boost\"",
      "OTHER_CPLUSPLUSFLAGS" => "-DFOLLY_NO_CONFIG -DFOLLY_MOBILE=1 -DFOLLY_USE_LIBCPP=1",
      "CLANG_CXX_LANGUAGE_STANDARD" => "c++17"
    }
    s.dependency "React-Codegen"
    s.dependency "RCT-Folly"
    s.dependency "RCTRequired"
    s.dependency "RCTTypeSafety"
    s.dependency "ReactCommon/turbomodule/core"
  end
end
