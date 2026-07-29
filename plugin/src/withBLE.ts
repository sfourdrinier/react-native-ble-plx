// plugin/src/withBLE.ts

import { AndroidConfig, type ConfigPlugin, createRunOncePlugin, withInfoPlist } from '@expo/config-plugins'

// Path is ../../package.json because this file is compiled to plugin/build/withBLE.js
const pkg = require('../../package.json')
import { withBLEAndroidManifest } from './withBLEAndroidManifest'
import { BackgroundMode, withBLEBackgroundModes } from './withBLEBackgroundModes'
import { withBluetoothPermissions } from './withBluetoothPermissions'
import { withBLEDebugLogging } from './withBLEDebugLogging'
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
    /** Enables direct Unified BLE Protocol CoreBluetooth restoration when non-empty. */
    iosNativeProtocolRestorationIdentifier?: string
  } | void
> = (config, props = {}) => {
  const _props = props || {}
  const debugEnabled = isBlePlxPluginDebugEnabled(_props.debug)
  blePlxPluginDebugLog(debugEnabled, 'Plugin running with props:', JSON.stringify(props))
  blePlxPluginDebugLog(debugEnabled, 'Package name from pkg.json:', pkg.name)

  config = withBLEDebugLogging(config, { debugEnabled })

  const isBackgroundEnabled = _props.isBackgroundEnabled ?? false
  const neverForLocation = _props.neverForLocation ?? false
  const iosNativeProtocolRestorationIdentifier = _props.iosNativeProtocolRestorationIdentifier
  if (
    iosNativeProtocolRestorationIdentifier !== undefined &&
    (typeof iosNativeProtocolRestorationIdentifier !== 'string' ||
      iosNativeProtocolRestorationIdentifier.trim().length === 0)
  ) {
    throw new Error('iosNativeProtocolRestorationIdentifier must be a non-empty string when configured')
  }
  blePlxPluginDebugLog(
    debugEnabled,
    'iosNativeProtocolRestorationIdentifier configured:',
    iosNativeProtocolRestorationIdentifier !== undefined
  )

  // iOS
  config = withBluetoothPermissions(config, _props)
  config = withBLEBackgroundModes(config, _props.modes || [])

  // Direct CoreBluetooth restoration is owned by the Unified Protocol radio. It needs no
  // second pod, registry, reflection, or 3.x adapter handoff.
  config = withInfoPlist(config, conf => {
    const infoPlist = { ...(conf.modResults as Record<string, unknown>) }
    delete infoPlist.BlePlxRestoreIdentifier
    if (iosNativeProtocolRestorationIdentifier === undefined) {
      delete infoPlist.UnifiedBleProtocolRestoreIdentifier
    } else {
      infoPlist.UnifiedBleProtocolRestoreIdentifier = iosNativeProtocolRestorationIdentifier
    }
    conf.modResults = infoPlist as typeof conf.modResults
    return conf
  })

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

  return config
}

export { BackgroundMode }

export default createRunOncePlugin(withBLE, pkg.name, pkg.version)
