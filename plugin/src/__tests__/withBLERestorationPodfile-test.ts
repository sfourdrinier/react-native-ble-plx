import { injectRestorationPodLine } from '../withBLERestorationPodfile'

// Podfile without explicit react-native-ble-plx pod line (typical Expo autolinking)
const SAMPLE_PODFILE_AUTOLINKING = `require_relative '../node_modules/react-native/scripts/react_native_pods'
require_relative '../node_modules/@react-native-community/cli-platform-ios/native_modules'

platform :ios, '13.0'

target 'AwesomeApp' do
  config = use_native_modules!

  use_react_native!(
    :path => config[:reactNativePath]
  )

  target 'AwesomeAppTests' do
    inherit! :complete
  end
end

post_install do |installer|
  react_native_post_install(installer)
end
`

// Podfile with explicit react-native-ble-plx pod line (monorepo scenario)
const SAMPLE_PODFILE_EXPLICIT = `require_relative '../node_modules/react-native/scripts/react_native_pods'

platform :ios, '13.0'

target 'AwesomeApp' do
  config = use_native_modules!

  pod 'react-native-ble-plx', :path => "../../../node_modules/@sfourdrinier/react-native-ble-plx"

  use_react_native!(
    :path => config[:reactNativePath]
  )
end

post_install do |installer|
  react_native_post_install(installer)
end
`

describe('withBLERestorationPodfile', () => {
  describe('with Expo autolinking (no explicit pod line)', () => {
    it('injects Ruby snippet after use_native_modules!', () => {
      const result = injectRestorationPodLine(SAMPLE_PODFILE_AUTOLINKING, 'react-native-ble-plx')

      expect(result).toContain('# >>> BLEPLX_RESTORATION_SUBSPEC')
      expect(result).toContain('# <<< BLEPLX_RESTORATION_SUBSPEC')
      expect(result).toContain("'react-native-ble-plx'")
    })

    it('injects after use_native_modules! and before use_react_native!', () => {
      const result = injectRestorationPodLine(SAMPLE_PODFILE_AUTOLINKING, 'react-native-ble-plx')

      const useNativeModulesIndex = result.indexOf('use_native_modules!')
      const markerIndex = result.indexOf('# >>> BLEPLX_RESTORATION_SUBSPEC')
      const useReactNativeIndex = result.indexOf('use_react_native!')

      expect(markerIndex).toBeGreaterThan(useNativeModulesIndex)
      expect(markerIndex).toBeLessThan(useReactNativeIndex)
    })

    it('handles scoped package names', () => {
      const result = injectRestorationPodLine(SAMPLE_PODFILE_AUTOLINKING, '@sfourdrinier/react-native-ble-plx')
      expect(result).toContain("bleplx_pod_name = 'react-native-ble-plx'")
      expect(result).toContain("'react-native-ble-plx'")
      expect(result).toContain("'@sfourdrinier/react-native-ble-plx'")
    })

    it('uses autolinking config instead of Node resolution', () => {
      const result = injectRestorationPodLine(SAMPLE_PODFILE_AUTOLINKING, 'react-native-ble-plx')
      expect(result).toContain('config[:dependencies]')
      expect(result).not.toContain('Pod::Executable')
      expect(result).not.toContain('Dir.chdir')
    })
  })

  describe('with explicit pod line (monorepo)', () => {
    it('uses the same path as the existing pod', () => {
      const result = injectRestorationPodLine(SAMPLE_PODFILE_EXPLICIT, '@sfourdrinier/react-native-ble-plx')
      expect(result).toContain(
        'pod \'react-native-ble-plx/Restoration\', :path => "../../../node_modules/@sfourdrinier/react-native-ble-plx"'
      )
    })

    it('inserts right after the base pod line', () => {
      const result = injectRestorationPodLine(SAMPLE_PODFILE_EXPLICIT, '@sfourdrinier/react-native-ble-plx')

      const basePodIndex = result.indexOf("pod 'react-native-ble-plx', :path =>")
      const restorationPodIndex = result.indexOf("pod 'react-native-ble-plx/Restoration'")
      const useReactNativeIndex = result.indexOf('use_react_native!')

      expect(restorationPodIndex).toBeGreaterThan(basePodIndex)
      expect(restorationPodIndex).toBeLessThan(useReactNativeIndex)
    })
  })

  describe('idempotency', () => {
    it('is idempotent for autolinking scenario', () => {
      const initial = injectRestorationPodLine(SAMPLE_PODFILE_AUTOLINKING, 'react-native-ble-plx')
      const again = injectRestorationPodLine(initial, 'react-native-ble-plx')
      expect(again.match(/# >>> BLEPLX_RESTORATION_SUBSPEC/g)?.length).toBe(1)
    })

    it('is idempotent for explicit pod scenario', () => {
      const initial = injectRestorationPodLine(SAMPLE_PODFILE_EXPLICIT, '@sfourdrinier/react-native-ble-plx')
      const again = injectRestorationPodLine(initial, '@sfourdrinier/react-native-ble-plx')
      expect(again.match(/react-native-ble-plx\/Restoration/g)?.length).toBe(1)
    })
  })
})

jest.mock('expo/config', () => ({
  getNameFromConfig: () => ({ appName: 'App', webName: 'App' }),
  getConfig: () => ({ exp: { name: 'App', slug: 'app', web: {}, ios: {}, android: {} } })
}))
