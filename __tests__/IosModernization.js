const fs = require('fs')
const path = require('path')

const podspec = fs.readFileSync(path.join(__dirname, '..', 'react-native-ble-plx.podspec'), 'utf8')
const iosHeader = fs.readFileSync(path.join(__dirname, '..', 'ios/BlePlx.h'), 'utf8')
const iosTurboModulePath = path.join(__dirname, '..', 'ios/BlePlxTurboModule.mm')
const iosTurboModule = fs.existsSync(iosTurboModulePath) ? fs.readFileSync(iosTurboModulePath, 'utf8') : ''

describe('iOS modernization defaults', () => {
  test('uses the Expo SDK 57 iOS deployment target floor', () => {
    expect(podspec).toContain('s.platforms    = { :ios => "16.4" }')
  })

  test('points CocoaPods source metadata at this fork', () => {
    expect(podspec).toContain('https://github.com/sfourdrinier/react-native-ble-plx.git')
    expect(podspec).not.toContain('https://github.com/dotintent/react-native-ble-plx.git')
  })

  test('conforms to the generated TurboModule spec on the New Architecture', () => {
    expect(iosHeader).toContain('#import <BlePlxSpec/BlePlxSpec.h>')
    expect(iosHeader).toContain('@interface BlePlx : RCTEventEmitter <NativeBlePlxSpec>')
    expect(fs.existsSync(iosTurboModulePath)).toBe(true)
    expect(iosTurboModule).toContain('#ifdef RCT_NEW_ARCH_ENABLED')
    expect(iosTurboModule).toContain('NativeBlePlxSpecJSI')
    expect(iosTurboModule).toContain('getTurboModule:')
  })
})
