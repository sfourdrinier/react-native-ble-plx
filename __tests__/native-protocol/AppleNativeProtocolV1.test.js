// __tests__/native-protocol/AppleNativeProtocolV1.test.js

const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '../..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('Apple Native Protocol v1 radio boundary', () => {
  test('owns direct CoreBluetooth bytes, duplicate-aware paths, and restoration central adoption', () => {
    const radio = read('ios/Owned/OwnedCoreBluetoothProtocolRadio.swift')
    const adapter = read('ios/Owned/OwnedCoreBluetoothAdapter.swift')
    const control = read('ios/UnifiedBleProtocolControl.mm')
    const execution = read('ios/NativeProtocol/UnifiedBleProtocolAppleExecution.mm')

    expect(radio).toContain('OwnedCoreBluetoothProtocolRadio')
    expect(radio).toContain('takeRestorationTransfer')
    expect(radio).toContain('takeUnifiedProtocolCentralTransfer')
    expect(radio).toContain('serviceOccurrence')
    expect(radio).toContain('characteristicOccurrence')
    expect(radio).toContain('cancelPendingOperation')
    expect(radio).toContain('maximumBinaryPayloadBytes')
    expect(radio).not.toMatch(/base64/i)
    expect(adapter).toContain('takeUnifiedProtocolCentralTransfer')
    expect(control).toContain('RCTTurboModuleWithJSIBindings')
    expect(control).toContain('installJSIBindingsWithRuntime')
    expect(control).toContain('appendRestorationRecords')
    expect(control).not.toContain('Android-only slice')
    expect(execution).toContain('__unifiedBleNativeProtocolV1')
    expect(execution).toContain('retainUint8Array')
    expect(execution).toContain('consumeCommandBinary')
    expect(execution).toContain('receiveAdvertisement')
    expect(execution).toContain('receiveNotification')
    expect(execution).toContain('recordsAwaitingSink')
    expect(execution).toContain('runtime->settleResult(result)')
  })

  test('retains no read output after a late terminal result and routes the first pre-ack notification', () => {
    const runtime = read('native/protocol/src/NativeProtocolControlRuntime.cpp')
    const execution = read('ios/NativeProtocol/UnifiedBleProtocolAppleExecution.mm')
    const binaryDelivery = read('ios/NativeProtocol/UnifiedBleProtocolAppleBinaryDelivery.mm')
    const podspec = read('unified-ble-manager.podspec')
    const radio = read('ios/Owned/OwnedCoreBluetoothProtocolRadio.swift')

    expect(runtime).toContain('pendingSubscriptionCommandFor')
    expect(execution).toContain('releaseRetainedBinary')
    expect(execution).toContain('read binary release after non-delivery')
    expect(execution).toContain('read binary release after delivery failure')
    expect(execution).toContain('pendingSubscriptionCommandFor(subscriptionValue)')
    expect(binaryDelivery).toContain('runtime->releaseBinary(reference)')
    expect(podspec).toContain('ios/NativeProtocol/**/*.{h,m,mm}')
    expect(radio).toContain('pendingNotify[address].flatMap')
    expect(radio).toContain('subscriptions[address] ?? pendingSubscriptionIdentifier')
  })
})
