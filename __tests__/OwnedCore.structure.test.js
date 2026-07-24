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
})
