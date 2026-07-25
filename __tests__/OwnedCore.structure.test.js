/**
 * Structural + factory evidence that owned radio is the default product path.
 * Drives real source files / package config (no re-implementation).
 */
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')

describe('Owned native core (4.0 GA default path)', () => {
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
    // serviceID lookup must compare dictionary value to the service parameter
    expect(src).toMatch(/serviceIds\.first\(where:\s*\{\s*\$0\.value\s*===\s*svc\s*\}/)
    expect(src).not.toMatch(/\$0\.value\s*===\s*\$0/)
  })
})
