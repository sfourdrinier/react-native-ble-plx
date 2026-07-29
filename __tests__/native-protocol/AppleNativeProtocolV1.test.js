// __tests__/native-protocol/AppleNativeProtocolV1.test.js

const childProcess = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const root = path.resolve(__dirname, '../..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

const executesOnAppleHost = process.platform === 'darwin' ? test : test.skip

describe('Apple Native Protocol v1 radio boundary', () => {
  test('owns direct CoreBluetooth bytes, duplicate-aware paths, and direct restoration', () => {
    const radio = read('ios/Owned/OwnedCoreBluetoothProtocolRadio.swift')
    const control = read('ios/UnifiedBleProtocolControl.mm')
    const execution = read('ios/NativeProtocol/UnifiedBleProtocolAppleExecution.mm')
    const support = read('ios/Owned/OwnedCoreBluetoothProtocolRadioSupport.swift')

    expect(radio).toContain('OwnedCoreBluetoothProtocolRadio')
    expect(radio).toContain('private static let radioQueue')
    expect(radio).toContain('willRestoreState')
    expect(radio).toContain('restoredPeerIdentifiers')
    expect(radio).toContain('serviceOccurrence')
    expect(radio).toContain('characteristicOccurrence')
    expect(radio).toContain('cancelPendingOperation')
    expect(radio).toContain('maximumBinaryPayloadBytes')
    expect(radio).not.toMatch(/base64/i)
    expect(support).not.toMatch(/BlePlx|Restoration|perform\(/)
    expect(control).toContain('RCTTurboModuleWithJSIBindings')
    expect(control).toContain('installJSIBindingsWithRuntime')
    expect(control).toContain('UnifiedBleProtocolRestoreIdentifier')
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

  test('preserves one structured native failure and waits for CoreBluetooth disconnect completion', () => {
    const execution = read('ios/NativeProtocol/UnifiedBleProtocolAppleExecution.mm')
    const radio = read('ios/Owned/OwnedCoreBluetoothProtocolRadio.swift')
    const boundary = read('src/native-protocol/rn-apple-boundary.ts')
    const sharedBoundary = read('src/native-protocol/rn-android-boundary.ts')
    const failureResult = execution.slice(execution.indexOf('protocol::ProtocolRecord failureResult'))

    expect([...failureResult.matchAll(/field\(1U, code\)/g)]).toHaveLength(1)
    expect(radio).toContain('private var pendingDisconnect = [String: PendingVoid]()')
    expect(radio).toContain('pendingDisconnect[peerIdentifier] = PendingVoid(')
    expect(radio).toContain('pendingDisconnect.removeValue(forKey: identifier)')
    expect(radio).toContain('pendingDisconnect.removeAll()')
    expect(boundary).toContain('assertAdapterReady')
    expect(boundary).toContain('permission.denied')
    expect(boundary).toContain('permission.restricted')
    expect(boundary).toContain('permission.not-determined')
    expect(sharedBoundary).toContain('nativeOperationFailure')
    expect(sharedBoundary).toContain('domain: nativeDomain')
    expect(sharedBoundary).toContain('code: nativeCode')
  })

  test('keeps the queue-confined radio under the file cap by moving stateless projections to support', () => {
    const radio = read('ios/Owned/OwnedCoreBluetoothProtocolRadio.swift')
    const support = read('ios/Owned/OwnedCoreBluetoothProtocolRadioSupport.swift')

    expect(radio.split('\n').length).toBeLessThanOrEqual(900)
    expect(radio).toContain('OwnedCoreBluetoothProtocolRadioSupport.advertisementDictionary')
    expect(radio).toContain('OwnedCoreBluetoothProtocolRadioSupport.adapterSnapshotDictionary')
    expect(support).toContain('enum OwnedCoreBluetoothProtocolRadioSupport')
    expect(support).toContain('static func normalizedUUID')
    expect(support).toContain('This owns no radio state')
  })

  test('carries every CoreBluetooth-provided rich advertisement field through owned protocol binary references', () => {
    const support = read('ios/Owned/OwnedCoreBluetoothProtocolRadioSupport.swift')
    const execution = read('ios/NativeProtocol/UnifiedBleProtocolAppleExecution.mm')
    const sharedBoundary = read('src/native-protocol/rn-android-boundary.ts')
    const appleBoundary = read('src/native-protocol/rn-apple-boundary.ts')
    const advertisement = execution.slice(
      execution.indexOf('void AppleNativeProtocolExecution::receiveAdvertisement'),
      execution.indexOf('void AppleNativeProtocolExecution::receiveDisconnect')
    )

    expect(support).toContain('CBAdvertisementDataTxPowerLevelKey')
    expect(support).toContain('CBAdvertisementDataIsConnectable')
    expect(support).toContain('CBAdvertisementDataSolicitedServiceUUIDsKey')
    expect(support).toContain('CBAdvertisementDataOverflowServiceUUIDsKey')
    expect(support).toContain('CBAdvertisementDataServiceDataKey')
    expect(support).toContain('CBAdvertisementDataManufacturerDataKey')
    expect(advertisement).toContain('appendNumber(@"txPower", 7U)')
    expect(advertisement).toContain('field(8U, [value[@"connectable"] boolValue])')
    expect(advertisement).toContain('appendStrings(@"solicitedServiceUUIDs", 11U)')
    expect(advertisement).toContain('appendStrings(@"overflowServiceUUIDs", 12U)')
    expect(advertisement).toContain('field(13U, std::move(serviceData))')
    expect(advertisement).toContain('field(14U, protocol::ProtocolRecordList{reference(entry)})')
    expect(advertisement).toContain('retainNativeBytes(')
    expect(advertisement).toContain('releaseBinary(binary)')
    expect(advertisement).toContain('static_cast<std::uint64_t>(source[1]) << 8U')
    expect(sharedBoundary).toContain('advertisementBinaryReferences(advertisement)')
    expect(sharedBoundary).toContain('advertisementFromRecord(parsedAdvertisement, advertisementBytes)')
    expect(appleBoundary).toContain('extends ReactNativeAndroidProtocolBoundary')
  })

  test('does not manufacture advertisement fields CoreBluetooth does not expose', () => {
    const execution = read('ios/NativeProtocol/UnifiedBleProtocolAppleExecution.mm')
    const advertisement = execution.slice(
      execution.indexOf('void AppleNativeProtocolExecution::receiveAdvertisement'),
      execution.indexOf('void AppleNativeProtocolExecution::receiveDisconnect')
    )

    expect(advertisement).not.toContain('field(9U')
    expect(advertisement).not.toContain('field(15U')
    expect(advertisement).not.toContain('field(16U')
    expect(advertisement).not.toContain('rawRecord')
    expect(advertisement).not.toContain('scanResponseRecord')
  })

  executesOnAppleHost('executes canonical 128-bit UUID parsing through the native startScan path', () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ble-plx-apple-scan-parser-'))
    const executable = path.join(temporaryDirectory, 'AppleCoreBluetoothScanParserHarness')
    try {
      const compilation = childProcess.spawnSync(
        'xcrun',
        [
          'swiftc',
          path.join(root, 'ios/Owned/OwnedCoreBluetoothProtocolRadioSupport.swift'),
          path.join(root, 'ios/Owned/OwnedCoreBluetoothProtocolRadio.swift'),
          path.join(root, 'native/protocol/tests/AppleCoreBluetoothScanParserHarness.swift'),
          '-o',
          executable
        ],
        { encoding: 'utf8', timeout: 30_000 }
      )
      expect(compilation.error).toBeUndefined()
      if (compilation.status !== 0) {
        throw new Error(`Apple CoreBluetooth parser harness compilation failed:\n${compilation.stderr}`)
      }
      const execution = childProcess.spawnSync(executable, [], { encoding: 'utf8', timeout: 15_000 })
      expect(execution.error).toBeUndefined()
      if (execution.status !== 0) {
        throw new Error(`Apple CoreBluetooth parser harness failed:\n${execution.stderr}`)
      }
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true })
    }
  })
})
