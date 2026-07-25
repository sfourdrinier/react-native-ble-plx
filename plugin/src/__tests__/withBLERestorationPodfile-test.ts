import * as fs from 'fs'
import * as path from 'path'
import {
  buildJsPackageCandidates,
  clearBlePlxRestoreIdentifier,
  injectRestorationPodLine,
  removeRestorationPodLine,
  setBlePlxRestoreIdentifier
} from '../withBLERestorationPodfile'

// Podfile without explicit pod line (typical Expo autolinking)
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

// Podfile with explicit legacy pod line (3.x monorepo / manual path)
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

// Podfile with explicit 4.0 canonical pod (Path A bare RN)
const SAMPLE_PODFILE_EXPLICIT_UNIFIED = `require_relative '../node_modules/react-native/scripts/react_native_pods'

platform :ios, '13.0'

target 'AwesomeApp' do
  config = use_native_modules!

  pod 'unified-ble-manager', :path => "../node_modules/unified-ble-manager"

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

    it('injects unified-ble-manager/Restoration when pkgName is the 4.0 product (F054/R2-F118)', () => {
      // Source JSDoc must name Path A pod (not stale 3.x react-native-ble-plx/Restoration)
      const src = fs.readFileSync(path.join(__dirname, '..', 'withBLERestorationPodfile.ts'), 'utf8')
      expect(src).toMatch(/Inject opt-in `unified-ble-manager\/Restoration`/)
      expect(src).not.toMatch(/Inject opt-in `react-native-ble-plx\/Restoration`/)

      const result = injectRestorationPodLine(SAMPLE_PODFILE_AUTOLINKING, 'unified-ble-manager')
      expect(result).toContain("bleplx_pod_name = 'unified-ble-manager'")
      expect(result).toContain('pod "#{bleplx_pod_name}/Restoration"')
      // Dual-identity candidates so shim-only autolinking keys still resolve
      expect(result).toContain("'unified-ble-manager'")
      expect(result).toContain("'@sfourdrinier/react-native-ble-plx'")
      expect(result).toContain("'react-native-ble-plx'")
    })

    it('uses autolinking config instead of Node resolution', () => {
      const result = injectRestorationPodLine(SAMPLE_PODFILE_AUTOLINKING, 'react-native-ble-plx')
      expect(result).toContain('config[:dependencies]')
      expect(result).not.toContain('Pod::Executable')
      expect(result).not.toContain('Dir.chdir')
    })
  })

  describe('buildJsPackageCandidates (F054)', () => {
    it('includes dual identity names for canonical package', () => {
      const c = buildJsPackageCandidates('unified-ble-manager', 'unified-ble-manager')
      expect(c[0]).toBe('unified-ble-manager')
      expect(c).toContain('@sfourdrinier/react-native-ble-plx')
      expect(c).toContain('react-native-ble-plx')
      expect(new Set(c).size).toBe(c.length)
    })

    it('includes dual identity names for shim package', () => {
      const c = buildJsPackageCandidates('@sfourdrinier/react-native-ble-plx', 'react-native-ble-plx')
      expect(c).toContain('react-native-ble-plx')
      expect(c).toContain('@sfourdrinier/react-native-ble-plx')
      expect(c).toContain('unified-ble-manager')
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

    it('uses the same path for unified-ble-manager explicit pod (F054)', () => {
      const result = injectRestorationPodLine(SAMPLE_PODFILE_EXPLICIT_UNIFIED, 'unified-ble-manager')
      expect(result).toContain(
        'pod \'unified-ble-manager/Restoration\', :path => "../node_modules/unified-ble-manager"'
      )
      const basePodIndex = result.indexOf("pod 'unified-ble-manager', :path =>")
      const restorationPodIndex = result.indexOf("pod 'unified-ble-manager/Restoration'")
      expect(restorationPodIndex).toBeGreaterThan(basePodIndex)
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

  describe('removeRestorationPodLine (true→false flip, #32)', () => {
    it('removes autolinking marker block after inject', () => {
      const injected = injectRestorationPodLine(SAMPLE_PODFILE_AUTOLINKING, 'react-native-ble-plx')
      expect(injected).toContain('# >>> BLEPLX_RESTORATION_SUBSPEC')
      expect(injected).toContain('/Restoration"')

      const removed = removeRestorationPodLine(injected, 'react-native-ble-plx')
      expect(removed).not.toContain('# >>> BLEPLX_RESTORATION_SUBSPEC')
      expect(removed).not.toContain('# <<< BLEPLX_RESTORATION_SUBSPEC')
      expect(removed).not.toContain('/Restoration')
      // Core Podfile structure remains
      expect(removed).toContain('use_native_modules!')
      expect(removed).toContain('use_react_native!')
    })

    it('removes explicit Restoration pod line without removing base pod', () => {
      const injected = injectRestorationPodLine(SAMPLE_PODFILE_EXPLICIT, '@sfourdrinier/react-native-ble-plx')
      expect(injected).toContain("pod 'react-native-ble-plx/Restoration'")

      const removed = removeRestorationPodLine(injected, '@sfourdrinier/react-native-ble-plx')
      expect(removed).not.toContain('/Restoration')
      expect(removed).toContain("pod 'react-native-ble-plx', :path =>")
    })

    it('is idempotent when Restoration was never injected', () => {
      const again = removeRestorationPodLine(SAMPLE_PODFILE_AUTOLINKING, 'react-native-ble-plx')
      expect(again).toContain('use_native_modules!')
      expect(again).not.toContain('/Restoration')
    })

    it('supports enable then disable round-trip', () => {
      const enabled = injectRestorationPodLine(SAMPLE_PODFILE_AUTOLINKING, 'react-native-ble-plx')
      const disabled = removeRestorationPodLine(enabled, 'react-native-ble-plx')
      const reenabled = injectRestorationPodLine(disabled, 'react-native-ble-plx')
      expect(reenabled).toContain('# >>> BLEPLX_RESTORATION_SUBSPEC')
      expect(reenabled.match(/# >>> BLEPLX_RESTORATION_SUBSPEC/g)?.length).toBe(1)
    })
  })

  describe('BlePlxRestoreIdentifier Info.plist helpers', () => {
    it('sets and clears BlePlxRestoreIdentifier', () => {
      const withId = setBlePlxRestoreIdentifier({ CFBundleName: 'App' }, 'com.example.bleplx')
      expect(withId.BlePlxRestoreIdentifier).toBe('com.example.bleplx')
      expect(withId.CFBundleName).toBe('App')

      const cleared = clearBlePlxRestoreIdentifier(withId)
      expect(cleared.BlePlxRestoreIdentifier).toBeUndefined()
      expect(cleared.CFBundleName).toBe('App')
    })

    it('clear is idempotent when key absent', () => {
      const cleared = clearBlePlxRestoreIdentifier({ CFBundleName: 'App' })
      expect(cleared).toEqual({ CFBundleName: 'App' })
    })
  })
})

jest.mock('expo/config', () => ({
  getNameFromConfig: () => ({ appName: 'App', webName: 'App' }),
  getConfig: () => ({ exp: { name: 'App', slug: 'app', web: {}, ios: {}, android: {} } })
}))
