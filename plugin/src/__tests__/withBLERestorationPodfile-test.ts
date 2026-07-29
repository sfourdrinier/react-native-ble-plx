// plugin/src/__tests__/withBLERestorationPodfile-test.ts

import * as fs from 'fs'
import * as path from 'path'
import {
  buildJsPackageCandidates,
  clearBlePlxRestoreIdentifier,
  injectRestorationPodLine,
  removeRestorationPodLine,
  setBlePlxRestoreIdentifier
} from '../withBLERestorationPodfile'

const SAMPLE_PODFILE_AUTOLINKING = `require_relative '../node_modules/react-native/scripts/react_native_pods'

platform :ios, '13.0'

target 'AwesomeApp' do
  config = use_native_modules!

  use_react_native!(
    :path => config[:reactNativePath]
  )
end
`

const SAMPLE_PODFILE_EXPLICIT_UNIFIED = `require_relative '../node_modules/react-native/scripts/react_native_pods'

platform :ios, '13.0'

target 'AwesomeApp' do
  config = use_native_modules!

  pod 'unified-ble-manager', :path => "../node_modules/unified-ble-manager"

  use_react_native!(
    :path => config[:reactNativePath]
  )
end
`

describe('withBLERestorationPodfile', () => {
  it('injects the canonical Restoration pod after use_native_modules!', () => {
    const result = injectRestorationPodLine(SAMPLE_PODFILE_AUTOLINKING)

    const useNativeModulesIndex = result.indexOf('use_native_modules!')
    const markerIndex = result.indexOf('# >>> BLEPLX_RESTORATION_SUBSPEC')
    const useReactNativeIndex = result.indexOf('use_react_native!')

    expect(markerIndex).toBeGreaterThan(useNativeModulesIndex)
    expect(markerIndex).toBeLessThan(useReactNativeIndex)
    expect(result).toContain("bleplx_pod_name = 'unified-ble-manager'")
    expect(result).toContain("bleplx_candidates = ['unified-ble-manager']")
    expect(result).toContain('pod "#{bleplx_pod_name}/Restoration"')
  })

  it('uses the canonical explicit pod path', () => {
    const result = injectRestorationPodLine(SAMPLE_PODFILE_EXPLICIT_UNIFIED)

    expect(result).toContain('pod \'unified-ble-manager/Restoration\', :path => "../node_modules/unified-ble-manager"')
    expect(result.indexOf("pod 'unified-ble-manager/Restoration'")).toBeGreaterThan(
      result.indexOf("pod 'unified-ble-manager', :path =>")
    )
  })

  it('uses only the canonical package candidate', () => {
    expect(buildJsPackageCandidates()).toEqual(['unified-ble-manager'])
  })

  it('is idempotent and removes only canonical restoration configuration', () => {
    const enabled = injectRestorationPodLine(SAMPLE_PODFILE_AUTOLINKING)
    const enabledAgain = injectRestorationPodLine(enabled)
    expect(enabledAgain.match(/# >>> BLEPLX_RESTORATION_SUBSPEC/g)?.length).toBe(1)

    const disabled = removeRestorationPodLine(enabledAgain)
    expect(disabled).not.toContain('# >>> BLEPLX_RESTORATION_SUBSPEC')
    expect(disabled).not.toContain('# <<< BLEPLX_RESTORATION_SUBSPEC')
    expect(disabled).not.toContain('unified-ble-manager/Restoration')
    expect(disabled).toContain('use_native_modules!')
    expect(disabled).toContain('use_react_native!')
  })

  it('keeps the plugin source canonical-only', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'withBLERestorationPodfile.ts'), 'utf8')

    expect(source).toContain('unified-ble-manager')
    expect(source).not.toContain('@sfourdrinier/react-native-ble-plx')
    expect(source).not.toContain('react-native-ble-plx/Restoration')
  })

  it('sets and clears BlePlxRestoreIdentifier', () => {
    const withId = setBlePlxRestoreIdentifier({ CFBundleName: 'App' }, 'com.example.bleplx')
    expect(withId.BlePlxRestoreIdentifier).toBe('com.example.bleplx')
    expect(withId.CFBundleName).toBe('App')

    const cleared = clearBlePlxRestoreIdentifier(withId)
    expect(cleared.BlePlxRestoreIdentifier).toBeUndefined()
    expect(cleared.CFBundleName).toBe('App')
  })
})

jest.mock('expo/config', () => ({
  getNameFromConfig: () => ({ appName: 'App', webName: 'App' }),
  getConfig: () => ({ exp: { name: 'App', slug: 'app', web: {}, ios: {}, android: {} } })
}))
