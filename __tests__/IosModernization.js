// __tests__/IosModernization.js

const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/\r\n/g, '\n')

describe('iOS and tvOS 4.0 Native Protocol defaults', () => {
  test('targets the current Apple deployment floor', () => {
    const podspec = read('unified-ble-manager.podspec')
    const examplePodfile = read('example/ios/Podfile')

    expect(podspec).toContain('s.platforms    = { :ios => "16.4", :tvos => "16.4" }')
    expect(examplePodfile).toContain("platform :ios, '16.4'")
  })

  test('builds the sole codegen provider as a JSI-backed Unified Protocol control', () => {
    const control = read('ios/UnifiedBleProtocolControl.mm')
    const packageJson = JSON.parse(read('package.json'))

    expect(control).toContain('NativeUnifiedBleProtocolControlSpec')
    expect(control).toContain('RCTTurboModuleWithJSIBindings')
    expect(control).toContain('installJSIBindingsWithRuntime')
    expect(control).toContain('NativeUnifiedBleProtocolControlSpecJSI')
    expect(control).toContain('UnifiedBleProtocolRestoreIdentifier')
    expect(control).not.toMatch(/NativeBlePlx|RCTEventEmitter|Base64/)
    expect(packageJson.codegenConfig.ios.modulesProvider).toEqual({
      UnifiedBleProtocolControl: 'UnifiedBleProtocolControl'
    })
  })

  test('keeps the pod source list explicit and free of the retired bridge tree', () => {
    const podspec = read('unified-ble-manager.podspec')

    expect(podspec).toContain('ios/UnifiedBleProtocolControl.mm')
    expect(podspec).toContain('ios/NativeProtocol/**/*.{h,m,mm}')
    expect(podspec).toContain('ios/Owned/OwnedCoreBluetoothProtocolRadio.swift')
    expect(podspec).toContain('ios/Owned/OwnedCoreBluetoothProtocolRadioSupport.swift')
    expect(podspec).not.toMatch(/ios\/\*\.\{h,m,mm\}|MultiplatformBleAdapter|Restoration|BleAdapter|SafePromise/)
  })

  test('typechecks every interdependent owned Swift source in the tvOS gate', () => {
    const tvosGate = read('scripts/ci/check-tvos-library.sh')
    const radio = read('ios/Owned/OwnedCoreBluetoothProtocolRadio.swift')

    expect(tvosGate).toContain('OwnedCoreBluetoothProtocolRadioCancellation.swift')
    expect(radio).toContain('let desiredCancellationState = cancellationDesiredState(')
    expect(radio).not.toContain('let cancellationDesiredState = cancellationDesiredState(')
  })
})
