// __tests__/native-protocol/AppleNativeProtocolV1.test.js

const childProcess = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '../..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('Apple Native Protocol v1 radio boundary', () => {
  test('owns direct CoreBluetooth bytes, duplicate-aware paths, and direct restoration', () => {
    const radio = read('ios/Owned/OwnedCoreBluetoothProtocolRadio.swift')
    const control = read('ios/UnifiedBleProtocolControl.mm')
    const execution = [
      read('ios/NativeProtocol/UnifiedBleProtocolAppleExecution.mm'),
      read('ios/NativeProtocol/UnifiedBleProtocolAppleAdvertisement.mm')
    ].join('\n')
    const descriptors = read('ios/Owned/OwnedCoreBluetoothProtocolRadioDescriptors.swift')
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

  test('fails the pre-JavaScript stream closed with generation-safe sink ownership and observable counters', () => {
    const control = read('ios/UnifiedBleProtocolControl.mm')
    const execution = read('ios/NativeProtocol/UnifiedBleProtocolAppleExecution.mm')
    const state = read('ios/NativeProtocol/UnifiedBleProtocolAppleExecutionState.hpp')
    const buffer = read('native/protocol/include/BoundedNativeEventBuffer.hpp')

    expect(control).toContain('_execution->beginAttachment();')
    expect(state).toContain('std::shared_ptr<facebook::jsi::Function> eventSink;')
    expect(state).toContain('std::recursive_mutex mutex;')
    expect(state).toContain('std::uint64_t attachmentGeneration')
    expect(state).toContain('bool attachmentActive = false;')
    expect(state).toContain('bool ingressClosed = false;')
    expect(execution).toContain('state->attachmentGeneration != attachmentGeneration')
    expect(execution).toContain('if (!admitted) state->ingressClosed = true;')
    expect(execution).toContain('eventSinksAwaitingJavaScriptRelease')
    expect(execution).toContain('retainedRecordCount=')
    expect(execution).toContain('droppedByteCount=')
    expect(execution).toContain('overflowCount=')
    expect(buffer).toContain('struct OverflowSnapshot final')
    expect(buffer).toContain('saturatingAdd')
    expect(buffer).not.toContain('overflowed_ = false')
  })

  test('requires the complete persisted five-field restoration identity before native append or adoption', () => {
    const control = read('ios/UnifiedBleProtocolControl.mm')
    const configuration = read('native/protocol/include/NativeRestorationConfiguration.hpp')

    expect(configuration).toContain('hasCompleteNativeRestorationConfiguration')
    for (const field of [
      'restoreIdentifier',
      'namespaceValue',
      'epoch',
      'clientId',
      'hostSessionScope'
    ]) {
      expect(configuration).toContain(`!${field}.empty()`)
    }
    expect(control).toContain('NSString *_restorationRestoreIdentifier;')
    expect(control).toContain('_restorationRestoreIdentifier = configuredInfoString(@"UnifiedBleProtocolRestoreIdentifier");')
    expect(control).toContain('initWithRestoreIdentifierKey:(')
    expect(control).toContain('? _restorationRestoreIdentifier')
    expect(control).toContain(': nil)];')
    expect(control).toContain('if (hasCompleteRestorationConfiguration(')
    expect(control).toContain('!hasCompleteRestorationConfiguration(')
  })

  test('rolls back a failed restoration bootstrap before rejecting the handshake', () => {
    const control = read('ios/UnifiedBleProtocolControl.mm')
    const runtimeHeader = read('native/protocol/include/NativeProtocolControlRuntime.hpp')
    const executionHeader = read('ios/NativeProtocol/UnifiedBleProtocolAppleExecution.hpp')
    const execution = read('ios/NativeProtocol/UnifiedBleProtocolAppleExecution.mm')

    expect(control).toContain('_execution->rollbackRestorationBootstrap();')
    expect(control).toContain('_runtime->rollbackRestorationBootstrap(attachment);')
    expect(runtimeHeader).toContain(
      'void rollbackRestorationBootstrap(const NativeAttachmentIdentity& attachment) noexcept;'
    )
    expect(executionHeader).toContain('void rollbackRestorationBootstrap() noexcept;')
    expect(execution).toContain('void AppleNativeProtocolExecution::rollbackRestorationBootstrap()')
    expect(control).not.toContain('catch (const std::exception& rollbackError)')
    const executionRollback = control.indexOf('_execution->rollbackRestorationBootstrap();')
    const runtimeRollback = control.indexOf('_runtime->rollbackRestorationBootstrap(attachment);')
    const rejection = control.indexOf(
      'rejectControl(reject, @"nativeProtocolHandshake", [NSString stringWithUTF8String:error.what()]);',
      runtimeRollback
    )
    expect(executionRollback).toBeGreaterThan(control.indexOf('_execution->appendRestorationRecords({'))
    expect(runtimeRollback).toBeGreaterThan(executionRollback)
    expect(rejection).toBeGreaterThan(runtimeRollback)

    const executionRollbackBody = execution.slice(
      execution.indexOf('void AppleNativeProtocolExecution::rollbackRestorationBootstrap()'),
      execution.indexOf('void AppleNativeProtocolExecution::detachAttachment()')
    )
    expect(executionRollbackBody).toContain('state_->restorationAppended = false;')

    const handshakeBody = control.slice(
      control.indexOf('- (void)handshake:'),
      control.indexOf('- (void)installExecutionRuntime:')
    )
    expect(handshakeBody).not.toContain('consumeRestorationPeerIdentifiers')
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
    const advertisement = read('ios/NativeProtocol/UnifiedBleProtocolAppleAdvertisement.mm')
    const sharedBoundary = read('src/native-protocol/rn-android-boundary.ts')
    const appleBoundary = read('src/native-protocol/rn-apple-boundary.ts')

    expect(support).toContain('CBAdvertisementDataTxPowerLevelKey')
    expect(support).toContain('CBAdvertisementDataIsConnectable')
    expect(support).toContain('CBAdvertisementDataSolicitedServiceUUIDsKey')
    expect(support).toContain('CBAdvertisementDataOverflowServiceUUIDsKey')
    expect(support).toContain('CBAdvertisementDataServiceDataKey')
    expect(support).toContain('CBAdvertisementDataManufacturerDataKey')
    expect(advertisement).toContain('appendNumber(@"txPower", 7U)')
    expect(advertisement).toContain('nativeProtocolField(8U, [value[@"connectable"] boolValue])')
    expect(advertisement).toContain('appendStrings(@"solicitedServiceUUIDs", 11U)')
    expect(advertisement).toContain('appendStrings(@"overflowServiceUUIDs", 12U)')
    expect(advertisement).toContain('nativeProtocolField(13U, std::move(serviceData))')
    expect(advertisement).toContain('nativeProtocolField(14U, protocol::ProtocolRecordList{nativeProtocolReference(entry)})')
    expect(advertisement).toContain('retainNativeBytes(')
    expect(advertisement).toContain('releaseBinary(binary)')
    expect(advertisement).toContain('static_cast<std::uint64_t>(source[1]) << 8U')
    expect(sharedBoundary).toContain('advertisementBinaryReferences(advertisement)')
    expect(sharedBoundary).toContain('advertisementFromRecord(parsedAdvertisement, advertisementBytes)')
    expect(appleBoundary).toContain('extends ReactNativeAndroidProtocolBoundary')
  })

  test('does not manufacture advertisement fields CoreBluetooth does not expose', () => {
    const advertisement = read('ios/NativeProtocol/UnifiedBleProtocolAppleAdvertisement.mm')

    expect(advertisement).not.toContain('field(9U')
    expect(advertisement).not.toContain('field(15U')
    expect(advertisement).not.toContain('field(16U')
    expect(advertisement).not.toContain('rawRecord')
    expect(advertisement).not.toContain('scanResponseRecord')
  })

  test('publishes duplicate-safe descriptor discovery and descriptor read/write over the canonical binary boundary', () => {
    const radio = read('ios/Owned/OwnedCoreBluetoothProtocolRadio.swift')
    const execution = read('ios/NativeProtocol/UnifiedBleProtocolAppleExecution.mm')
    const descriptors = read('ios/Owned/OwnedCoreBluetoothProtocolRadioDescriptors.swift')
    const boundary = read('src/native-protocol/rn-apple-boundary.ts')
    const provider = read('src/backends/reactnative/react-native-apple-provider.ts')

    expect(descriptors).toContain('struct OwnedCoreBluetoothDescriptorAddress: Hashable')
    expect(descriptors).toContain('pendingReads')
    expect(descriptors).toContain('pendingWrites')
    expect(descriptors).toContain('readDescriptor(')
    expect(descriptors).toContain('writeDescriptor(')
    expect(descriptors).toContain('didUpdateValueFor descriptor')
    expect(descriptors).toContain('didWriteValueFor descriptor')
    expect(radio).toContain('"descriptors": descriptors')
    expect(execution).toContain('if (kind == "readDescriptor")')
    expect(execution).toContain('kind == "readDescriptor" || kind == "writeDescriptor"')
    expect(execution).toContain('descriptorEndpointFor')
    expect(execution).toContain('field(15U, reference(descriptorPath))')
    expect(execution).toContain('return "descriptorRead"')
    expect(execution).toContain('return "descriptorWrite"')
    expect(boundary).not.toContain('descriptorOperationsAvailable = false')
    expect(provider).not.toContain('Descriptor operations are unavailable')
  })

  test('executes the Apple harness on macOS or verifies its required macOS CI route elsewhere', () => {
    if (process.platform === 'darwin') {
      const execution = childProcess.spawnSync('pnpm', ['test:native-protocol:apple'], {
        cwd: root,
        encoding: 'utf8',
        timeout: 90_000
      })

      expect(execution.error).toBeUndefined()
      if (execution.status !== 0) {
        throw new Error(`Apple Native Protocol executable harness failed on macOS:\n${execution.stderr}`)
      }
      return
    }

    const ciWorkflow = read('.github/workflows/ci.yml')
    const appleWorkflow = read('.github/workflows/apple-ci.yml')

    if (!ciWorkflow.includes('uses: ./.github/workflows/apple-ci.yml')) {
      throw new Error('Non-macOS routing check failed: ci.yml does not invoke the reusable Apple CI workflow.')
    }
    if (!appleWorkflow.includes('runs-on: macos-26')) {
      throw new Error('Non-macOS routing check failed: the Apple native protocol job is not pinned to a macOS runner.')
    }
    if (!appleWorkflow.includes('run: pnpm test:native-protocol:apple')) {
      throw new Error('Non-macOS routing check failed: the macOS Apple CI workflow does not require pnpm test:native-protocol:apple.')
    }
  })
})
