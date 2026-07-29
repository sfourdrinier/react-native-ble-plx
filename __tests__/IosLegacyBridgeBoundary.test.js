// __tests__/IosLegacyBridgeBoundary.test.js

const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')

const legacyBridgePaths = Object.freeze([
  'ios/BlePlx-Bridging-Header.h',
  'ios/BlePlx.h',
  'ios/BlePlx.mm',
  'ios/BlePlxDebugLogging.h',
  'ios/BlePlxDebugLogging.m',
  'ios/BlePlxRuntimeDispatch.h',
  'ios/BlePlxTurboModule.mm',
  'ios/Owned/BlePlxRadioQueue.swift',
  'ios/Owned/OwnedCoreBluetoothAdapter.swift',
])

const retiredSourceDirectories = Object.freeze([
  'ios/BlePlx.xcodeproj',
  'ios/Restoration',
  'ios/vendor/MultiplatformBleAdapter'
])

function filesWithin(directoryPath) {
  if (!fs.existsSync(directoryPath)) return []
  return fs.readdirSync(directoryPath, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directoryPath, entry.name)
    return entry.isDirectory() ? filesWithin(entryPath) : [entryPath]
  })
}

const requiredProtocolPaths = Object.freeze([
  'ios/UnifiedBleProtocolControl.mm',
  'ios/NativeProtocol/UnifiedBleProtocolAppleExecution.hpp',
  'ios/NativeProtocol/UnifiedBleProtocolAppleExecution.mm',
  'ios/NativeProtocol/UnifiedBleProtocolAppleBinaryDelivery.hpp',
  'ios/NativeProtocol/UnifiedBleProtocolAppleBinaryDelivery.mm',
  'ios/Owned/OwnedCoreBluetoothProtocolRadio.swift',
  'ios/Owned/OwnedCoreBluetoothProtocolRadioSupport.swift'
])

describe('iOS Native Protocol 4.0 source boundary', () => {
  test('ships only the Unified BLE protocol bridge and owned protocol radio', () => {
    const remainingLegacyPaths = legacyBridgePaths.filter(relativePath =>
      fs.existsSync(path.join(root, relativePath))
    )

    expect(remainingLegacyPaths).toEqual([])
    for (const relativePath of retiredSourceDirectories) {
      const absolutePath = path.join(root, relativePath)
      expect(filesWithin(absolutePath)).toEqual([])
    }
    for (const relativePath of requiredProtocolPaths) {
      expect(fs.existsSync(path.join(root, relativePath))).toBe(true)
    }
  })

  test('does not compile, advertise, or provide the retired BlePlx TurboModule', () => {
    const podspec = fs.readFileSync(path.join(root, 'unified-ble-manager.podspec'), 'utf8')
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    const expoPlugin = fs.readFileSync(path.join(root, 'plugin/src/withBLE.ts'), 'utf8')

    expect(podspec).toContain('ios/UnifiedBleProtocolControl.mm')
    expect(podspec).toContain('ios/NativeProtocol/**/*.{h,m,mm}')
    expect(podspec).toContain('ios/Owned/OwnedCoreBluetoothProtocolRadio.swift')
    expect(podspec).toContain('ios/Owned/OwnedCoreBluetoothProtocolRadioSupport.swift')
    expect(podspec).not.toMatch(/BlePlx(?:TurboModule|RuntimeDispatch|Restoration|RadioQueue|DebugLogging)/)
    expect(podspec).not.toContain('MultiplatformBleAdapter')
    expect(podspec).not.toContain('subspec "Restoration"')
    expect(expoPlugin).toContain('iosNativeProtocolRestorationIdentifier')
    expect(expoPlugin).toContain('UnifiedBleProtocolRestoreIdentifier')
    expect(expoPlugin).not.toContain('withBLERestorationPodfile')
    expect(expoPlugin).not.toContain('iosEnableRestoration')
    expect(packageJson.codegenConfig.ios.modulesProvider).toEqual({
      UnifiedBleProtocolControl: 'UnifiedBleProtocolControl'
    })
  })
})
