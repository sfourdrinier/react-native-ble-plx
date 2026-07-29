// plugin/src/withBLE.ts

import { AndroidConfig, type ConfigPlugin, createRunOncePlugin, withInfoPlist } from '@expo/config-plugins'

// Path is ../../package.json because this file is compiled to plugin/build/withBLE.js
const pkg = require('../../package.json')
import { withBLEAndroidManifest } from './withBLEAndroidManifest'
import { withBLEAndroidForegroundService } from './withBLEAndroidForegroundService'
import { BackgroundMode, withBLEBackgroundModes } from './withBLEBackgroundModes'
import { withBluetoothPermissions } from './withBluetoothPermissions'
import { withBLEDebugLogging } from './withBLEDebugLogging'
import {
  clearBlePlxRestoreIdentifier,
  setBlePlxRestoreIdentifier,
  withBLERestorationPodfile
} from './withBLERestorationPodfile'
import { blePlxPluginDebugLog, isBlePlxPluginDebugEnabled } from './debugLog'

/**
 * Apply BLE native configuration.
 */
const withBLE: ConfigPlugin<
  {
    /** Enable debug logging for this config plugin (also controllable via BLEPLX_PLUGIN_DEBUG=1). */
    debug?: boolean
    isBackgroundEnabled?: boolean
    neverForLocation?: boolean
    modes?: BackgroundMode[]
    bluetoothAlwaysPermission?: string | false
    /** Enable iOS BLE state restoration support (Restoration subspec) */
    iosEnableRestoration?: boolean
    /** Optional custom restoration identifier passed to iOS central manager */
    iosRestorationIdentifier?: string
    /** Enable Android foreground service for background BLE operations */
    androidEnableForegroundService?: boolean
  } | void
> = (config, props = {}) => {
  const _props = props || {}
  const debugEnabled = isBlePlxPluginDebugEnabled(_props.debug)
  blePlxPluginDebugLog(debugEnabled, 'Plugin running with props:', JSON.stringify(props))
  blePlxPluginDebugLog(debugEnabled, 'Package name from pkg.json:', pkg.name)

  config = withBLEDebugLogging(config, { debugEnabled })

  const isBackgroundEnabled = _props.isBackgroundEnabled ?? false
  const neverForLocation = _props.neverForLocation ?? false
  const iosEnableRestoration = _props.iosEnableRestoration ?? false
  const iosRestorationIdentifier = _props.iosRestorationIdentifier ?? 'com.reactnativebleplx.restore'
  const androidEnableForegroundService = _props.androidEnableForegroundService ?? false

  blePlxPluginDebugLog(debugEnabled, 'iosEnableRestoration:', iosEnableRestoration)
  blePlxPluginDebugLog(debugEnabled, 'androidEnableForegroundService:', androidEnableForegroundService)

  // iOS
  config = withBluetoothPermissions(config, _props)
  config = withBLEBackgroundModes(config, _props.modes || [])

  // Always run so true→false flips strip sticky Podfile/plist artifacts (#32).
  if (iosEnableRestoration) {
    blePlxPluginDebugLog(debugEnabled, '✓ iosEnableRestoration is TRUE - adding Restoration subspec')
    blePlxPluginDebugLog(debugEnabled, 'Setting BlePlxRestoreIdentifier in Info.plist:', iosRestorationIdentifier)

    config = withInfoPlist(config, conf => {
      conf.modResults = setBlePlxRestoreIdentifier(
        conf.modResults as Record<string, unknown>,
        iosRestorationIdentifier
      ) as typeof conf.modResults
      return conf
    })

    blePlxPluginDebugLog(debugEnabled, 'Calling withBLERestorationPodfile (enable) for unified-ble-manager')
    config = withBLERestorationPodfile(config, { enable: true })
  } else {
    blePlxPluginDebugLog(
      debugEnabled,
      '✗ iosEnableRestoration is FALSE - removing Restoration subspec / BlePlxRestoreIdentifier if present'
    )

    config = withInfoPlist(config, conf => {
      conf.modResults = clearBlePlxRestoreIdentifier(
        conf.modResults as Record<string, unknown>
      ) as typeof conf.modResults
      return conf
    })

    config = withBLERestorationPodfile(config, { enable: false })
  }

  // Android
  config = AndroidConfig.Permissions.withPermissions(config, [
    'android.permission.BLUETOOTH',
    'android.permission.BLUETOOTH_ADMIN',
    'android.permission.BLUETOOTH_CONNECT' // since Android SDK 31
  ])
  config = withBLEAndroidManifest(config, {
    isBackgroundEnabled,
    neverForLocation
  })

  // Always run so an enabled-to-disabled config transition removes the plugin's sticky FGS entries.
  if (androidEnableForegroundService) {
    blePlxPluginDebugLog(debugEnabled, '✓ androidEnableForegroundService is TRUE - adding foreground service config')
  } else {
    blePlxPluginDebugLog(debugEnabled, '✗ androidEnableForegroundService is FALSE - removing foreground service config')
  }
  config = withBLEAndroidForegroundService(config, {
    enableAndroidForegroundService: androidEnableForegroundService
  })

  return config
}

export { BackgroundMode }

export default createRunOncePlugin(withBLE, pkg.name, pkg.version)
