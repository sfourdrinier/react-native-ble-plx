// plugin/src/withBLE.ts

import { AndroidConfig, type ConfigPlugin, createRunOncePlugin, withInfoPlist } from '@expo/config-plugins'

// Path is ../../package.json because this file is compiled to plugin/build/withBLE.js
const pkg = require('../../package.json')
import { withBLEAndroidManifest } from './withBLEAndroidManifest'
import { BackgroundMode, withBLEBackgroundModes } from './withBLEBackgroundModes'
import { withBluetoothPermissions } from './withBluetoothPermissions'
import { withBLEDebugLogging } from './withBLEDebugLogging'
import { blePlxPluginDebugLog, isBlePlxPluginDebugEnabled } from './debugLog'

export interface IosNativeProtocolRestorationConfig {
  /** The one CoreBluetooth restoration identifier owned by this app host. */
  readonly identifier: string
  /** The restoration journal namespace accepted by the native provider. */
  readonly namespace: string
  /** The restoration generation expected by the JavaScript adoption request. */
  readonly epoch: string
  /** The only client identity allowed to adopt the configured restoration journal. */
  readonly clientId: string
  /** The stable host scope bound to the configured client identity. */
  readonly hostSessionScope: string
}

export interface UnifiedBlePluginOptions {
  /** Enable debug logging for this config plugin (also controllable via BLEPLX_PLUGIN_DEBUG=1). */
  readonly debug?: boolean
  readonly isBackgroundEnabled?: boolean
  readonly neverForLocation?: boolean
  readonly modes?: readonly BackgroundMode[]
  readonly bluetoothAlwaysPermission?: string | false
  /** Complete native restoration identity. Partial restoration configuration is rejected. */
  readonly iosNativeProtocolRestoration?: IosNativeProtocolRestorationConfig
}

const pluginOptionNames = Object.freeze([
  'debug',
  'isBackgroundEnabled',
  'neverForLocation',
  'modes',
  'bluetoothAlwaysPermission',
  'iosNativeProtocolRestoration'
])

const restorationPropertyNames = Object.freeze(['identifier', 'namespace', 'epoch', 'clientId', 'hostSessionScope'])

const restorationInfoPlistKeys = Object.freeze([
  'UnifiedBleProtocolRestoreIdentifier',
  'UnifiedBleProtocolRestorationNamespace',
  'UnifiedBleProtocolRestorationEpoch',
  'UnifiedBleProtocolRestorationClientId',
  'UnifiedBleProtocolRestorationHostSessionScope'
])

function isConfigurationObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rejectUnknownProperties(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const expectedSorted = [...expected].sort()
  const unknown = actual.filter(property => !expectedSorted.includes(property))
  if (unknown.length > 0) {
    throw new Error(`${label} contains unsupported properties: ${unknown.join(', ')}`)
  }
}

function requireExactProperties(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  rejectUnknownProperties(value, expected, label)
  const actual = Object.keys(value)
  if (actual.length !== expected.length) {
    throw new Error(`${label} must contain exactly these properties: ${[...expected].sort().join(', ')}`)
  }
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean when configured`)
  }
  return value
}

function requiredNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

function optionalBackgroundModes(value: unknown): readonly BackgroundMode[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    throw new Error('modes must be an array when configured')
  }
  const modes: BackgroundMode[] = []
  for (const mode of value) {
    if (mode !== BackgroundMode.Central && mode !== BackgroundMode.Peripheral) {
      throw new Error(`modes contains an unsupported background mode: ${String(mode)}`)
    }
    if (modes.includes(mode)) {
      throw new Error(`modes must not contain a duplicate background mode: ${mode}`)
    }
    modes.push(mode)
  }
  return Object.freeze(modes)
}

function optionalBluetoothAlwaysPermission(value: unknown): string | false | undefined {
  if (value === undefined || value === false) return value
  return requiredNonEmptyString(value, 'bluetoothAlwaysPermission')
}

function optionalNativeProtocolRestoration(value: unknown): IosNativeProtocolRestorationConfig | undefined {
  if (value === undefined) return undefined
  if (!isConfigurationObject(value)) {
    throw new Error('iosNativeProtocolRestoration must be an object when configured')
  }
  requireExactProperties(value, restorationPropertyNames, 'iosNativeProtocolRestoration')
  return Object.freeze({
    identifier: requiredNonEmptyString(value.identifier, 'iosNativeProtocolRestoration.identifier'),
    namespace: requiredNonEmptyString(value.namespace, 'iosNativeProtocolRestoration.namespace'),
    epoch: requiredNonEmptyString(value.epoch, 'iosNativeProtocolRestoration.epoch'),
    clientId: requiredNonEmptyString(value.clientId, 'iosNativeProtocolRestoration.clientId'),
    hostSessionScope: requiredNonEmptyString(value.hostSessionScope, 'iosNativeProtocolRestoration.hostSessionScope')
  })
}

/** Rejects incomplete, retired, and type-coerced plugin configuration before any native mods run. */
export function validateBlePluginOptions(value: unknown): UnifiedBlePluginOptions {
  if (value === undefined) return Object.freeze({})
  if (!isConfigurationObject(value)) {
    throw new Error('unified-ble-manager Expo plugin options must be an object when configured')
  }
  rejectUnknownProperties(value, pluginOptionNames, 'unified-ble-manager Expo plugin options')
  return Object.freeze({
    debug: optionalBoolean(value.debug, 'debug'),
    isBackgroundEnabled: optionalBoolean(value.isBackgroundEnabled, 'isBackgroundEnabled'),
    neverForLocation: optionalBoolean(value.neverForLocation, 'neverForLocation'),
    modes: optionalBackgroundModes(value.modes),
    bluetoothAlwaysPermission: optionalBluetoothAlwaysPermission(value.bluetoothAlwaysPermission),
    iosNativeProtocolRestoration: optionalNativeProtocolRestoration(value.iosNativeProtocolRestoration)
  })
}

/** Writes or clears every native restoration identity value as one validated configuration unit. */
export function applyNativeProtocolRestorationInfoPlist(
  infoPlist: Record<string, unknown>,
  restoration: IosNativeProtocolRestorationConfig | undefined = undefined
): Record<string, unknown> {
  delete infoPlist.BlePlxRestoreIdentifier
  for (const key of restorationInfoPlistKeys) {
    delete infoPlist[key]
  }
  if (restoration === undefined) return infoPlist
  infoPlist.UnifiedBleProtocolRestoreIdentifier = restoration.identifier
  infoPlist.UnifiedBleProtocolRestorationNamespace = restoration.namespace
  infoPlist.UnifiedBleProtocolRestorationEpoch = restoration.epoch
  infoPlist.UnifiedBleProtocolRestorationClientId = restoration.clientId
  infoPlist.UnifiedBleProtocolRestorationHostSessionScope = restoration.hostSessionScope
  return infoPlist
}

/**
 * Apply BLE native configuration.
 */
const withBLE: ConfigPlugin<UnifiedBlePluginOptions | void> = (config, props) => {
  const validatedProps = validateBlePluginOptions(props)
  const debugEnabled = isBlePlxPluginDebugEnabled(validatedProps.debug)
  blePlxPluginDebugLog(debugEnabled, 'Plugin running with props:', JSON.stringify(props))
  blePlxPluginDebugLog(debugEnabled, 'Package name from pkg.json:', pkg.name)

  config = withBLEDebugLogging(config, { debugEnabled })

  blePlxPluginDebugLog(
    debugEnabled,
    'iosNativeProtocolRestoration configured:',
    validatedProps.iosNativeProtocolRestoration !== undefined
  )

  // iOS
  config = withBluetoothPermissions(config, validatedProps)
  config = withBLEBackgroundModes(config, [...(validatedProps.modes ?? [])])

  config = withInfoPlist(config, conf => {
    applyNativeProtocolRestorationInfoPlist(conf.modResults, validatedProps.iosNativeProtocolRestoration)
    return conf
  })

  // Android
  config = AndroidConfig.Permissions.withPermissions(config, [
    'android.permission.BLUETOOTH',
    'android.permission.BLUETOOTH_ADMIN',
    'android.permission.BLUETOOTH_CONNECT' // since Android SDK 31
  ])
  config = withBLEAndroidManifest(config, {
    isBackgroundEnabled: validatedProps.isBackgroundEnabled ?? false,
    neverForLocation: validatedProps.neverForLocation ?? false
  })

  return config
}

export { BackgroundMode }

export default createRunOncePlugin(withBLE, pkg.name, pkg.version)
