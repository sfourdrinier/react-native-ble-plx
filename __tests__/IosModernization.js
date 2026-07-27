// __tests__/IosModernization.js

const fs = require('fs')
const path = require('path')

/** Normalize CRLF from Windows checkouts so multiline matchers stay LF-based. */
const readText = p => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

const podspec = readText(path.join(__dirname, '..', 'unified-ble-manager.podspec'))
const iosHeader = readText(path.join(__dirname, '..', 'ios/BlePlx.h'))
const iosImplementationPath = path.join(__dirname, '..', 'ios/BlePlx.mm')
const iosImplementation = readText(iosImplementationPath)
const iosXcodeProject = readText(path.join(__dirname, '..', 'ios/BlePlx.xcodeproj/project.pbxproj'))
const examplePodfile = readText(path.join(__dirname, '..', 'example/ios/Podfile'))
const iosTurboModulePath = path.join(__dirname, '..', 'ios/BlePlxTurboModule.mm')
const iosTurboModule = readText(iosTurboModulePath)
const ownedAdapter = readText(path.join(__dirname, '..', 'ios/Owned/OwnedCoreBluetoothAdapter.swift'))
const exampleAppDelegate = readText(path.join(__dirname, '..', 'example/ios/AppDelegate.swift'))
const exampleInfoPlist = readText(path.join(__dirname, '..', 'example/ios/BlePlxExample/Info.plist'))
const exampleIosProject = readText(
  path.join(__dirname, '..', 'example/ios/BlePlxExample.xcodeproj/project.pbxproj')
)

// Bonding surface exists on iOS as typed OperationNotSupported stubs
const hasBondStubs =
  iosImplementation.includes('createBond:(NSString*)deviceIdentifier') &&
  iosImplementation.includes('removeBond:(NSString*)deviceIdentifier') &&
  iosImplementation.includes('bondedDevices:(RCTPromiseResolveBlock)resolve') &&
  iosImplementation.includes('getBondState:(NSString*)deviceIdentifier')

describe('iOS modernization defaults', () => {
  test('uses the Expo SDK 57 iOS deployment target floor', () => {
    expect(podspec).toContain('s.platforms    = { :ios => "16.4", :tvos => "16.4" }')
    expect(examplePodfile).toContain("platform :ios, '16.4'")
  })

  test('keeps Restoration subspec iOS-only (tvOS has no CoreBluetooth restore)', () => {
    const restorationBlock = podspec.split('subspec "Restoration"')[1]
    expect(restorationBlock).toBeDefined()
    expect(restorationBlock).toMatch(/ss\.platforms\s*=\s*\{\s*:ios\s*=>\s*"16\.4"\s*\}/)
    expect(restorationBlock).not.toMatch(/:tvos/)
  })

  test('Restoration subspec is opt-in only (default_subspecs :none) — #32', () => {
    // CocoaPods without :none would default-link ALL subspecs on root pod install.
    expect(podspec).toMatch(/s\.default_subspecs\s*=\s*:none/)
    expect(podspec).toContain('s.name         = "unified-ble-manager"')
    // Root source_files must not pull Restoration Swift into the base pod.
    const rootSourceMatch = podspec.match(/s\.source_files\s*=\s*[^\n]+/)
    expect(rootSourceMatch).toBeTruthy()
    expect(rootSourceMatch[0]).not.toMatch(/ios\/Restoration/)
    expect(podspec).toContain('ios/Restoration/**/*.{h,m,mm,swift}')
    // Subspec still declared for explicit pod '…/Restoration'
    expect(podspec).toContain('subspec "Restoration"')
  })

  test('points CocoaPods source metadata at this fork', () => {
    expect(podspec).toContain('https://github.com/sfourdrinier/react-native-ble-plx.git')
    expect(podspec).toContain(':tag => "v#{s.version}"')
    expect(podspec).not.toContain('https://github.com/dotintent/react-native-ble-plx.git')
  })

  test('conforms to the generated RN 0.86 TurboModule spec', () => {
    expect(iosHeader).toContain('#import <BlePlxSpec/BlePlxSpec.h>')
    expect(iosHeader).toContain('@interface BlePlx : RCTEventEmitter <NativeBlePlxSpec>')
    // RN 0.86 asks RCTModuleProviders for getTurboModule: on the primary class.
    // A category can compile yet remain invisible to protocol-conformance analysis.
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
    expect(iosImplementation).toContain('#include <memory>')
    expect(iosImplementation).toContain('#ifdef RCT_NEW_ARCH_ENABLED')
    expect(iosImplementation).toContain('NativeBlePlxSpecJSI')
    expect(iosImplementation).toContain('getTurboModule:')
    expect(iosImplementation).toContain('@interface BlePlx () <BleClientManagerDelegate>')
    expect(iosImplementation).not.toContain('@implementation BlePlx (TurboModule)')
    expect(iosTurboModule).not.toContain('@implementation BlePlx')
    expect(iosTurboModule).toContain('BlePlxInvokeClassVoidSelector')
  })

  test('keeps optional restoration dispatch type-safe without warning suppression', () => {
    const optionalSelectors = [
      'NSSelectorFromString(@"register")',
      'NSSelectorFromString(@"shared")',
      'NSSelectorFromString(@"adapterCount")',
      'NSSelectorFromString(@"takeRestoredManager")',
      'NSSelectorFromString(@"takeRestoredStatePayload")',
      'NSSelectorFromString(@"completePendingRestoreStateEvent")'
    ]

    for (const selector of optionalSelectors) {
      expect(iosImplementation).toContain(selector)
    }

    expect(iosImplementation).not.toContain('performSelector')
    expect(iosImplementation).not.toContain('valueForKey:@"adapterCount"')
    expect(iosImplementation).not.toContain('#pragma clang diagnostic')
    expect(iosImplementation).not.toMatch(
      /@selector\((?:register|adapterCount|takeRestoredManager|takeRestoredStatePayload)\)/
    )
    expect(iosImplementation).toContain('[super invalidate]')
  })

  test('represents optional scan names without implicit optional-to-Any coercion', () => {
    expect(ownedAdapter).not.toContain('device["name"] = (peripheral.name ?? localName) as Any')
    expect(ownedAdapter).not.toContain('device["localName"] = (localName as Any?) ?? NSNull()')
    expect(ownedAdapter).toMatch(/if let name = peripheral\.name \?\? localName \{[\s\S]*device\["name"\] = name/)
    expect(ownedAdapter).toMatch(/if let localName \{[\s\S]*device\["localName"\] = localName/)
  })

  test('starts the example with the RN 0.86 factory, not deprecated RCTAppDelegate', () => {
    expect(exampleAppDelegate).toContain('RCTDefaultReactNativeFactoryDelegate')
    expect(exampleAppDelegate).toContain('RCTReactNativeFactory(delegate: self)')
    expect(exampleAppDelegate).toContain('startReactNative(')
    expect(exampleAppDelegate).toContain('dependencyProvider = RCTAppDependencyProvider()')
    expect(exampleAppDelegate).toContain('let window = UIWindow(frame: UIScreen.main.bounds)')
    expect(exampleAppDelegate).toContain('self.window = window')
    expect(exampleAppDelegate).toContain('in: window')
    expect(exampleAppDelegate).not.toMatch(/class AppDelegate:\s*RCTAppDelegate/)
    expect(exampleAppDelegate).not.toContain('sourceURL(for bridge')
  })

  test('declares the permissions and background mode actually required by the restoration demo', () => {
    expect(exampleInfoPlist).toContain('NSBluetoothAlwaysUsageDescription')
    expect(exampleInfoPlist).toMatch(/NSBluetoothAlwaysUsageDescription<\/key>\s*<string>[^<]+<\/string>/)
    expect(exampleInfoPlist).not.toContain('NSLocationWhenInUseUsageDescription')
    expect(exampleInfoPlist).toMatch(/UIBackgroundModes<\/key>\s*<array>\s*<string>bluetooth-central<\/string>/)
  })

  test('marks the React Native bundle phase intentionally always out of date', () => {
    const bundlePhaseStart = exampleIosProject.indexOf(
      '00DD1BFF1BD5951E006B06BC /* Bundle React Native code and images */ = {'
    )
    const bundlePhaseEnd = exampleIosProject.indexOf('[CP] Embed Pods Frameworks', bundlePhaseStart)
    const bundlePhase = exampleIosProject.slice(bundlePhaseStart, bundlePhaseEnd)

    expect(bundlePhaseStart).toBeGreaterThan(-1)
    expect(bundlePhase).toContain('alwaysOutOfDate = 1;')
    expect(bundlePhase).toMatch(/outputPaths = \(\s*\);/)
  })

  test('inherits the C++ runtime instead of linking it twice in the example app target', () => {
    const debugStart = exampleIosProject.indexOf('13B07F941A680F5B00A75B9A /* Debug */ = {')
    const releaseStart = exampleIosProject.indexOf('13B07F951A680F5B00A75B9A /* Release */ = {')
    const projectDebugStart = exampleIosProject.indexOf('83CBBA201A601CBA00E9B192 /* Debug */ = {')
    const appDebugConfiguration = exampleIosProject.slice(debugStart, releaseStart)
    const appReleaseConfiguration = exampleIosProject.slice(releaseStart, projectDebugStart)

    expect(debugStart).toBeGreaterThan(-1)
    expect(releaseStart).toBeGreaterThan(-1)
    expect(projectDebugStart).toBeGreaterThan(-1)
    expect(appDebugConfiguration).toContain('"$(inherited)",')
    expect(appReleaseConfiguration).toContain('"$(inherited)",')
    expect(appDebugConfiguration).not.toContain('"-lc++",')
    expect(appReleaseConfiguration).not.toContain('"-lc++",')
  })

  test('implements the generated RN 0.86 iOS TurboModule promise selectors', () => {
    const requiredSelectors = [
      'createClient:(NSString * _Nullable)restoreIdentifierKey',
      'checkRestorationStatus:(RCTPromiseResolveBlock)resolve',
      'destroyClient:(RCTPromiseResolveBlock)resolve',
      'state:(RCTPromiseResolveBlock)resolve',
      'startDeviceScan:(NSArray * _Nullable)filteredUUIDs',
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
      'subscriptionType:(NSString * _Nullable)subscriptionType',
      'readDescriptor:(double)descriptorIdentifier',
      'writeDescriptor:(double)descriptorIdentifier',
      'enableBackgroundMode:(JS::NativeBlePlx::BackgroundModeOptions &)options',
      'disableBackgroundMode:(RCTPromiseResolveBlock)resolve',
      'updateBackgroundNotification:(JS::NativeBlePlx::BackgroundModeOptions &)options',
      'isBackgroundModeEnabled:(RCTPromiseResolveBlock)resolve',
      'createBond:(NSString*)deviceIdentifier',
      'removeBond:(NSString*)deviceIdentifier',
      'bondedDevices:(RCTPromiseResolveBlock)resolve',
      'getBondState:(NSString*)deviceIdentifier',
      'cancelTransaction:(NSString*)transactionId',
      'setLogLevel:(NSString*)logLevel',
      'logLevel:(RCTPromiseResolveBlock)resolve',
      'getConstants',
      'facebook::react::typedConstants<JS::NativeBlePlx::Constants>',
      '[BleEvent scanEvent]',
      '[BleEvent disconnectionEvent]',
      '[BleEvent servicesChangedEvent]',
      '.ServicesChangedEvent = [BleEvent servicesChangedEvent]'
    ]

    expect(hasBondStubs).toBe(true)
    for (const selector of requiredSelectors) {
      expect(iosImplementation).toContain(selector)
    }

    expect(iosImplementation).not.toContain('resolver:')
    expect(iosImplementation).not.toContain('rejecter:')
    expect(iosImplementation).not.toContain('transactionID:')
    expect(iosImplementation).not.toContain('destroyClient) {')
    expect(iosImplementation).not.toContain('stopDeviceScan) {')
    expect(iosImplementation).toContain('#else\nRCT_EXPORT_METHOD(startDeviceScan:(NSArray * _Nullable)filteredUUIDs\n                          options:(NSDictionary*)options')
    expect(iosImplementation).toContain('#else\nRCT_EXPORT_METHOD(connectToDevice:(NSString*)deviceIdentifier\n                          options:(NSDictionary*)options')
  })
})
