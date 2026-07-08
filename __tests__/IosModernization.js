const fs = require('fs')
const path = require('path')

const podspec = fs.readFileSync(path.join(__dirname, '..', 'react-native-ble-plx.podspec'), 'utf8')
const iosHeader = fs.readFileSync(path.join(__dirname, '..', 'ios/BlePlx.h'), 'utf8')
const iosImplementationPath = path.join(__dirname, '..', 'ios/BlePlx.mm')
const iosImplementation = fs.readFileSync(iosImplementationPath, 'utf8')
const iosXcodeProject = fs.readFileSync(path.join(__dirname, '..', 'ios/BlePlx.xcodeproj/project.pbxproj'), 'utf8')
const examplePodfile = fs.readFileSync(path.join(__dirname, '..', 'example/ios/Podfile'), 'utf8')
const iosTurboModulePath = path.join(__dirname, '..', 'ios/BlePlxTurboModule.mm')
const iosTurboModule = fs.existsSync(iosTurboModulePath) ? fs.readFileSync(iosTurboModulePath, 'utf8') : ''

describe('iOS modernization defaults', () => {
  test('uses the Expo SDK 57 iOS deployment target floor', () => {
    expect(podspec).toContain('s.platforms    = { :ios => "16.4" }')
    expect(examplePodfile).toContain("platform :ios, '16.4'")
  })

  test('points CocoaPods source metadata at this fork', () => {
    expect(podspec).toContain('https://github.com/sfourdrinier/react-native-ble-plx.git')
    expect(podspec).not.toContain('https://github.com/dotintent/react-native-ble-plx.git')
  })

  test('conforms to the generated RN 0.86 TurboModule spec', () => {
    expect(iosHeader).toContain('#import <BlePlxSpec/BlePlxSpec.h>')
    expect(iosHeader).toContain('@interface BlePlx : RCTEventEmitter <NativeBlePlxSpec>')
    expect(fs.existsSync(iosTurboModulePath)).toBe(true)
    expect(fs.existsSync(iosImplementationPath)).toBe(true)
    expect(iosXcodeProject).toContain('BlePlx.mm')
    expect(iosXcodeProject).toContain('sourcecode.cpp.objcpp')
    expect(iosXcodeProject).toContain('IPHONEOS_DEPLOYMENT_TARGET = 16.4;')
    expect(iosXcodeProject).toContain('CLANG_CXX_LANGUAGE_STANDARD = "c++20";')
    expect(iosXcodeProject).toContain('SWIFT_VERSION = 5.0;')
    expect(iosXcodeProject).not.toContain('path = BlePlx.m;')
    expect(iosXcodeProject).not.toContain('IPHONEOS_DEPLOYMENT_TARGET = 12.0;')
    expect(iosXcodeProject).not.toContain('IPHONEOS_DEPLOYMENT_TARGET = 8.0;')
    expect(iosTurboModule).toContain('#ifdef RCT_NEW_ARCH_ENABLED')
    expect(iosTurboModule).toContain('NativeBlePlxSpecJSI')
    expect(iosTurboModule).toContain('getTurboModule:')
  })

  test('implements the generated RN 0.86 iOS TurboModule promise selectors', () => {
    const requiredSelectors = [
      'checkRestorationStatus:(RCTPromiseResolveBlock)resolve',
      'destroyClient:(RCTPromiseResolveBlock)resolve',
      'state:(RCTPromiseResolveBlock)resolve',
      'startDeviceScan:(NSArray*)filteredUUIDs',
      'options:(JS::NativeBlePlx::ScanOptions &)options',
      'NSDictionaryFromScanOptions(options)',
      'stopDeviceScan:(RCTPromiseResolveBlock)resolve',
      'requestConnectionPriorityForDevice:(NSString*)deviceIdentifier',
      'connectionPriority:(double)connectionPriority',
      'requestMTUForDevice:(NSString*)deviceIdentifier',
      'mtu:(double)mtu',
      'devices:(NSArray<NSString*>*)deviceIdentifiers',
      'connectedDevices:(NSArray<NSString*>*)serviceUUIDs',
      'connectToDevice:(NSString*)deviceIdentifier',
      'options:(JS::NativeBlePlx::ConnectionOptions &)options',
      'NSDictionaryFromConnectionOptions(options)',
      'cancelDeviceConnection:(NSString*)deviceIdentifier',
      'isDeviceConnected:(NSString*)deviceIdentifier',
      'discoverAllServicesAndCharacteristicsForDevice:(NSString*)deviceIdentifier',
      'characteristicsForService:(double)serviceIdentifier',
      'descriptorsForCharacteristic:(double)characteristicIdentifier',
      'readCharacteristic:(double)characteristicIdentifier',
      'writeCharacteristic:(double)characteristicIdentifier',
      'monitorCharacteristicForDevice:(NSString*)deviceIdentifier',
      'subscriptionType:(NSString*)subscriptionType',
      'readDescriptor:(double)descriptorIdentifier',
      'writeDescriptor:(double)descriptorIdentifier',
      'enableBackgroundMode:(JS::NativeBlePlx::BackgroundModeOptions &)options',
      'disableBackgroundMode:(RCTPromiseResolveBlock)resolve',
      'updateBackgroundNotification:(JS::NativeBlePlx::BackgroundModeOptions &)options',
      'isBackgroundModeEnabled:(RCTPromiseResolveBlock)resolve',
      'cancelTransaction:(NSString*)transactionId',
      'setLogLevel:(NSString*)logLevel',
      'logLevel:(RCTPromiseResolveBlock)resolve',
      'getConstants',
      'facebook::react::typedConstants<JS::NativeBlePlx::Constants>',
      '[BleEvent scanEvent]',
      '[BleEvent disconnectionEvent]'
    ]

    for (const selector of requiredSelectors) {
      expect(iosImplementation).toContain(selector)
    }

    expect(iosImplementation).not.toContain('resolver:')
    expect(iosImplementation).not.toContain('rejecter:')
    expect(iosImplementation).not.toContain('transactionID:')
    expect(iosImplementation).not.toContain('destroyClient) {')
    expect(iosImplementation).not.toContain('stopDeviceScan) {')
    expect(iosImplementation).toContain('#else\nRCT_EXPORT_METHOD(startDeviceScan:(NSArray*)filteredUUIDs\n                          options:(NSDictionary*)options')
    expect(iosImplementation).toContain('#else\nRCT_EXPORT_METHOD(connectToDevice:(NSString*)deviceIdentifier\n                          options:(NSDictionary*)options')
  })
})
