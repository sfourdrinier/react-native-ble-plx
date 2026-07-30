import { applyNativeProtocolRestorationInfoPlist, validateBlePluginOptions } from '../withBLE'

const completeRestoration = {
  identifier: 'com.example.app.ble',
  namespace: 'com.example.app.ble',
  epoch: '2026-07-30',
  clientId: 'com.example.app.ble.client',
  hostSessionScope: 'com.example.app.ble.host'
}

describe('validateBlePluginOptions', () => {
  it('accepts only the complete, current plugin option shape', () => {
    expect(
      validateBlePluginOptions({
        debug: true,
        isBackgroundEnabled: false,
        neverForLocation: true,
        modes: ['central', 'peripheral'],
        bluetoothAlwaysPermission: false,
        iosNativeProtocolRestoration: completeRestoration
      })
    ).toEqual({
      debug: true,
      isBackgroundEnabled: false,
      neverForLocation: true,
      modes: ['central', 'peripheral'],
      bluetoothAlwaysPermission: false,
      iosNativeProtocolRestoration: completeRestoration
    })
  })

  it.each([
    ['a non-object options value', null],
    ['an unknown option', { unexpected: true }],
    ['a string debug option', { debug: 'true' }],
    ['a string background option', { isBackgroundEnabled: 'true' }],
    ['a numeric never-for-location option', { neverForLocation: 1 }],
    ['a scalar background mode', { modes: 'central' }],
    ['an unsupported background mode', { modes: ['observer'] }],
    ['a duplicate background mode', { modes: ['central', 'central'] }],
    ['an empty Bluetooth permission string', { bluetoothAlwaysPermission: '  ' }],
    ['a truthy Bluetooth permission boolean', { bluetoothAlwaysPermission: true }],
    ['a retired restoration option', { iosNativeProtocolRestorationIdentifier: 'com.example.app.ble' }],
    ['a partial restoration object', { iosNativeProtocolRestoration: { identifier: 'com.example.app.ble' } }],
    [
      'a restoration object with an unknown property',
      { iosNativeProtocolRestoration: { ...completeRestoration, unexpected: 'value' } }
    ],
    [
      'a restoration object with an empty required value',
      { iosNativeProtocolRestoration: { ...completeRestoration, clientId: '' } }
    ]
  ])('rejects %s', (_label, options) => {
    expect(() => validateBlePluginOptions(options)).toThrow()
  })
})

describe('applyNativeProtocolRestorationInfoPlist', () => {
  it('replaces every restoration value together', () => {
    const infoPlist: Record<string, unknown> = {
      UnifiedBleProtocolRestoreIdentifier: 'stale-identifier',
      UnifiedBleProtocolRestorationNamespace: 'stale-namespace',
      UnifiedBleProtocolRestorationEpoch: 'stale-epoch',
      UnifiedBleProtocolRestorationClientId: 'stale-client',
      UnifiedBleProtocolRestorationHostSessionScope: 'stale-scope'
    }

    applyNativeProtocolRestorationInfoPlist(infoPlist, completeRestoration)

    expect(infoPlist).toMatchObject({
      UnifiedBleProtocolRestoreIdentifier: completeRestoration.identifier,
      UnifiedBleProtocolRestorationNamespace: completeRestoration.namespace,
      UnifiedBleProtocolRestorationEpoch: completeRestoration.epoch,
      UnifiedBleProtocolRestorationClientId: completeRestoration.clientId,
      UnifiedBleProtocolRestorationHostSessionScope: completeRestoration.hostSessionScope
    })
  })

  it('removes the entire native restoration configuration when it is not configured', () => {
    const infoPlist: Record<string, unknown> = {
      UnifiedBleProtocolRestoreIdentifier: 'stale-identifier',
      UnifiedBleProtocolRestorationNamespace: 'stale-namespace',
      UnifiedBleProtocolRestorationEpoch: 'stale-epoch',
      UnifiedBleProtocolRestorationClientId: 'stale-client',
      UnifiedBleProtocolRestorationHostSessionScope: 'stale-scope'
    }

    applyNativeProtocolRestorationInfoPlist(infoPlist)

    expect(infoPlist).toEqual({})
  })
})
