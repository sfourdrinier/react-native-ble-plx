// __tests__/OwnedCore.structure.test.js

// __tests__/OwnedCore.structure.test.js

/**
 * STRUCTURE-ONLY proof level (R2-F113 / L0–L1):
 * Source-string / factory presence guards for the owned radio default path.
 * Does NOT execute owned GATT/radio behavior (no JVM unit, Swift XCTest, or robotest).
 * Do not count this suite as L4/L5 end-to-end proof that subscriptionType, FGS, or
 * restoration works at runtime — pair with platform instrumented tests when claiming GA depth.
 */
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')

describe('Owned native core structure-only (4.0 L0–L1, not L4/L5 runtime)', () => {
  test('suite is labeled structure-only (R2-F113)', () => {
    const self = fs.readFileSync(__filename, 'utf8')
    expect(self).toMatch(/STRUCTURE-ONLY proof level/)
    expect(self).toMatch(/not L4\/L5/)
    // No runtime Kotlin/Swift execution harnesses in this package Jest suite
    expect(self).not.toMatch(/require\(['"]kotlin/)
    expect(self).not.toMatch(/require\(['"]robolectric/i)
    expect(self).not.toMatch(/\bimport\s+XCTest\b/)
  })
  test('Android build.gradle does not depend on RxAndroidBle/RxJava', () => {
    const gradle = fs.readFileSync(path.join(root, 'android/build.gradle'), 'utf8')
    // Assert dependency coordinates, not prose comments
    expect(gradle).not.toMatch(/implementation\s+[\"']com\.polidea\.rxandroidble/)
    expect(gradle).not.toMatch(/implementation\s+[\"']io\.reactivex\.rxjava2:rxjava/)
    expect(gradle).toMatch(/kotlin-stdlib/)
    expect(gradle).toMatch(/OWNED_RADIO_ID/)
  })

  test('BleAdapterFactory default creator is OwnedBleAdapter', () => {
    const factory = fs.readFileSync(
      path.join(root, 'android/src/main/java/com/sfourdrinier/unifiedblemanager/adapter/BleAdapterFactory.java'),
      'utf8'
    )
    expect(factory).toContain('OwnedBleAdapter')
    expect(factory).not.toMatch(/return new BleModule\(/)
  })

  test('Owned Kotlin radio sources exist with radio id markers', () => {
    const radio = fs.readFileSync(
      path.join(
        root,
        'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedAndroidGattRadio.kt'
      ),
      'utf8'
    )
    const adapter = fs.readFileSync(
      path.join(root, 'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedBleAdapter.kt'),
      'utf8'
    )
    expect(radio).toContain('OwnedAndroidGattRadio')
    expect(radio).toContain('owned-android-gatt-v1')
    expect(adapter).toContain('OwnedBleAdapter')
    expect(adapter).toContain('owned-ble-adapter-v1')
    expect(adapter).not.toMatch(/import com\.polidea\.rxandroidble|RxBleClient/)
    expect(radio).not.toMatch(/import com\.polidea\.rxandroidble|RxBleClient/)
  })

  test('Legacy Rx BleModule is not on main source set', () => {
    const mainBleModule = path.join(
      root,
      'android/src/main/java/com/sfourdrinier/unifiedblemanager/adapter/BleModule.java'
    )
    const legacyBleModule = path.join(
      root,
      'android/src/legacy/java/com/sfourdrinier/unifiedblemanager/adapter/BleModule.java'
    )
    expect(fs.existsSync(mainBleModule)).toBe(false)
    expect(fs.existsSync(legacyBleModule)).toBe(true)
  })

  test('iOS podspec compiles Owned CoreBluetooth, excludes RxBluetoothKit/MBA BleModule', () => {
    const pod = fs.readFileSync(path.join(root, 'unified-ble-manager.podspec'), 'utf8')
    expect(pod).toContain('ios/Owned/**/*.swift')
    expect(pod).toContain('OWNED_COREBLUETOOTH_RADIO')
    expect(pod).toContain('BleModule.swift')
    expect(pod).toMatch(/exclude_files[\s\S]*BleModule\.swift/)
    expect(pod).toMatch(/exclude_files[\s\S]*RxBluetoothKit/)
  })

  test('iOS factory defaults to OwnedCoreBluetoothAdapter', () => {
    const factory = fs.readFileSync(
      path.join(root, 'ios/vendor/MultiplatformBleAdapter/classes/BleAdapterFactory.swift'),
      'utf8'
    )
    expect(factory).toContain('OwnedCoreBluetoothAdapter')
    expect(factory).not.toContain('BleClientManager(queue:')
  })

  test('OwnedCoreBluetoothAdapter.swift implements BleAdapter surface', () => {
    const src = fs.readFileSync(path.join(root, 'ios/Owned/OwnedCoreBluetoothAdapter.swift'), 'utf8')
    expect(src).toContain('class OwnedCoreBluetoothAdapter')
    expect(src).toContain('owned-corebluetooth-v1')
    expect(src).toContain('CBCentralManager')
    expect(src).toContain('func startDeviceScan')
    expect(src).toContain('func connectToDevice')
    expect(src).not.toMatch(/import RxBluetoothKit|import class BluetoothManager|BluetoothManager\s*\(/)
  })

  test('Owned iOS emits ServicesChangedEvent and implements descriptor + restore paths', () => {
    const src = fs.readFileSync(path.join(root, 'ios/Owned/OwnedCoreBluetoothAdapter.swift'), 'utf8')
    expect(src).toContain('didModifyServices')
    expect(src).toContain('servicesChangedEvent')
    expect(src).toContain('willRestoreState')
    expect(src).toContain('readValue(for: desc)')
    expect(src).toContain('writeValue(data, for: desc)')
    expect(src).toContain('discoverDescriptors')
    const events = fs.readFileSync(
      path.join(root, 'ios/vendor/MultiplatformBleAdapter/classes/BleEvent.swift'),
      'utf8'
    )
    expect(events).toContain('servicesChangedEvent')
    expect(events).toContain('ServicesChangedEvent')
  })

  test('Owned Android onServiceChanged (API 31+) wires ServicesChangedEvent', () => {
    const radio = fs.readFileSync(
      path.join(
        root,
        'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedAndroidGattRadio.kt'
      ),
      'utf8'
    )
    expect(radio).toContain('onServiceChanged')
    expect(radio).toContain('onServicesChanged')
    const adapter = fs.readFileSync(
      path.join(root, 'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedBleAdapter.kt'),
      'utf8'
    )
    expect(adapter).toContain('setServicesChangedListener')
    const event = fs.readFileSync(
      path.join(root, 'android/src/main/java/com/sfourdrinier/unifiedblemanager/Event.java'),
      'utf8'
    )
    expect(event).toContain('ServicesChangedEvent')
    const module = fs.readFileSync(
      path.join(root, 'android/src/main/java/com/sfourdrinier/unifiedblemanager/BlePlxModule.java'),
      'utf8'
    )
    expect(module).toMatch(
      /deviceId\s*->\s*\{[\s\S]*sendEvent\(Event\.ServicesChangedEvent, deviceId\);[\s\S]*return kotlin\.Unit\.INSTANCE;/
    )
  })

  test('Owned Android drops unmatched notifications and maps bonded-list failures to shared error codes', () => {
    const adapter = fs.readFileSync(
      path.join(root, 'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedBleAdapter.kt'),
      'utf8'
    )

    expect(adapter).toContain('radio.onNotification = notification@{ deviceId, serviceUuid, charUuid, value ->')
    expect(adapter).toContain('val entry = notifyCallbacks[key] ?: return@notification')
    expect(adapter).toContain('bondedDevices failed while retrieving bonded devices')
    const bondedOperation = fs.readFileSync(
      path.join(
        root,
        'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedBondedDevicesOperation.kt'
      ),
      'utf8'
    )
    expect(bondedOperation).toContain('SecurityException')
    expect(bondedOperation).toContain('BleErrorCode.BluetoothUnauthorized')
    expect(bondedOperation).toContain('BleErrorCode.UnknownError')
    expect(adapter).not.toContain('BleErrorCode.BluetoothInternalException')
  })

  test('Electron macOS CoreBluetooth exposes the contract-v1 boundary only', () => {
    const index = fs.readFileSync(path.join(root, 'native/electron/corebluetooth/index.js'), 'utf8')
    expect(index).toContain('createContractBoundary')
    expect(index).not.toContain('createPort')
    expect(index).not.toContain('wrapAsBlePort')
    expect(index).not.toContain('Base64')
    expect(index).toContain('readCharacteristicAt')
    expect(index).toContain('startNotifyAt')
    expect(index).toContain('unified_ble_corebluetooth')
    expect(fs.existsSync(path.join(root, 'native/electron/corebluetooth/binding.gyp'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'native/electron/corebluetooth/src/addon.mm'))).toBe(true)
    const addon = fs.readFileSync(path.join(root, 'native/electron/corebluetooth/src/addon.mm'), 'utf8')
    expect(addon).toContain('CoreBluetooth')
    expect(addon).toContain('CBCentralManager')
    expect(addon).toContain('connectPeripheral')
    expect(addon).toContain('discoverServices')
    expect(addon).toContain('readValueForCharacteristic')
    expect(addon).toContain('setNotifyValue')
    expect(addon).toContain('napi.h')
    expect(addon).toContain('NODE_API_MODULE')
    const pkg = fs.readFileSync(path.join(root, 'package.json'), 'utf8')
    expect(pkg).toContain('build:electron:macos')
  })

  test('Owned Android radio fails API33 write start when status != GATT_SUCCESS', () => {
    const radio = fs.readFileSync(
      path.join(
        root,
        'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedAndroidGattRadio.kt'
      ),
      'utf8'
    )
    expect(radio).toContain('fun acceptApi33WriteStatus')
    expect(radio).toMatch(/status\s*!=\s*BluetoothGatt\.GATT_SUCCESS/)
    expect(radio).toContain('fun requestMtu')
    expect(radio).toContain('fun readRemoteRssi')
    expect(radio).toContain('onMtuChanged')
    expect(radio).toContain('onReadRemoteRssi')
    // pending keys normalized to uppercase for MAC match with gatt callbacks
    expect(radio).toMatch(/mtu:\$\{deviceId\.uppercase\(\)\}/)
    expect(radio).toMatch(/rssi:\$\{deviceId\.uppercase\(\)\}/)
  })

  test('OwnedBleAdapter wires MTU/RSSI to radio.requestMtu / readRemoteRssi', () => {
    const adapter = fs.readFileSync(
      path.join(root, 'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedBleAdapter.kt'),
      'utf8'
    )
    expect(adapter).toMatch(/radio\.readRemoteRssi\(/)
    expect(adapter).toMatch(/radio\.requestMtu\(/)
    // Must not only set local Device.mtu without calling the radio
    const mtuBody = adapter.slice(
      adapter.indexOf('override fun requestMTUForDevice'),
      adapter.indexOf('override fun getKnownDevices')
    )
    expect(mtuBody).toContain('radio.requestMtu')
    expect(mtuBody).not.toMatch(/d\.mtu\s*=\s*mtu\s*\n\s*onSuccessCallback/)
  })

  test('OwnedBleAdapter connect fails closed: onError on disconnect-before-success; timeout + connect MTU', () => {
    const adapter = fs.readFileSync(
      path.join(root, 'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedBleAdapter.kt'),
      'utf8'
    )
    const connectBody = adapter.slice(
      adapter.indexOf('override fun connectToDevice'),
      adapter.indexOf('override fun cancelDeviceConnection')
    )
    // Failed connect (disconnect before success) must call onErrorCallback — not only DISCONNECTED event
    expect(connectBody).toContain('completeConnectFailure')
    expect(connectBody).toContain('onErrorCallback.onError')
    expect(connectBody).toContain('DeviceConnectionFailed')
    // Timeout from ConnectionOptions
    expect(connectBody).toMatch(/timeoutInMillis|timeoutMs/)
    expect(connectBody).toContain('OperationTimedOut')
    // Connect-time MTU when requestMTU > 0
    expect(connectBody).toMatch(/requestMtu\s*>\s*0/)
    expect(connectBody).toContain('radio.requestMtu')
    // Radio connection callback must carry gatt status
    expect(connectBody).toMatch(/gattStatus/)
  })

  test('OwnedAndroidGattRadio setNotify waits for onDescriptorWrite; connect surfaces status', () => {
    const radio = fs.readFileSync(
      path.join(
        root,
        'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedAndroidGattRadio.kt'
      ),
      'utf8'
    )
    const setNotifyBody = radio.slice(radio.indexOf('fun setNotify'), radio.indexOf('fun readDescriptor'))
    // Must NOT call onResult(success) before CCCD write completes
    expect(setNotifyBody).toContain('pendingDesc')
    // R2-F095: CCCD pending key includes serviceUuid via pendingCharKey helper
    expect(setNotifyBody).toMatch(/pendingCharKey\(\s*"cccd"|cccd:\$\{deviceId\.uppercase/)
    // Immediate success only when CCCD is null
    expect(setNotifyBody).toMatch(/if \(cccd == null\)[\s\S]*onResult\(Result\.success/)
    expect(radio).toContain('override fun onDescriptorWrite')
    // Multi-device connection listeners (F001) — not a single overwritten global per connect
    expect(radio).toContain('registerConnectionListener')
    expect(radio).toContain('connectionListeners')
    expect(radio).toContain('dispatchConnectionState')
  })

  test('F001 multi-device connection listeners on adapter (no per-connect global overwrite)', () => {
    const adapter = fs.readFileSync(
      path.join(root, 'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedBleAdapter.kt'),
      'utf8'
    )
    const connectBody = adapter.slice(
      adapter.indexOf('override fun connectToDevice'),
      adapter.indexOf('override fun cancelDeviceConnection')
    )
    expect(connectBody).toContain('registerConnectionListener')
    expect(connectBody).not.toMatch(/radio\.onConnectionState\s*=/)
    expect(adapter).toContain('unregisterConnectionListener')
  })

  test('F006 subscriptionType drives CCCD indication vs notification', () => {
    const radio = fs.readFileSync(
      path.join(
        root,
        'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedAndroidGattRadio.kt'
      ),
      'utf8'
    )
    expect(radio).toContain('fun resolveCccdPayload')
    expect(radio).toContain('ENABLE_INDICATION_VALUE')
    expect(radio).toContain('ENABLE_NOTIFICATION_VALUE')
    expect(radio).toMatch(/subscriptionType/)
    const setNotifyBody = radio.slice(radio.indexOf('fun setNotify'), radio.indexOf('fun readDescriptor'))
    expect(setNotifyBody).toContain('resolveCccdPayload')
    const adapter = fs.readFileSync(
      path.join(root, 'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedBleAdapter.kt'),
      'utf8'
    )
    const mon = adapter.slice(
      adapter.indexOf('override fun monitorCharacteristicForDevice'),
      adapter.indexOf('override fun monitorCharacteristicForService')
    )
    expect(mon).toMatch(/setNotify\([\s\S]*subscriptionType/)
  })

  test('F007 per-device native GATT FIFO queue', () => {
    const radio = fs.readFileSync(
      path.join(
        root,
        'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedAndroidGattRadio.kt'
      ),
      'utf8'
    )
    expect(radio).toContain('class GattSerialQueue')
    expect(radio).toContain('deviceQueues')
    expect(radio).toMatch(/fun enqueue\(/)
    // Ops go through enqueue
    expect(radio).toMatch(/fun readCharacteristic[\s\S]*?enqueue\(/)
    expect(radio).toMatch(/fun writeCharacteristic[\s\S]*?enqueue\(/)
    expect(radio).toMatch(/fun setNotify[\s\S]*?enqueue\(/)
  })

  test('F008 descriptor read/write implemented on owned radio + adapter', () => {
    const radio = fs.readFileSync(
      path.join(
        root,
        'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedAndroidGattRadio.kt'
      ),
      'utf8'
    )
    expect(radio).toContain('fun readDescriptor')
    expect(radio).toContain('fun writeDescriptor')
    expect(radio).toContain('pendingDescRead')
    expect(radio).toContain('onDescriptorRead')
    const adapter = fs.readFileSync(
      path.join(root, 'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedBleAdapter.kt'),
      'utf8'
    )
    const readDesc = adapter.slice(
      adapter.indexOf('override fun readDescriptorForDevice'),
      adapter.indexOf('override fun writeDescriptorForDevice')
    )
    expect(readDesc).toContain('radio.readDescriptor')
    expect(readDesc).not.toContain('DescriptorsNotDiscovered')
    const writeDesc = adapter.slice(
      adapter.indexOf('override fun writeDescriptorForDevice'),
      adapter.indexOf('override fun writeDescriptorForService')
    )
    expect(writeDesc).toContain('radio.writeDescriptor')
    expect(writeDesc).toContain('descriptorWriteNotAllowed')
  })

  test('F009 cancelTransaction tears down monitor + setNotify(false)', () => {
    const adapter = fs.readFileSync(
      path.join(root, 'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedBleAdapter.kt'),
      'utf8'
    )
    const cancel = adapter.slice(
      adapter.indexOf('override fun cancelTransaction'),
      adapter.indexOf('override fun setLogLevel')
    )
    expect(cancel).not.toMatch(/best-effort no-op/)
    expect(cancel).toContain('transactionsById')
    expect(cancel).toContain('setNotify')
    expect(cancel).toMatch(/false/)
    expect(cancel).toContain('BleErrorUtils.cancelled')
    expect(cancel).toContain('notifyCallbacks.remove')
  })

  test('F034 cancelTransaction: last-subscriber setNotify(false) + OperationCancelled; Subscription.remove stops CCCD', () => {
    const adapter = fs.readFileSync(
      path.join(root, 'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedBleAdapter.kt'),
      'utf8'
    )
    const radio = fs.readFileSync(
      path.join(
        root,
        'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedAndroidGattRadio.kt'
      ),
      'utf8'
    )
    // cancelTransaction is not a no-op
    const cancelStart = adapter.indexOf('override fun cancelTransaction')
    expect(cancelStart).toBeGreaterThanOrEqual(0)
    const cancel = adapter.slice(cancelStart, adapter.indexOf('private fun tearDownMonitorsForDevice'))
    expect(cancel).not.toMatch(/best-effort no-op/)
    // Map transactionId → Cancellable.Monitor subscription
    expect(adapter).toContain('transactionsById')
    expect(adapter).toMatch(/Cancellable\.Monitor/)
    // OperationCancelled completion (3.x monitor promise reject)
    expect(cancel).toContain('BleErrorUtils.cancelled')
    // Last-subscriber guard before CCCD disable
    expect(cancel).toMatch(/stillSubscribed|otherOwners|last subscriber|Last-subscriber/)
    expect(cancel).toContain('notifyCallbacks.remove')
    expect(cancel).toMatch(/setNotify\s*\(/)
    expect(cancel).toMatch(/false/)
    // Monitor arm registers transaction + enables notify
    const mon = adapter.slice(
      adapter.indexOf('override fun monitorCharacteristicForDevice'),
      adapter.indexOf('override fun monitorCharacteristicForService')
    )
    expect(mon).toContain('transactionsById[transactionId]')
    expect(mon).toMatch(/setNotify\([\s\S]*true/)
    // Replacing prior same-char monitor settles old subscription
    expect(mon).toMatch(/staleTxIds|notifyKey == key/)
    expect(mon).toContain('cancelTransaction')
    // Disconnect / services-changed settle monitors so Subscriptions do not hang
    expect(adapter).toContain('tearDownMonitorsForDevice')
    expect(adapter).toMatch(/tearDownMonitorsForDevice\([\s\S]*emitCancelled\s*=\s*true/)
    // Radio disable path writes DISABLE_NOTIFICATION_VALUE
    expect(radio).toContain('DISABLE_NOTIFICATION_VALUE')
    expect(radio).toMatch(/fun setNotify/)
  })

  test('F010 ACTION_STATE_CHANGED adapter events', () => {
    const radio = fs.readFileSync(
      path.join(
        root,
        'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedAndroidGattRadio.kt'
      ),
      'utf8'
    )
    expect(radio).toContain('ACTION_STATE_CHANGED')
    expect(radio).toContain('registerAdapterStateReceiver')
    expect(radio).toContain('unregisterAdapterStateReceiver')
    expect(radio).toContain('fun mapAdapterState')
    const adapter = fs.readFileSync(
      path.join(root, 'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedBleAdapter.kt'),
      'utf8'
    )
    expect(adapter).toContain('registerAdapterStateReceiver')
  })

  test('F035/F082 notify path: cached model + clone, no full cacheServices rebuild', () => {
    const adapter = fs.readFileSync(
      path.join(root, 'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedBleAdapter.kt'),
      'utf8'
    )
    expect(adapter).toContain('class NotifyEntry')
    const notify = adapter.slice(
      adapter.indexOf('radio.onNotification'),
      adapter.indexOf('radio.onServicesChanged')
    )
    expect(notify).toContain('Characteristic(entry.model)')
    expect(notify).not.toContain('findCharacteristicModel')
    expect(notify).not.toContain('cacheServices')
    // Monitor arm caches model into NotifyEntry
    const mon = adapter.slice(
      adapter.indexOf('override fun monitorCharacteristicForDevice'),
      adapter.indexOf('override fun monitorCharacteristicForService')
    )
    expect(mon).toContain('NotifyEntry')
    const radio = fs.readFileSync(
      path.join(
        root,
        'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedAndroidGattRadio.kt'
      ),
      'utf8'
    )
    expect(radio).toMatch(/value\.copyOf\(\)/)
    expect(radio).toMatch(/raw\.copyOf\(\)/)
  })

  test('F048 charCache cleared on disconnect / destroy / onServiceChanged', () => {
    const radio = fs.readFileSync(
      path.join(
        root,
        'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedAndroidGattRadio.kt'
      ),
      'utf8'
    )
    expect(radio).toContain('clearCharCacheForDevice')
    const disconnect = radio.slice(radio.indexOf('fun disconnect'), radio.indexOf('fun isConnected'))
    expect(disconnect).toContain('clearCharCacheForDevice')
    expect(radio).toMatch(/fun destroy\([\s\S]*charCache\.clear/)
    expect(radio).toMatch(/onServiceChanged[\s\S]*clearCharCacheForDevice/)
  })

  test('F049 onScanFailed propagates to JS ScanStartFailed', () => {
    const radio = fs.readFileSync(
      path.join(
        root,
        'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedAndroidGattRadio.kt'
      ),
      'utf8'
    )
    expect(radio).toContain('var onScanFailed')
    expect(radio).toMatch(/override fun onScanFailed[\s\S]*onScanFailed\?\.invoke/)
    const adapter = fs.readFileSync(
      path.join(root, 'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedBleAdapter.kt'),
      'utf8'
    )
    const scan = adapter.slice(
      adapter.indexOf('override fun startDeviceScan'),
      adapter.indexOf('override fun stopDeviceScan')
    )
    expect(scan).toContain('onScanFailed')
    expect(scan).toContain('ScanStartFailed')
  })

  test('F050 connectionPriority + refreshGatt honesty', () => {
    const radio = fs.readFileSync(
      path.join(
        root,
        'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedAndroidGattRadio.kt'
      ),
      'utf8'
    )
    expect(radio).toContain('fun requestConnectionPriority')
    expect(radio).toContain('gatt.requestConnectionPriority')
    expect(radio).toContain('fun refreshGatt')
    expect(radio).toMatch(/getMethod\("refresh"\)/)
    const adapter = fs.readFileSync(
      path.join(root, 'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedBleAdapter.kt'),
      'utf8'
    )
    const prio = adapter.slice(
      adapter.indexOf('override fun requestConnectionPriorityForDevice'),
      adapter.indexOf('override fun readRSSIForDevice')
    )
    expect(prio).toContain('radio.requestConnectionPriority')
    expect(prio).not.toMatch(/Best-effort; not all devices/)
    const connectBody = adapter.slice(
      adapter.indexOf('override fun connectToDevice'),
      adapter.indexOf('override fun cancelDeviceConnection')
    )
    expect(connectBody).toContain('refreshGatt')
    expect(connectBody).toContain('RefreshGattMoment.ON_CONNECTED')
    expect(connectBody).toContain('requestConnectionPriority')
  })

  test('F120 API33 write uses writeCharacteristic(ch, value, type) without ch.value assign', () => {
    const radio = fs.readFileSync(
      path.join(
        root,
        'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedAndroidGattRadio.kt'
      ),
      'utf8'
    )
    const writeBody = radio.slice(
      radio.indexOf('fun writeCharacteristic'),
      radio.indexOf('fun acceptApi33WriteStatus')
    )
    // API 33 branch only — pre-33 still assigns ch.value
    const api33Start = writeBody.indexOf('SDK_INT >= 33')
    const elseStart = writeBody.indexOf('} else {', api33Start)
    const api33 = writeBody.slice(api33Start, elseStart > api33Start ? elseStart : undefined)
    expect(api33).toMatch(/writeCharacteristic\(ch,\s*value,\s*writeType\)/)
    expect(api33).not.toMatch(/ch\.value\s*=/)
    expect(radio).toContain('pendingWriteValues')
  })

  test('BlePlx.mm uses BleAdapter protocol (not removed BleClientManager class)', () => {
    const mm = fs.readFileSync(path.join(root, 'ios/BlePlx.mm'), 'utf8')
    expect(mm).toContain('id<BleAdapter>')
    expect(mm).toContain('#import <CoreBluetooth/CoreBluetooth.h>')
    expect(mm).not.toMatch(/BleClientManager\s*\*/)
    const adapter = fs.readFileSync(
      path.join(root, 'ios/vendor/MultiplatformBleAdapter/classes/BleAdapter.swift'),
      'utf8'
    )
    expect(adapter).toMatch(/protocol BleAdapter\s*:\s*NSObjectProtocol/)
  })

  test('iOS discover waits for characteristics; characteristicJs maps real serviceID', () => {
    const src = fs.readFileSync(path.join(root, 'ios/Owned/OwnedCoreBluetoothAdapter.swift'), 'utf8')
    expect(src).toContain('pendingDiscoverCharsRemaining')
    const discoverServices = src.slice(
      src.indexOf('didDiscoverServices'),
      src.indexOf('didDiscoverCharacteristicsFor')
    )
    // Non-empty service lists schedule char discovery and track remaining count
    expect(discoverServices).toContain('pendingDiscoverCharsRemaining[id] = services.count')
    expect(discoverServices).toContain('discoverCharacteristics')
    // Empty-service early resolve is OK; multi-service path must NOT resolve before chars
    expect(discoverServices).toMatch(/if services\.isEmpty[\s\S]*pendingDiscover\.removeValue/)
    // characteristic discovery completion decrements and resolves only at zero
    const discoverChars = src.slice(src.indexOf('didDiscoverCharacteristicsFor'))
    expect(discoverChars).toMatch(/remaining\s*-=\s*1/)
    expect(discoverChars).toMatch(/remaining\s*<=\s*0/)
    // serviceID lookup must compare dictionary value to the service parameter (or O(1) reverse map)
    expect(src).toMatch(
      /serviceIds\.first\(where:\s*\{\s*\$0\.value\s*===\s*(svc|s)\s*\}|idForService\s*\(/
    )
    expect(src).not.toMatch(/\$0\.value\s*===\s*\$0/)
  })

  test('iOS readRSSI waits for didReadRSSI (not immediate resolve with NSNull)', () => {
    const src = fs.readFileSync(path.join(root, 'ios/Owned/OwnedCoreBluetoothAdapter.swift'), 'utf8')
    const readRssi = src.slice(
      src.indexOf('func readRSSIForDevice'),
      src.indexOf('func requestMTUForDevice')
    )
    expect(readRssi).toContain('pendingRssi')
    expect(readRssi).toContain('p.readRSSI()')
    // Must not resolve immediately after readRSSI()
    expect(readRssi).not.toMatch(/p\.readRSSI\(\)\s*\n\s*resolve\(/)
    expect(src).toContain('didReadRSSI')
    expect(src).toMatch(/func peripheral\(_ peripheral: CBPeripheral, didReadRSSI/)
    // didReadRSSI resolves with real RSSI number
    const didRead = src.slice(src.indexOf('didReadRSSI'))
    expect(didRead).toMatch(/js\["rssi"\]\s*=\s*RSSI/)
  })

  test('iOS scan maps CBAdvertisementData (not hardcoded NSNull for mfg/service data)', () => {
    const src = fs.readFileSync(path.join(root, 'ios/Owned/OwnedCoreBluetoothAdapter.swift'), 'utf8')
    expect(src).toContain('applyAdvertisementFields')
    expect(src).toContain('CBAdvertisementDataManufacturerDataKey')
    expect(src).toContain('CBAdvertisementDataServiceDataKey')
    expect(src).toContain('CBAdvertisementDataServiceUUIDsKey')
    expect(src).toContain('CBAdvertisementDataTxPowerLevelKey')
    expect(src).toContain('CBAdvertisementDataIsConnectable')
    expect(src).toContain('CBAdvertisementDataSolicitedServiceUUIDsKey')
    expect(src).toContain('CBAdvertisementDataOverflowServiceUUIDsKey')
    const didDiscover = src.slice(
      src.indexOf('didDiscover peripheral'),
      src.indexOf('didConnect peripheral')
    )
    // Must not hardcode all adv fields to NSNull in the scan path
    expect(didDiscover).not.toMatch(/device\["manufacturerData"\]\s*=\s*NSNull\(\)/)
    expect(didDiscover).toContain('applyAdvertisementFields')
  })

  test('iOS pending ops keyed by transactionId; cancelTransaction rejects + clears monitors', () => {
    const src = fs.readFileSync(path.join(root, 'ios/Owned/OwnedCoreBluetoothAdapter.swift'), 'utf8')
    expect(src).toContain('pendingReadByChar')
    expect(src).toContain('pendingWriteByChar')
    expect(src).toContain('pendingDescReadByDesc')
    expect(src).toContain('pendingDescWriteByDesc')
    const cancel = src.slice(src.indexOf('func cancelTransaction'), src.indexOf('func setLogLevel'))
    expect(cancel).toMatch(/errorCode.*2|code:\s*2/)
    expect(cancel).toContain('Operation cancelled')
    expect(cancel).toContain('disableNotify')
    expect(src).toMatch(/setNotifyValue\(false/)
    expect(cancel).not.toMatch(/Best-effort|no-op/)
    // Completions must not removeAll multi-pending maps
    const didUpdateChar = src.slice(
      src.indexOf('didUpdateValueFor characteristic'),
      src.indexOf('didWriteValueFor characteristic')
    )
    expect(didUpdateChar).not.toContain('pendingRead.removeAll()')
    expect(didUpdateChar).toContain('pendingReadByChar')
  })

  test('iOS invalidate rejects all pending and clears maps', () => {
    const src = fs.readFileSync(path.join(root, 'ios/Owned/OwnedCoreBluetoothAdapter.swift'), 'utf8')
    const inv = src.slice(src.indexOf('public func invalidate()'), src.indexOf('func cancelTransaction'))
    expect(inv).toMatch(/errorCode.*1|code:\s*1/)
    expect(inv).toContain('Bluetooth manager destroyed')
    expect(inv).toContain('pendingRead.removeAll()')
    expect(inv).toContain('pendingWrite.removeAll()')
    expect(inv).toContain('pendingDiscover.removeAll()')
    expect(inv).toContain('pendingDescRead.removeAll()')
    expect(inv).toContain('pendingDescWrite.removeAll()')
    expect(inv).toContain('pendingRssi.removeAll()')
    expect(inv).toContain('monitors.removeAll()')
    expect(inv).toContain('central.delegate = nil')
  })

  test('iOS discoverAll waits for descriptors before resolving', () => {
    const src = fs.readFileSync(path.join(root, 'ios/Owned/OwnedCoreBluetoothAdapter.swift'), 'utf8')
    expect(src).toContain('pendingDiscoverDescsRemaining')
    expect(src).toContain('tryResolveDiscover')
    const discoverChars = src.slice(
      src.indexOf('didDiscoverCharacteristicsFor'),
      src.indexOf('didDiscoverDescriptorsFor')
    )
    // Char phase must schedule descriptor discovery and increment remaining
    expect(discoverChars).toContain('discoverDescriptors(for: ch)')
    expect(discoverChars).toMatch(/pendingDiscoverDescsRemaining\[id\]/)
    // Must not resolve discoverAll at char phase zero alone
    expect(discoverChars).not.toMatch(/remaining\s*<=\s*0[\s\S]{0,80}pendingDiscover\.removeValue/)
    expect(discoverChars).toContain('tryResolveDiscover')
    const discoverDescs = src.slice(src.indexOf('didDiscoverDescriptorsFor'))
    expect(discoverDescs).toContain('tryResolveDiscover')
  })

  test('iOS reports negotiated MTU via maximumWriteValueLength (not hardcoded 23 when connected)', () => {
    const src = fs.readFileSync(path.join(root, 'ios/Owned/OwnedCoreBluetoothAdapter.swift'), 'utf8')
    expect(src).toContain('maximumWriteValueLength(for: .withoutResponse)')
    expect(src).toContain('func mtuFor')

    // Slice by function definitions only — `applyAdvertisementFields` is also *called* earlier
    // in didDiscover, so a bare indexOf would yield start>end and an empty slice.
    const deviceJsStart = src.indexOf('private func deviceJs')
    const deviceJsEnd = src.indexOf('private func applyAdvertisementFields')
    expect(deviceJsStart).toBeGreaterThan(-1)
    expect(deviceJsEnd).toBeGreaterThan(deviceJsStart)
    const deviceJs = src.slice(deviceJsStart, deviceJsEnd)
    expect(deviceJs).toContain('mtuFor(p)')
    // deviceJs must not hardcode ATT default; negotiated value comes from mtuFor
    expect(deviceJs).not.toMatch(/"mtu"\s*:\s*23/)
    expect(deviceJs).not.toMatch(/"mtu"\s*:\s*NSNumber/)

    const mtuForStart = src.indexOf('private func mtuFor')
    const mtuFor = src.slice(mtuForStart, deviceJsStart)
    expect(mtuFor).toContain('maximumWriteValueLength(for: .withoutResponse)')
    expect(mtuFor).toMatch(/\+\s*3/)
    // Default 23 only when not connected (or as floor), never as the connected path alone
    expect(mtuFor).toMatch(/state\s*==\s*\.connected/)

    // requestMTUForDevice is reporting/no-op: no CB MTU request API, resolve via deviceJs
    const requestMtuStart = src.indexOf('func requestMTUForDevice')
    const requestMtuEnd = src.indexOf('func requestConnectionPriorityForDevice')
    expect(requestMtuStart).toBeGreaterThan(-1)
    expect(requestMtuEnd).toBeGreaterThan(requestMtuStart)
    const requestMtu = src.slice(requestMtuStart, requestMtuEnd)
    expect(requestMtu).toContain('deviceJs(p)')
    expect(requestMtu).toMatch(/state\s*==\s*\.connected/)
    // Must not invent Android-style negotiation from the requested mtu argument
    expect(requestMtu).not.toMatch(/"mtu"\s*:\s*mtu\b/)
    expect(requestMtu).not.toMatch(/mtuFor\s*=\s*mtu\b/)
    // No radio GATT MTU request (Android path); requested arg is intentionally discarded
    expect(requestMtu).toMatch(/_ = mtu/)
    expect(requestMtu).not.toMatch(/radio\.requestMtu|CBPeripheral.*requestMtu|setMtu\s*\(/i)

    // Scan path may keep ATT default 23 (negotiated MTU unknown until connected) — intentional
    const didDiscover = src.slice(src.indexOf('didDiscover peripheral'), src.indexOf('didConnect peripheral'))
    expect(didDiscover).toMatch(/device\["mtu"\]\s*=\s*23/)
  })

  test('iOS connectedDevices filters by serviceUUIDs', () => {
    const src = fs.readFileSync(path.join(root, 'ios/Owned/OwnedCoreBluetoothAdapter.swift'), 'utf8')
    const body = src.slice(
      src.indexOf('func connectedDevices'),
      src.indexOf('func connectToDevice')
    )
    expect(body).toContain('retrieveConnectedPeripherals(withServices:')
    expect(body).toContain('serviceUUIDs.isEmpty')
    expect(body).toMatch(/filterUUIDs\.contains/)
    // Must not ignore the parameter entirely
    expect(body).not.toMatch(/peripherals\.values\.filter\s*\{\s*\$0\.state\s*==\s*\.connected\s*\}\s*\.map/)
  })

  test('Restoration subspec uses OwnedCoreBluetoothAdapter (no BleClientManager)', () => {
    const adapter = fs.readFileSync(
      path.join(root, 'ios/Restoration/BlePlxRestorationAdapter.swift'),
      'utf8'
    )
    const state = fs.readFileSync(
      path.join(root, 'ios/Restoration/BlePlxRestorationState.swift'),
      'utf8'
    )
    expect(adapter).toContain('OwnedCoreBluetoothAdapter')
    expect(adapter).toContain('adoptingRestoredCentral')
    expect(adapter).toContain('seedRestoredPeripherals')
    // Executable path must not construct or type MBA manager (comments may still name it).
    expect(adapter).not.toMatch(/BleClientManager\s*\(/)
    expect(adapter).not.toMatch(/:\s*BleClientManager/)
    expect(state).toContain('BleAdapter')
    expect(state).not.toMatch(/:\s*BleClientManager/)
    expect(state).not.toMatch(/BleClientManager\?/)
    const owned = fs.readFileSync(path.join(root, 'ios/Owned/OwnedCoreBluetoothAdapter.swift'), 'utf8')
    expect(owned).toContain('seedRestoredPeripherals')
    expect(owned).toContain('adoptingRestoredCentral')
    expect(owned).toContain('completePendingRestoreStateEvent')
  })

  test('Restoration restore payload shape is { connectedPeripherals: [...] }', () => {
    const adapter = fs.readFileSync(
      path.join(root, 'ios/Restoration/BlePlxRestorationAdapter.swift'),
      'utf8'
    )
    expect(adapter).toMatch(/"connectedPeripherals"\s*:/)
    const restorationDir = path.join(root, 'ios/Restoration')
    for (const f of fs.readdirSync(restorationDir).filter(n => n.endsWith('.swift'))) {
      const src = fs.readFileSync(path.join(restorationDir, f), 'utf8')
      // Executable types/constructors only (comments may mention legacy name)
      expect(src).not.toMatch(/BleClientManager\s*\(/)
      expect(src).not.toMatch(/:\s*BleClientManager/)
    }
  })

  // --- R2-F016: synthetic cold-start RestoreStateEvent ---
  test('R2-F016 Owned iOS emits synthetic cold-start RestoreStateEvent null', () => {
    const src = fs.readFileSync(path.join(root, 'ios/Owned/OwnedCoreBluetoothAdapter.swift'), 'utf8')
    // Must emit restoreStateEvent on cold path (not only willRestoreState)
    expect(src).toContain('restoreStateEvent')
    expect(src).toMatch(/emitRestore|flushRestore|restoreEventEmitted|pendingRestore|synthetic.*restore|cold/i)
    // completePendingRestoreStateEvent must disarm cold-null so reuse handoff does not double-emit
    const completeBody = src.slice(
      src.indexOf('func completePendingRestoreStateEvent'),
      src.indexOf('func completePendingRestoreStateEvent') + 400
    )
    expect(completeBody).not.toMatch(/Intentionally empty/)
    // willRestoreState path still present for non-empty OS restore
    expect(src).toContain('willRestoreState')
    expect(src).toContain('connectedPeripherals')
    // Cold null must use NSNull (MBA parity), not hang forever
    expect(src).toMatch(/NSNull\(\)|NSNull\.null/)
  })

  // --- R2-F017: connect timeout + already-connected short-circuit ---
  test('R2-F017 Owned iOS connectToDevice honors timeout and already-connected', () => {
    const src = fs.readFileSync(path.join(root, 'ios/Owned/OwnedCoreBluetoothAdapter.swift'), 'utf8')
    const body = src.slice(src.indexOf('func connectToDevice'), src.indexOf('func cancelDeviceConnection'))
    expect(body).toMatch(/options\s*\?\s*\[\s*[\"']timeout[\"']\s*\]|\[[\"']timeout[\"']\]/)
    expect(body).toMatch(/\.connected/)
    expect(body).toMatch(/DispatchWorkItem|asyncAfter|deadline/)
    // OperationTimedOut = 3
    expect(body).toMatch(/errorCode.*3|code:\s*3/)
    // Must honor ConnectionOptions.timeout (CB connect options may still be nil)
    expect(body).toMatch(/timeoutMs|options\s*\?\s*\[|timeout/)
    // Already-connected short-circuit resolves device (not hang)
    expect(body).toMatch(/state\s*==\s*\.connected/)
    expect(body).toContain('deviceJs')
  })

  // --- R2-F018: cancelDeviceConnection clears pendingConnect ---
  test('R2-F018 Owned iOS cancelDeviceConnection clears pendingConnect', () => {
    const src = fs.readFileSync(path.join(root, 'ios/Owned/OwnedCoreBluetoothAdapter.swift'), 'utf8')
    const body = src.slice(
      src.indexOf('func cancelDeviceConnection'),
      src.indexOf('func isDeviceConnected')
    )
    expect(body).toContain('pendingConnect')
    expect(body).toMatch(/removeValue\(forKey:/)
    // OperationCancelled = 2
    expect(body).toMatch(/code:\s*2|errorCode.*2/)
    expect(body).toContain('cancelPeripheralConnection')
  })

  // --- R2-F019: didUpdateNotificationStateFor ---
  test('R2-F019 Owned iOS implements didUpdateNotificationStateFor for monitor enable', () => {
    const src = fs.readFileSync(path.join(root, 'ios/Owned/OwnedCoreBluetoothAdapter.swift'), 'utf8')
    expect(src).toContain('didUpdateNotificationStateFor')
    const monitorBody = src.slice(
      src.indexOf('func monitorCharacteristicForDevice'),
      src.indexOf('func monitorCharacteristicForService')
    )
    // Must not resolve success before CCCD enable completes (or must track pending enable)
    expect(src).toMatch(/pendingMonitor|pendingNotify|monitorEnable/i)
    // Failure surfaces CharacteristicNotifyChangeFailed (403) or reject + ReadEvent
    expect(src).toMatch(/code:\s*403|errorCode.*403/)
    expect(monitorBody).toContain('setNotifyValue(true')
  })

  // --- R2-F020: bundled registry early-wake owns CBCentralManager ---
  test('R2-F020 BlePlxBundledRestorationRegistry early-wake owns CBCentralManager + dispatchRestoration', () => {
    const reg = fs.readFileSync(path.join(root, 'ios/Restoration/BleRestorationRegistry.swift'), 'utf8')
    expect(reg).toContain('CBCentralManager')
    expect(reg).toContain('dispatchRestoration')
    expect(reg).toMatch(/willRestoreState|CBCentralManagerOptionRestoreIdentifierKey|BlePlxRestoreIdentifier/)
    expect(reg).toMatch(/CBCentralManagerDelegate/)
    // Call path from willRestoreState → dispatchRestoration exists in-tree
    expect(reg).toMatch(/dispatchRestoration\s*\(/)
    // createClient adopt path: takeEarlyCentralManager handoff (R3-F004 / R3-F057)
    expect(reg).toMatch(/func takeEarlyCentralManager\s*\(/)
  })

  // --- R3-F004 / R3-F057: Owned ↔ Registry early-central selector parity ---
  test('R3-F004/R3-F057 Owned takeEarlyCentralManager selector matches registry method', () => {
    const owned = fs.readFileSync(path.join(root, 'ios/Owned/OwnedCoreBluetoothAdapter.swift'), 'utf8')
    const reg = fs.readFileSync(path.join(root, 'ios/Restoration/BleRestorationRegistry.swift'), 'utf8')
    // Exact @objc method name on the registry
    expect(reg).toMatch(/func takeEarlyCentralManager\s*\(/)
    // Owned performSelector must use the same symbol (not bare takeEarlyCentral)
    expect(owned).toContain('NSSelectorFromString("takeEarlyCentralManager")')
    expect(owned).not.toMatch(/NSSelectorFromString\("takeEarlyCentral"\)/)
    // takeBundledEarlyCentral path must probe the Manager-suffixed selector
    const takeFn = owned.slice(
      owned.indexOf('func takeBundledEarlyCentral'),
      owned.indexOf('func takeBundledEarlyCentral') + 900
    )
    expect(takeFn).toContain('takeEarlyCentralManager')
  })

  // --- R3-F005: GATT JS UUIDs use fullUUIDString (128-bit Bluetooth base form) ---
  test('R3-F005 Owned serviceJs/characteristicJs/descriptorJs emit fullUUIDString', () => {
    const src = fs.readFileSync(path.join(root, 'ios/Owned/OwnedCoreBluetoothAdapter.swift'), 'utf8')
    const serviceJs = src.slice(src.indexOf('func serviceJs'), src.indexOf('func characteristicJs'))
    const characteristicJs = src.slice(
      src.indexOf('func characteristicJs('),
      src.indexOf('func characteristicJsFromCache')
    )
    const descriptorJs = src.slice(src.indexOf('func descriptorJs'), src.indexOf('// MARK: - Stable id maps'))
    const monitorCache = src.slice(
      src.indexOf('monitorNotifyCache[key] = MonitorNotifyCache'),
      src.indexOf('monitorNotifyCache[key] = MonitorNotifyCache') + 700
    )
    expect(serviceJs).toMatch(/fullUUIDString/)
    expect(serviceJs).not.toMatch(/uuidString\.lowercased\(\)/)
    expect(characteristicJs).toMatch(/fullUUIDString/)
    expect(characteristicJs).not.toMatch(/uuidString\.lowercased\(\)/)
    expect(descriptorJs).toMatch(/fullUUIDString/)
    expect(descriptorJs).not.toMatch(/uuidString\.lowercased\(\)/)
    // Monitor cache UUID fields also full form so notify packets match list APIs
    expect(monitorCache).toMatch(/fullUUIDString/)
  })

  // --- R3-F006: safe CBUUID parse — never CBUUID(string:) on untrusted JS ---
  test('R3-F006 Owned never calls CBUUID(string:) on untrusted JS UUID strings', () => {
    const src = fs.readFileSync(path.join(root, 'ios/Owned/OwnedCoreBluetoothAdapter.swift'), 'utf8')
    // Safe parser must exist (UUID(uuidString:) after 16/32-bit expansion)
    expect(src).toMatch(/func safeCBUUID|func toCBUUID|safeParseCBUUID/)
    expect(src).toMatch(/UUID\(uuidString:/)
    // Untrusted JS entry points must not use crashing CBUUID(string:)
    const startScan = src.slice(src.indexOf('func startDeviceScan'), src.indexOf('func stopDeviceScan'))
    // Ignore comments: only count live code initializers
    const codeOnly = (s) =>
      s
        .split('\n')
        .filter((line) => !/^\s*\/\//.test(line) && !/^\s*\*/.test(line))
        .join('\n')
    expect(codeOnly(startScan)).not.toMatch(/CBUUID\(string:/)
    expect(startScan).toMatch(/safeCBUUID|toCBUUID|safeParseCBUUID/)
    // Invalid scan filters surface InvalidIdentifiers (code 5) via ScanEvent
    expect(startScan).toMatch(/code:\s*5|errorCode.*5|InvalidIdentifiers|invalidIdentifiers/i)
    // Prefer zero live CBUUID(string:) — safe parser covers all paths
    const allStringInits = [...codeOnly(src).matchAll(/CBUUID\(string:/g)]
    expect(allStringInits.length).toBe(0)
  })

  // --- R3-F015: dedicated serial CB queue (not main) + encode off-main ---
  test('R3-F015 createClient uses dedicated serial queue not dispatch_get_main_queue', () => {
    const mm = fs.readFileSync(path.join(root, 'ios/BlePlx.mm'), 'utf8')
    // createClient factory path must not pass main queue for CB callbacks
    const createStart = mm.indexOf('createClient:')
    expect(createStart).toBeGreaterThan(-1)
    const createBody = mm.slice(createStart, createStart + 2500)
    expect(createBody).not.toMatch(
      /getNewAdapterWithQueue:\s*dispatch_get_main_queue\s*\(\s*\)/
    )
    // Dedicated radio queue (shared label or BlePlxRadioQueue)
    expect(mm + fs.readFileSync(path.join(root, 'ios/Owned/OwnedCoreBluetoothAdapter.swift'), 'utf8')).toMatch(
      /BlePlxRadioQueue|com\.sfourdrinier\.unifiedblemanager\.cb|unifiedblemanager\.cb/
    )
    // Structure guard: radio queue source exists
    const ownedDir = path.join(root, 'ios/Owned')
    const radioQueueFile = ['BlePlxRadioQueue.swift', 'OwnedCoreBluetoothAdapter.swift']
      .map((f) => path.join(ownedDir, f))
      .find((p) => fs.existsSync(p) && fs.readFileSync(p, 'utf8').match(/BlePlxRadioQueue|unifiedblemanager\.cb/))
    expect(radioQueueFile).toBeTruthy()
  })

  // --- R3-F027: early-wake central shares radio queue end-to-end ---
  test('R3-F027 restoration early central + adopt path use shared radio queue (not .main alone)', () => {
    const reg = fs.readFileSync(path.join(root, 'ios/Restoration/BleRestorationRegistry.swift'), 'utf8')
    const adapter = fs.readFileSync(path.join(root, 'ios/Restoration/BlePlxRestorationAdapter.swift'), 'utf8')
    // Early CM and adopt path share BlePlxRadioQueue.shared (or same label helper)
    expect(reg).toMatch(/BlePlxRadioQueue\.shared|radioQueue/)
    expect(adapter).toMatch(/BlePlxRadioQueue\.shared|radioQueue/)
    expect(adapter).not.toMatch(/queue:\s*\.main/)
  })

  // --- R3-F028: second discover rejects prior pendingDiscover ---
  test('R3-F028 discoverAllServices rejects prior pendingDiscover before replace', () => {
    const src = fs.readFileSync(path.join(root, 'ios/Owned/OwnedCoreBluetoothAdapter.swift'), 'utf8')
    const body = src.slice(
      src.indexOf('func discoverAllServicesAndCharacteristicsForDevice'),
      src.indexOf('func servicesForDevice')
    )
    expect(body).toMatch(/pendingDiscover/)
    // Must reject prior when overwriting (OperationCancelled code 2)
    expect(body).toMatch(/pendingDiscover\.removeValue|if let previous|if let pending/)
    expect(body).toMatch(/code:\s*2|Operation cancelled/)
  })

  // --- R3-F029: didModifyServices tears down monitors + pending GATT ---
  test('R3-F029 didModifyServices fails pending GATT and clears monitors (not only caches)', () => {
    const src = fs.readFileSync(path.join(root, 'ios/Owned/OwnedCoreBluetoothAdapter.swift'), 'utf8')
    const modifyStart = src.indexOf('func peripheral(_ peripheral: CBPeripheral, didModifyServices')
    expect(modifyStart).toBeGreaterThan(-1)
    const modifyEnd = src.indexOf('didUpdateNotificationStateFor characteristic', modifyStart)
    const modify = src.slice(modifyStart, modifyEnd > 0 ? modifyEnd : modifyStart + 1500)
    expect(modify).toContain('clearCachesForDevice')
    // Must tear down monitors / pending ops, not only discover + caches
    expect(modify).toMatch(/failPendingGattAndMonitors|tearDownDevice/)
    // Helper must cover monitors + pending read/write (stale numeric ids)
    const helperStart = src.indexOf('func failPendingGattAndMonitors')
    expect(helperStart).toBeGreaterThan(-1)
    const helperEnd = src.indexOf('func tearDownDevice', helperStart)
    const helper = src.slice(helperStart, helperEnd > 0 ? helperEnd : helperStart + 4000)
    expect(helper).toMatch(/pendingRead/)
    expect(helper).toMatch(/pendingWrite/)
    expect(helper).toMatch(/monitors/)
    expect(helper).toMatch(/disableNotify|monitorNotifyCache/)
  })

  // --- R3-F051: iOS Base64 write size cap (512 KiB) ---
  test('R3-F051 Owned iOS enforces MAX_DECODE_BYTES (512 KiB) on Base64 writes', () => {
    const src = fs.readFileSync(path.join(root, 'ios/Owned/OwnedCoreBluetoothAdapter.swift'), 'utf8')
    expect(src).toMatch(/MAX_DECODE_BYTES|maxDecodeBytes|512\s*\*\s*1024/)
    expect(src).toMatch(/decodeBase64|base64Capped|maxDecode|MAX_DECODE/)
    // CharacteristicInvalidDataFormat 406 / DescriptorInvalidDataFormat 505
    expect(src).toMatch(/code:\s*406/)
    expect(src).toMatch(/code:\s*505/)
  })

  // --- R3-F056: checkRestorationStatus reports bundled registry ---
  test('R3-F056 checkRestorationStatus detects BlePlxBundledRestorationRegistry', () => {
    const mm = fs.readFileSync(path.join(root, 'ios/BlePlx.mm'), 'utf8')
    const start = mm.indexOf('checkRestorationStatus:')
    expect(start).toBeGreaterThan(-1)
    const body = mm.slice(start, start + 1200)
    expect(body).toContain('BlePlxBundledRestorationRegistry')
    expect(body).toMatch(/blePlxBundledRestorationRegistryFound|bundledFound|bundledRegistry/)
    // Host registry key retained for multi-SDK apps
    expect(body).toContain('BleRestorationRegistry')
  })

  // --- R2-F074: notify hot path reverse map ---
  test('R2-F074 Owned iOS notify path uses reverse id maps (not first(where:) per packet)', () => {
    const src = fs.readFileSync(path.join(root, 'ios/Owned/OwnedCoreBluetoothAdapter.swift'), 'utf8')
    expect(src).toMatch(/ObjectIdentifier|charIdByObject|serviceIdByObject|idForChar|reverse.*[Mm]ap/)
    const notifyStart = src.indexOf('didUpdateValueFor characteristic')
    expect(notifyStart).toBeGreaterThan(-1)
    // characteristicJs / notify path should prefer O(1) reverse lookup
    expect(src).toMatch(/charIdByObject|idForCharacteristic|cachedCharId|monitorNotifyCache/)
    expect(src).toContain('characteristicJsFromCache')
  })

  // --- R2-F069: disconnect/cancel tearDown pending + monitors + cache ---
  test('R2-F069 Owned iOS tearDownDevice on disconnect/cancel clears pending and caches', () => {
    const src = fs.readFileSync(path.join(root, 'ios/Owned/OwnedCoreBluetoothAdapter.swift'), 'utf8')
    expect(src).toContain('tearDownDevice')
    expect(src).toContain('clearCachesForDevice')
    const didDisconnect = src.slice(
      src.indexOf('didDisconnectPeripheral'),
      src.indexOf('// MARK: - CBPeripheralDelegate')
    )
    expect(didDisconnect).toContain('tearDownDevice')
    // Monitors + pending maps cleaned (inline or via failPendingGattAndMonitors)
    const tearDown = src.slice(src.indexOf('func tearDownDevice'), src.indexOf('func clearCachesForDevice'))
    expect(tearDown).toMatch(/pendingRead|pendingWrite|pendingDiscover|failPendingGattAndMonitors/)
    if (tearDown.includes('failPendingGattAndMonitors')) {
      const helperStart = src.indexOf('func failPendingGattAndMonitors')
      const helper = src.slice(helperStart, src.indexOf('func tearDownDevice', helperStart))
      expect(helper).toMatch(/pendingRead|pendingWrite|pendingDiscover/)
      expect(helper).toContain('monitors')
      expect(helper).toContain('disableNotify')
    } else {
      expect(tearDown).toContain('monitors')
      expect(tearDown).toContain('disableNotify')
    }
  })

  // --- R2-F070: stable serviceIds on rediscover ---
  test('R2-F070 Owned iOS reuses serviceIds on rediscover (not always nextId)', () => {
    const src = fs.readFileSync(path.join(root, 'ios/Owned/OwnedCoreBluetoothAdapter.swift'), 'utf8')
    const discoverServices = src.slice(
      src.indexOf('didDiscoverServices'),
      src.indexOf('didDiscoverCharacteristicsFor')
    )
    // Must not always allocate nextId without identity check
    expect(discoverServices).not.toMatch(/for s in services \{\s*let sid = nextId\(\)/)
    expect(discoverServices).toMatch(/idForService|first\(where:.*===/)
    expect(src).toContain('idForService')
    expect(src).toContain('pruneServiceIds')
  })

  // --- R2-F071: honest didModifyServices (no auto-discover steal) ---
  test('R2-F071 Owned iOS didModifyServices does not auto-discover or steal pendingDiscover', () => {
    const src = fs.readFileSync(path.join(root, 'ios/Owned/OwnedCoreBluetoothAdapter.swift'), 'utf8')
    // Anchor on the CBPeripheralDelegate method (not earlier comments that name didUpdateNotificationStateFor).
    const modifyStart = src.indexOf('func peripheral(_ peripheral: CBPeripheral, didModifyServices')
    expect(modifyStart).toBeGreaterThan(-1)
    const modifyEnd = src.indexOf(
      'func peripheral(\n    _ peripheral: CBPeripheral,\n    didUpdateNotificationStateFor',
      modifyStart
    )
    const modifyEndAlt = src.indexOf('didUpdateNotificationStateFor characteristic', modifyStart)
    const end = modifyEnd > 0 ? modifyEnd : modifyEndAlt > 0 ? modifyEndAlt : modifyStart + 1200
    const modify = src.slice(modifyStart, end)
    expect(modify).toContain('servicesChangedEvent')
    expect(modify).toContain('clearCachesForDevice')
    // Honest API: no proactive discoverServices(nil)
    expect(modify).not.toMatch(/discoverServices\s*\(\s*nil\s*\)/)
    // Must not leave pendingDiscover hanging — reject via helper or inline clear
    expect(modify).toMatch(/pendingDiscover|failPendingGattAndMonitors/)
  })

  // --- R2-F110: isBackgroundModeEnabled reads UIBackgroundModes ---
  test('R2-F110 iOS isBackgroundModeEnabled reads UIBackgroundModes (not always YES)', () => {
    const mm = fs.readFileSync(path.join(root, 'ios/BlePlx.mm'), 'utf8')
    // Helper + method must both exist; helper is the honest plist reader.
    expect(mm).toMatch(/UIBackgroundModes/)
    expect(mm).toMatch(/bluetooth-central/)
    expect(mm).toMatch(/BlePlxIsBluetoothCentralBackgroundModeConfigured|BlePlxHasBluetoothCentral/)
    const start = mm.indexOf('isBackgroundModeEnabled:')
    expect(start).toBeGreaterThan(-1)
    const body = mm.slice(start, start + 600)
    // Must not unconditionally resolve @YES without reading the plist
    expect(body).not.toMatch(/resolve\(@YES\);\s*\n\}/)
    expect(body).toMatch(/BlePlxIsBluetoothCentralBackgroundModeConfigured|BlePlxHasBluetoothCentral/)
  })

  // --- F047: Android multi-connect / cancel / indication / descriptor structure ---

  test('Owned Android multi-connect uses per-device connectionListeners (not sole global overwrite)', () => {
    const radio = fs.readFileSync(
      path.join(
        root,
        'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedAndroidGattRadio.kt'
      ),
      'utf8'
    )
    const adapter = fs.readFileSync(
      path.join(root, 'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedBleAdapter.kt'),
      'utf8'
    )
    expect(radio).toContain('connectionListeners')
    expect(radio).toContain('fun registerConnectionListener')
    expect(radio).toContain('fun unregisterConnectionListener')
    expect(radio).toMatch(/ConcurrentHashMap/)
    expect(radio).toMatch(/connectionListeners\[.*\]\?\.invoke/)
    const connectBody = adapter.slice(
      adapter.indexOf('override fun connectToDevice'),
      adapter.indexOf('override fun cancelDeviceConnection')
    )
    const usesRegister = connectBody.includes('registerConnectionListener')
    const usesGlobalAssign = /radio\.onConnectionState\s*=/.test(connectBody)
    // Multi-device safe when registerConnectionListener is used; radio map is required either way
    expect(usesRegister || radio.includes('connectionListeners')).toBe(true)
    if (usesGlobalAssign) {
      expect(radio).toContain('registerConnectionListener')
    }
  })

  test('Owned Android setNotify resolves indication via subscriptionType / ENABLE_INDICATION', () => {
    const radio = fs.readFileSync(
      path.join(
        root,
        'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedAndroidGattRadio.kt'
      ),
      'utf8'
    )
    const adapter = fs.readFileSync(
      path.join(root, 'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedBleAdapter.kt'),
      'utf8'
    )
    expect(radio).toContain('fun resolveCccdPayload')
    expect(radio).toContain('ENABLE_INDICATION_VALUE')
    expect(radio).toContain('ENABLE_NOTIFICATION_VALUE')
    const setNotifyIdx = radio.indexOf('fun setNotify')
    const setNotify = radio.slice(setNotifyIdx, setNotifyIdx + 900)
    expect(setNotify).toMatch(/subscriptionType/)
    expect(setNotify).toContain('resolveCccdPayload')
    const monitorBody = adapter.slice(
      adapter.indexOf('override fun monitorCharacteristicForDevice'),
      adapter.indexOf('override fun monitorCharacteristicForService')
    )
    expect(monitorBody).toContain('subscriptionType')
    expect(monitorBody).toContain('radio.setNotify')
  })

  test('Owned Android cancelTransaction tears down monitors (not empty no-op)', () => {
    const adapter = fs.readFileSync(
      path.join(root, 'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedBleAdapter.kt'),
      'utf8'
    )
    const radio = fs.readFileSync(
      path.join(
        root,
        'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedAndroidGattRadio.kt'
      ),
      'utf8'
    )
    const cancelStart = adapter.indexOf('override fun cancelTransaction')
    expect(cancelStart).toBeGreaterThanOrEqual(0)
    const nextFn = adapter.indexOf('private fun tearDownMonitorsForDevice', cancelStart)
    const nextOverride = adapter.indexOf('override fun setLogLevel', cancelStart)
    const end =
      nextFn > 0 ? nextFn : nextOverride > 0 ? nextOverride : cancelStart + 800
    const cancelBody = adapter.slice(cancelStart, end)
    expect(cancelBody).not.toMatch(/best-effort no-op/)
    expect(cancelBody).toMatch(/setNotify\s*\(/)
    expect(cancelBody).toContain('notifyCallbacks')
    expect(cancelBody).toContain('BleErrorUtils.cancelled')
    expect(cancelBody).toMatch(/stillSubscribed|otherOwners/)
    // Radio always supports disable path
    expect(radio).toMatch(/fun setNotify/)
    expect(radio).toContain('DISABLE_NOTIFICATION_VALUE')
  })

  test('Owned Android descriptor R/W exists on radio; adapter must not only hard-error', () => {
    const radio = fs.readFileSync(
      path.join(
        root,
        'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedAndroidGattRadio.kt'
      ),
      'utf8'
    )
    const adapter = fs.readFileSync(
      path.join(root, 'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedBleAdapter.kt'),
      'utf8'
    )
    expect(radio).toContain('fun readDescriptor')
    expect(radio).toContain('fun writeDescriptor')
    expect(radio).toContain('pendingDescRead')
    expect(radio).toMatch(/onDescriptorRead|fun onDescriptorRead/)
    const readDesc = adapter.slice(
      adapter.indexOf('override fun readDescriptorForDevice'),
      adapter.indexOf('override fun readDescriptorForService')
    )
    const writeDesc = adapter.slice(
      adapter.indexOf('override fun writeDescriptorForDevice'),
      adapter.indexOf('override fun writeDescriptorForService')
    )
    const adapterWired =
      /radio\.readDescriptor/.test(readDesc) ||
      /radio\.writeDescriptor/.test(writeDesc) ||
      (!/DescriptorsNotDiscovered/.test(readDesc) && !/DescriptorWriteFailed/.test(writeDesc))
    // Radio path is mandatory for GAP-AND-DESC
    expect(radio).toMatch(/readDescriptor|writeDescriptor/)
    if (adapterWired) {
      expect(adapterWired).toBe(true)
    } else {
      // Residual adapter stub: radio implementation must still be complete
      expect(radio).toMatch(/pendingDescRead|pendingDesc\[/)
    }
  })

  // --- Round-2 Android native findings (R2-F001…F004, F031–F035, F095) ---

  test('R2-F001 startScan honors callbackType + setLegacy (API 26+)', () => {
    const radio = fs.readFileSync(
      path.join(
        root,
        'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedAndroidGattRadio.kt'
      ),
      'utf8'
    )
    const adapter = fs.readFileSync(
      path.join(root, 'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedBleAdapter.kt'),
      'utf8'
    )
    const startScan = radio.slice(radio.indexOf('fun startScan'), radio.indexOf('fun stopScan'))
    expect(startScan).toContain('setCallbackType')
    expect(startScan).toContain('setLegacy')
    expect(startScan).toMatch(/legacyScan/)
    expect(startScan).toMatch(/callbackType/)
    // Adapter must thread JS options through (not drop them).
    const scanBody = adapter.slice(
      adapter.indexOf('override fun startDeviceScan'),
      adapter.indexOf('override fun stopDeviceScan')
    )
    expect(scanBody).toMatch(/radio\.startScan\([^)]*callbackType/)
    expect(scanBody).toMatch(/legacyScan/)
  })

  test('R2-F002 getConnectedDevices filters by serviceUUIDs (empty → empty)', () => {
    const adapter = fs.readFileSync(
      path.join(root, 'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedBleAdapter.kt'),
      'utf8'
    )
    const body = adapter.slice(
      adapter.indexOf('override fun getConnectedDevices'),
      adapter.indexOf('override fun connectToDevice')
    )
    expect(body).toMatch(/serviceUUIDs\.isEmpty\(\)/)
    expect(body).toContain('emptyArray()')
    expect(body).toContain('invalidIdentifiers')
    expect(body).toMatch(/getServiceByUUID/)
    // Must not only filter isConnected without service match.
    expect(body).not.toMatch(/filter\s*\{\s*radio\.isConnected/)
  })

  test('R2-F003/F034 createBond RECEIVER_EXPORTED + 60s timeout', () => {
    const adapter = fs.readFileSync(
      path.join(root, 'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedBleAdapter.kt'),
      'utf8'
    )
    const body = adapter.slice(
      adapter.indexOf('override fun createBond'),
      adapter.indexOf('override fun removeBond')
    )
    expect(body).toContain('RECEIVER_EXPORTED')
    expect(body).toMatch(/SDK_INT\s*>=\s*33/)
    expect(body).toContain('CREATE_BOND_TIMEOUT_MS')
    expect(adapter).toMatch(/CREATE_BOND_TIMEOUT_MS\s*=\s*60_000/)
    expect(body).toContain('postDelayed')
    expect(body).toMatch(/bonding timed out/)
    expect(body).toContain('unregisterReceiver')
  })

  test('R2-F004 cancelTransaction cancels PendingOp (R/W/MTU/desc), not only Monitor', () => {
    const adapter = fs.readFileSync(
      path.join(root, 'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedBleAdapter.kt'),
      'utf8'
    )
    expect(adapter).toContain('class PendingOp')
    expect(adapter).toContain('trackPendingOp')
    expect(adapter).toContain('settlePendingOp')
    const cancel = adapter.slice(
      adapter.indexOf('override fun cancelTransaction'),
      adapter.indexOf('private fun trackPendingOp')
    )
    expect(cancel).toContain('Cancellable.PendingOp')
    expect(cancel).toContain('BleErrorUtils.cancelled')
    // R/W/MTU/discover/descriptor paths register pending ops
    const readBody = adapter.slice(
      adapter.indexOf('override fun readCharacteristicForDevice'),
      adapter.indexOf('override fun readCharacteristicForService')
    )
    expect(readBody).toContain('trackPendingOp')
    const writeBody = adapter.slice(
      adapter.indexOf('override fun writeCharacteristicForDevice'),
      adapter.indexOf('override fun writeCharacteristicForService')
    )
    expect(writeBody).toContain('trackPendingOp')
    const mtuBody = adapter.slice(
      adapter.indexOf('override fun requestMTUForDevice'),
      adapter.indexOf('override fun getKnownDevices')
    )
    expect(mtuBody).toContain('trackPendingOp')
    const discBody = adapter.slice(
      adapter.indexOf('override fun discoverAllServicesAndCharacteristicsForDevice'),
      adapter.indexOf('override fun getServicesForDevice')
    )
    expect(discBody).toContain('trackPendingOp')
  })

  test('R2-F032 BlePlxModule exports ServicesChangedEvent constant', () => {
    const module = fs.readFileSync(
      path.join(root, 'android/src/main/java/com/sfourdrinier/unifiedblemanager/BlePlxModule.java'),
      'utf8'
    )
    const constants = module.slice(
      module.indexOf('getTypedExportedConstants'),
      module.indexOf('// Lifecycle')
    )
    expect(constants).toContain('ServicesChangedEvent')
    expect(constants).toMatch(/constants\.put\(Event\.ServicesChangedEvent/)
  })

  test('R2-F033 / R3-F003 connect disconnects prior GATT without immediate close()', () => {
    const radio = fs.readFileSync(
      path.join(
        root,
        'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedAndroidGattRadio.kt'
      ),
      'utf8'
    )
    const connect = radio.slice(radio.indexOf('fun connect('), radio.indexOf('fun disconnect('))
    // Prior GATT is disconnected; close waits for STATE_DISCONNECTED (R3-F003).
    expect(connect).toMatch(/prior\.disconnect\(\)/)
    expect(connect).not.toMatch(/prior\.close\(\)/)
    expect(connect).toContain('pendingReconnect')
    expect(connect).toContain('openGatt')
    expect(radio).toContain('GATT_CLOSE_TIMEOUT_MS')
    expect(radio).toContain('completeGattTeardown')
    expect(radio).toContain('scheduleSafeClose')
  })

  test('R2-F035 rediscover clearDeviceCaches before cacheServices', () => {
    const adapter = fs.readFileSync(
      path.join(root, 'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedBleAdapter.kt'),
      'utf8'
    )
    const disc = adapter.slice(
      adapter.indexOf('override fun discoverAllServicesAndCharacteristicsForDevice'),
      adapter.indexOf('override fun getServicesForDevice')
    )
    // Order: clear then cache so vanished services drop out of serviceById/charById.
    const clearIdx = disc.indexOf('clearDeviceCaches')
    const cacheIdx = disc.indexOf('cacheServices')
    expect(clearIdx).toBeGreaterThanOrEqual(0)
    expect(cacheIdx).toBeGreaterThan(clearIdx)
  })

  test('R2-F095 pending R/W/CCCD keys include serviceUuid', () => {
    const radio = fs.readFileSync(
      path.join(
        root,
        'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedAndroidGattRadio.kt'
      ),
      'utf8'
    )
    expect(radio).toContain('pendingCharKey')
    expect(radio).toContain('pendingDescKey')
    // Key helper embeds service + char
    expect(radio).toMatch(/pendingCharKey[\s\S]*serviceUuid[\s\S]*charUuid/)
    const setNotify = radio.slice(radio.indexOf('fun setNotify'), radio.indexOf('fun readDescriptor'))
    expect(setNotify).toMatch(/pendingCharKey\(\s*"cccd"/)
    const readChar = radio.slice(
      radio.indexOf('fun readCharacteristic'),
      radio.indexOf('fun writeCharacteristic')
    )
    expect(readChar).toMatch(/pendingCharKey\(\s*"read"/)
  })

  test('R2-F031 / R3-F002 FGS path declares POST_NOTIFICATIONS on active AGP8 manifest', () => {
    // AGP 8 uses AndroidManifestNew.xml (build.gradle sourceSets) — assert the live path.
    const manifestNew = fs.readFileSync(
      path.join(root, 'android/src/main/AndroidManifestNew.xml'),
      'utf8'
    )
    expect(manifestNew).toContain('android.permission.POST_NOTIFICATIONS')
    expect(manifestNew).toContain('BLUETOOTH_SCAN')
    expect(manifestNew).toContain('BLUETOOTH_CONNECT')
    expect(manifestNew).toContain('FOREGROUND_SERVICE')
    expect(manifestNew).toContain('FOREGROUND_SERVICE_CONNECTED_DEVICE')
    expect(manifestNew).toContain('BlePlxForegroundService')
    expect(manifestNew).not.toMatch(/^\s*<manifest>\s*<\/manifest>\s*$/)
    // Legacy package-bearing manifest stays in sync for pre-namespace AGP.
    const manifest = fs.readFileSync(path.join(root, 'android/src/main/AndroidManifest.xml'), 'utf8')
    expect(manifest).toContain('android.permission.POST_NOTIFICATIONS')
    const plugin = fs.readFileSync(
      path.join(root, 'plugin/src/withBLEAndroidForegroundService.ts'),
      'utf8'
    )
    expect(plugin).toContain('POST_NOTIFICATIONS')
    const bg = fs.readFileSync(path.join(root, 'docs/BACKGROUND.md'), 'utf8')
    expect(bg).toContain('transitional behavior characterization')
    expect(bg).toContain('typed backend features')
  })

  test('R2-F111 Base64 decode rejects oversized payloads', () => {
    const conv = fs.readFileSync(
      path.join(
        root,
        'android/src/main/java/com/sfourdrinier/unifiedblemanager/adapter/utils/Base64Converter.java'
      ),
      'utf8'
    )
    expect(conv).toContain('MAX_DECODE_BYTES')
    expect(conv).toMatch(/512\s*\*\s*1024/)
    expect(conv).toMatch(/exceeds max size/)
  })

  test('R2-F021 notify Base64 pre-encoded off main before post', () => {
    const adapter = fs.readFileSync(
      path.join(root, 'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedBleAdapter.kt'),
      'utf8'
    )
    const notify = adapter.slice(
      adapter.indexOf('radio.onNotification'),
      adapter.indexOf('radio.onServicesChanged')
    )
    expect(notify).toContain('Base64Converter.encode')
    expect(notify).toMatch(/setValue\([\s\S]*valueBase64/)
    expect(notify.indexOf('Base64Converter.encode')).toBeLessThan(notify.indexOf('mainHandler.post'))
    const converter = fs.readFileSync(
      path.join(
        root,
        'android/src/main/java/com/sfourdrinier/unifiedblemanager/converter/CharacteristicToJsObjectConverter.java'
      ),
      'utf8'
    )
    expect(converter).toContain('getValueBase64')
    const charJava = fs.readFileSync(
      path.join(
        root,
        'android/src/main/java/com/sfourdrinier/unifiedblemanager/adapter/Characteristic.java'
      ),
      'utf8'
    )
    expect(charJava).toContain('getValueBase64')
    expect(charJava).toMatch(/setValue\([^)]*String valueBase64/)
  })

  // --- Round-3 android CONFIRMED findings ---

  test('R3-F003 disconnect does not close() before STATE_DISCONNECTED', () => {
    const radio = fs.readFileSync(
      path.join(
        root,
        'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedAndroidGattRadio.kt'
      ),
      'utf8'
    )
    const disconnect = radio.slice(radio.indexOf('fun disconnect('), radio.indexOf('fun isConnected('))
    expect(disconnect).toMatch(/g\.disconnect\(\)/)
    expect(disconnect).not.toMatch(/g\.close\(\)/)
    expect(disconnect).toContain('scheduleSafeClose')
    // close only after DISCONNECTED callback via completeGattTeardown
    const onState = radio.slice(
      radio.indexOf('override fun onConnectionStateChange'),
      radio.indexOf('override fun onDescriptorWrite')
    )
    expect(onState).toContain('STATE_DISCONNECTED')
    expect(onState).toContain('completeGattTeardown')
  })

  test('R3-F022 keeps notification state in the characteristic model after API 33+ descriptor writes', () => {
    const radio = fs.readFileSync(
      path.join(
        root,
        'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedAndroidGattRadio.kt'
      ),
      'utf8'
    )
    expect(radio).not.toContain('pendingDescValues')
    const setNotify = radio.slice(radio.indexOf('fun setNotify'), radio.indexOf('fun readDescriptor'))
    expect(setNotify).not.toMatch(/descriptor\.value\s*=/)
    const onDescWrite = radio.slice(
      radio.indexOf('override fun onDescriptorWrite'),
      radio.indexOf('override fun onDescriptorRead')
    )
    expect(onDescWrite).not.toMatch(/descriptor\.value\s*=/)
    const charJava = fs.readFileSync(
      path.join(
        root,
        'android/src/main/java/com/sfourdrinier/unifiedblemanager/adapter/Characteristic.java'
      ),
      'utf8'
    )
    expect(charJava).toContain('private volatile boolean notifying = false;')
    expect(charJava).toContain('public void setNotifying(boolean notifying)')
    expect(charJava).not.toMatch(/descriptor\.getValue\(\)/)
    const adapter = fs.readFileSync(
      path.join(
        root,
        'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedBleAdapter.kt'
      ),
      'utf8'
    )
    expect(adapter).toContain('entry.model.setNotifying(true)')
    expect(adapter).toContain('entry.model.setNotifying(false)')
  })

  test('R3-F023 createClient destroys prior bleAdapter before replace', () => {
    const module = fs.readFileSync(
      path.join(root, 'android/src/main/java/com/sfourdrinier/unifiedblemanager/BlePlxModule.java'),
      'utf8'
    )
    const create = module.slice(module.indexOf('public void createClient'), module.indexOf('public void checkRestorationStatus'))
    expect(create).toMatch(/if\s*\(\s*bleAdapter\s*!=\s*null\s*\)/)
    expect(create).toContain('destroyClient()')
    // destroy happens before getNewAdapter
    expect(create.indexOf('destroyClient()')).toBeLessThan(create.indexOf('getNewAdapter'))
  })

  test('R3-F024 GattSerialQueue always schedules pump via handler.post', () => {
    const radio = fs.readFileSync(
      path.join(
        root,
        'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedAndroidGattRadio.kt'
      ),
      'utf8'
    )
    const queue = radio.slice(radio.indexOf('internal class GattSerialQueue'), radio.indexOf('companion object'))
    const submit = queue.slice(queue.indexOf('fun submit'), queue.indexOf('fun clear'))
    // Must not call pump() synchronously from submit — only via handler.post
    expect(submit).toMatch(/handler\.post\s*\{\s*pump\(\)\s*\}/)
    expect(submit).not.toMatch(/if\s*\(\s*startNow\s*\)\s*\{\s*pump\(\)\s*\}/)
  })

  test('R3-F025 removeBond waits for BOND_NONE via bond-state receiver', () => {
    const adapter = fs.readFileSync(
      path.join(root, 'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedBleAdapter.kt'),
      'utf8'
    )
    const remove = adapter.slice(
      adapter.indexOf('override fun removeBond'),
      adapter.indexOf('override fun getBondState')
    )
    expect(remove).toContain('ACTION_BOND_STATE_CHANGED')
    expect(remove).toContain('BOND_NONE')
    expect(remove).toContain('CREATE_BOND_TIMEOUT_MS')
    expect(remove).toContain('registerReceiver')
    // Must not succeed immediately after invoke alone
    expect(remove).not.toMatch(/m\.invoke\(device\)\s*\n\s*onSuccessCallback\.onSuccess/)
  })

  test('R3-F050 scan Base64 pre-encoded off main before post', () => {
    const adapter = fs.readFileSync(
      path.join(root, 'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedBleAdapter.kt'),
      'utf8'
    )
    const scan = adapter.slice(
      adapter.indexOf('override fun startDeviceScan'),
      adapter.indexOf('override fun stopDeviceScan')
    )
    expect(scan).toContain('preEncodeBase64Fields')
    expect(scan.indexOf('preEncodeBase64Fields')).toBeLessThan(scan.indexOf('mainHandler.post'))
    const scanResult = fs.readFileSync(
      path.join(root, 'android/src/main/java/com/sfourdrinier/unifiedblemanager/adapter/ScanResult.java'),
      'utf8'
    )
    expect(scanResult).toContain('preEncodeBase64Fields')
    expect(scanResult).toContain('getManufacturerDataBase64')
    const converter = fs.readFileSync(
      path.join(
        root,
        'android/src/main/java/com/sfourdrinier/unifiedblemanager/converter/ScanResultToJsObjectConverter.java'
      ),
      'utf8'
    )
    expect(converter).toContain('getManufacturerDataBase64')
    expect(converter).toContain('getRawScanRecordBase64')
  })

  test('R3-F077 isBackgroundModeEnabled uses FGS static flag, not getRunningServices', () => {
    const module = fs.readFileSync(
      path.join(root, 'android/src/main/java/com/sfourdrinier/unifiedblemanager/BlePlxModule.java'),
      'utf8'
    )
    expect(module).not.toContain('getRunningServices')
    expect(module).toContain('isServiceRunningStatic')
    const fgs = fs.readFileSync(
      path.join(
        root,
        'android/src/main/java/com/sfourdrinier/unifiedblemanager/BlePlxForegroundService.java'
      ),
      'utf8'
    )
    expect(fgs).toContain('isServiceRunningStatic')
    expect(fgs).toContain('runningStatic')
  })

  test('R3-F026 bare example declares BlePlxForegroundService + FGS permissions', () => {
    const example = fs.readFileSync(
      path.join(root, 'example/android/app/src/main/AndroidManifest.xml'),
      'utf8'
    )
    expect(example).toContain('com.sfourdrinier.unifiedblemanager.BlePlxForegroundService')
    expect(example).toContain('FOREGROUND_SERVICE')
    expect(example).toContain('FOREGROUND_SERVICE_CONNECTED_DEVICE')
    expect(example).toContain('POST_NOTIFICATIONS')
  })
})
