// __tests__/AndroidModernization.js

const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('Android modernization defaults', () => {
  test('uses Android API 36 defaults required by the React Native 0.86 / Expo SDK 57 line', () => {
    const gradleProperties = read('android/gradle.properties')

    expect(gradleProperties).toContain('BlePlx_compileSdkVersion=36')
    expect(gradleProperties).toContain('BlePlx_targetSdkVersion=36')
  })

  test('depends on the modern React Android artifact', () => {
    const buildGradle = read('android/build.gradle')

    expect(buildGradle).toContain('implementation "com.facebook.react:react-android"')
    expect(buildGradle).not.toContain('com.facebook.react:react-native:+')
  })

  test('implements the generated TurboModule spec and registers through BaseReactPackage', () => {
    const moduleJava = read('android/src/main/java/com/sfourdrinier/unifiedblemanager/BlePlxModule.java')
    const packageJava = read('android/src/main/java/com/sfourdrinier/unifiedblemanager/BlePlxPackage.java')
    const ownedAdapter = read(
      'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedBleAdapter.kt'
    )
    const factory = read(
      'android/src/main/java/com/sfourdrinier/unifiedblemanager/adapter/BleAdapterFactory.java'
    )

    expect(moduleJava).toContain('import com.sfourdrinier.unifiedblemanager.NativeBlePlxSpec;')
    expect(moduleJava).toContain('public class BlePlxModule extends NativeBlePlxSpec')
    expect(moduleJava).not.toContain('extends ReactContextBaseJavaModule')

    expect(packageJava).toContain('import com.facebook.react.BaseReactPackage;')
    expect(packageJava).not.toContain('TurboReactPackage')
    expect(packageJava).toContain('import com.facebook.react.module.model.ReactModuleInfo;')
    expect(packageJava).toContain('import com.facebook.react.module.model.ReactModuleInfoProvider;')
    expect(packageJava).toContain('public class BlePlxPackage extends BaseReactPackage')
    expect(packageJava).toContain('public NativeModule getModule(String name, ReactApplicationContext reactContext)')
    expect(packageJava).toContain('public ReactModuleInfoProvider getReactModuleInfoProvider()')
    expect(packageJava).not.toContain('implements ReactPackage')

    // 4.0 GA: owned Kotlin adapter is the default BleAdapter
    expect(factory).toContain('OwnedBleAdapter')
    expect(ownedAdapter).toContain('class OwnedBleAdapter')
    expect(ownedAdapter).toContain('OwnedAndroidGattRadio')
    expect(ownedAdapter).not.toContain('RxBleClient')
  })

  test('uses the direct RN 0.86 ReactHost bootstrap without a legacy host compatibility path', () => {
    const buildGradle = read('android/build.gradle')
    const exampleGradleProperties = read('example/android/gradle.properties')
    const mainApplication = read('example/android/app/src/main/java/com/bleplxexample/MainApplication.kt')

    expect(buildGradle).toContain('apply plugin: "com.facebook.react"')
    expect(buildGradle).toContain('buildConfigField "boolean", "IS_NEW_ARCHITECTURE_ENABLED", "true"')
    expect(buildGradle).toContain('react {')
    expect(buildGradle).toContain('codegenJavaPackageName = "com.sfourdrinier.unifiedblemanager"')
    expect(buildGradle).not.toContain('isNewArchitectureEnabled')
    expect(buildGradle).not.toContain('newArchEnabled')
    expect(exampleGradleProperties).not.toContain('newArchEnabled')
    expect(mainApplication).toContain('private val packages: List<ReactPackage> =')
    expect(mainApplication).toContain('PackageList(this).packages.apply')
    expect(mainApplication).toContain('add(Ub4JsiBinaryBootstrapPackage())')
    expect(mainApplication).toMatch(/getDefaultReactHost\(\s*applicationContext,\s*packages,/)
    expect(mainApplication).toContain('load()')
    expect(mainApplication).not.toContain('ReactNativeHost')
    expect(mainApplication).not.toContain('DefaultReactNativeHost')
    expect(mainApplication).not.toContain('isNewArchEnabled')
    expect(mainApplication).not.toContain('isHermesEnabled')
    expect(mainApplication).not.toContain('BuildConfig.IS_NEW_ARCHITECTURE_ENABLED')
  })

  test('declares the RN 0.86 Java 17 toolchain resolver for clean Gradle builds', () => {
    const settingsGradle = read('example/android/settings.gradle')
    const gradleProperties = read('example/android/gradle.properties')

    expect(settingsGradle).toMatch(
      /id\(["']org\.gradle\.toolchains\.foojay-resolver-convention["']\)\.version\(["']1\.0\.0["']\)/
    )
    expect(gradleProperties).not.toContain('org.gradle.java.installations.auto-download=false')
  })

  test('keeps Android 13+ GATT values and notification state in owned models', () => {
    const characteristic = read(
      'android/src/main/java/com/sfourdrinier/unifiedblemanager/adapter/Characteristic.java'
    )
    const descriptor = read('android/src/main/java/com/sfourdrinier/unifiedblemanager/adapter/Descriptor.java')
    const descriptorConverter = read(
      'android/src/main/java/com/sfourdrinier/unifiedblemanager/converter/DescriptorToJsObjectConverter.java'
    )
    const radio = read(
      'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedAndroidGattRadio.kt'
    )
    const adapter = read(
      'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedBleAdapter.kt'
    )

    expect(characteristic).toContain('private volatile boolean notifying = false;')
    expect(characteristic).toContain('public void setNotifying(boolean notifying)')
    expect(characteristic).not.toContain('descriptor.getValue()')
    expect(characteristic).not.toContain('gattCharacteristic.getValue()')
    expect(descriptor).not.toContain('descriptor.getValue()')
    expect(descriptor).not.toContain('setValueFromCache')
    expect(descriptorConverter).not.toContain('setValueFromCache')
    expect(radio).not.toContain('pendingDescValues')
    expect(radio).not.toContain('descriptor.value = stashed')
    expect(adapter).toContain('entry.model.setNotifying(true)')
    expect(adapter).toContain('entry.model.setNotifying(false)')
  })

  test('does not use deprecated Android metadata or foreground-service APIs', () => {
    const debugLogging = read(
      'android/src/main/java/com/sfourdrinier/unifiedblemanager/utils/BlePlxDebugLogging.java'
    )
    const foregroundService = read(
      'android/src/main/java/com/sfourdrinier/unifiedblemanager/BlePlxForegroundService.java'
    )

    expect(debugLogging).not.toContain('metaData.get(META_DATA_NAME)')
    expect(debugLogging).toContain('OwnedAndroidLog.e("BlePlxDebugLogging metadata lookup", exception)')
    expect(foregroundService).not.toContain('stopForeground(true)')
    expect(foregroundService).toContain('stopForeground(STOP_FOREGROUND_REMOVE)')
  })

  test('README documents the Android API floors used by the library', () => {
    const readme = read('README.md')

    expect(readme).toContain('min SDK version is at least 24')
    expect(readme).toContain('minSdkVersion = 24')
    expect(readme).toContain('| Android 14+ (API 34+) | 24 | 36 |')
    expect(readme).not.toContain('min SDK version is at least 23')
    expect(readme).not.toContain('minSdkVersion = 23')
    expect(readme).not.toContain('| Android 14+ (API 34+) | 24 | 34 |')
  })

  test('does not preserve deprecated Java promise overloads', () => {
    const safePromise = read('android/src/main/java/com/sfourdrinier/unifiedblemanager/utils/SafePromise.java')

    expect(safePromise).not.toContain('@Deprecated')
    expect(safePromise).not.toContain('public void reject(String message)')
  })

  test('exports ServicesChangedEvent in TurboModule constants (R2-F032)', () => {
    const moduleJava = read('android/src/main/java/com/sfourdrinier/unifiedblemanager/BlePlxModule.java')
    expect(moduleJava).toMatch(
      /getTypedExportedConstants[\s\S]*ServicesChangedEvent[\s\S]*return constants/
    )
  })

  test('FGS stack includes POST_NOTIFICATIONS for Android 13+ (R2-F031 / R3-F002)', () => {
    // Active AGP 8 manifest path (build.gradle sourceSets → AndroidManifestNew.xml)
    const manifestNew = read('android/src/main/AndroidManifestNew.xml')
    expect(manifestNew).toContain('android.permission.POST_NOTIFICATIONS')
    expect(manifestNew).toContain('BlePlxForegroundService')
    expect(manifestNew).toContain('BLUETOOTH_CONNECT')
    expect(manifestNew).toContain('FOREGROUND_SERVICE_CONNECTED_DEVICE')
    const manifest = read('android/src/main/AndroidManifest.xml')
    expect(manifest).toContain('android.permission.POST_NOTIFICATIONS')
    const fgsPlugin = read('plugin/src/withBLEAndroidForegroundService.ts')
    expect(fgsPlugin).toContain('POST_NOTIFICATIONS')
    // build.gradle still points AGP-namespace builds at the New manifest
    const buildGradle = read('android/build.gradle')
    expect(buildGradle).toContain('AndroidManifestNew.xml')
  })

  test('R3-F026 example AndroidManifest declares library FGS FQCN', () => {
    const example = read('example/android/app/src/main/AndroidManifest.xml')
    expect(example).toContain('com.sfourdrinier.unifiedblemanager.BlePlxForegroundService')
    expect(example).toContain('POST_NOTIFICATIONS')
  })

  test('R3-F077 module does not call getRunningServices', () => {
    const moduleJava = read('android/src/main/java/com/sfourdrinier/unifiedblemanager/BlePlxModule.java')
    expect(moduleJava).not.toContain('getRunningServices')
    expect(moduleJava).toContain('isServiceRunningStatic')
  })

  test('keeps Android promise rejection paths null-safe', () => {
    const safePromise = read('android/src/main/java/com/sfourdrinier/unifiedblemanager/utils/SafePromise.java')
    const errorDefaults = read('android/src/main/java/com/sfourdrinier/unifiedblemanager/utils/ErrorDefaults.java')

    expect(errorDefaults).toContain('public static final String CODE')
    expect(errorDefaults).toContain('public static final String MESSAGE')
    expect(errorDefaults).toContain('public static final String MESSAGE = "Unknown error"')
    expect(safePromise).toContain('ErrorDefaults.CODE')
    expect(safePromise).toContain('ErrorDefaults.MESSAGE')
    expect(safePromise).toContain('code == null')
    expect(safePromise).toContain('message == null')
  })

  test('legacy Rx GATT refresh op is off the default source set', () => {
    const legacyRefresh = path.join(
      root,
      'android/src/legacy/java/com/sfourdrinier/unifiedblemanager/adapter/utils/RefreshGattCustomOperation.java'
    )
    const mainRefresh = path.join(
      root,
      'android/src/main/java/com/sfourdrinier/unifiedblemanager/adapter/utils/RefreshGattCustomOperation.java'
    )
    expect(fs.existsSync(mainRefresh)).toBe(false)
    // May exist under legacy archaeology tree
    if (fs.existsSync(legacyRefresh)) {
      const refreshGattOperation = fs.readFileSync(legacyRefresh, 'utf8')
      expect(refreshGattOperation).toContain('RxBleCustomOperation')
    }
  })
})
