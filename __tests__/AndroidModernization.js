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

  test('does not expose newArchEnabled as an architecture switch', () => {
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
    expect(mainApplication).toContain('override val isNewArchEnabled: Boolean = true')
    expect(mainApplication).toContain('load()')
    expect(mainApplication).not.toContain('BuildConfig.IS_NEW_ARCHITECTURE_ENABLED')
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
