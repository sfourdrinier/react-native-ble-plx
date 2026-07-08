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
    const moduleJava = read('android/src/main/java/com/bleplx/BlePlxModule.java')
    const packageJava = read('android/src/main/java/com/bleplx/BlePlxPackage.java')
    const adapterJava = read('android/src/main/java/com/bleplx/adapter/BleModule.java')

    expect(moduleJava).toContain('import com.bleplx.NativeBlePlxSpec;')
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

    expect(adapterJava).not.toContain('ReactContextBaseJavaModule')
    expect(adapterJava).toContain('public class BleModule implements BleAdapter')
    expect(adapterJava).not.toContain('public void invalidate()')
    expect(adapterJava).not.toContain('BluetoothAdapter.ACTION_REQUEST_ENABLE')
    expect(adapterJava).not.toContain('bluetoothAdapter.enable()')
    expect(adapterJava).not.toContain('bluetoothAdapter.disable()')
  })

  test('treats missing newArchEnabled as enabled for React Native 0.82+', () => {
    const buildGradle = read('android/build.gradle')

    expect(buildGradle).toContain('if (!rootProject.hasProperty("newArchEnabled")) {')
    expect(buildGradle).toContain('return true')
    expect(buildGradle).toContain('newArchEnabled=false is ignored')
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
    const safePromise = read('android/src/main/java/com/bleplx/utils/SafePromise.java')

    expect(safePromise).not.toContain('@Deprecated')
    expect(safePromise).not.toContain('public void reject(String message)')
  })

  test('keeps Android promise rejection paths null-safe', () => {
    const safePromise = read('android/src/main/java/com/bleplx/utils/SafePromise.java')
    const errorDefaults = read('android/src/main/java/com/bleplx/utils/ErrorDefaults.java')

    expect(errorDefaults).toContain('public static final String CODE')
    expect(errorDefaults).toContain('public static final String MESSAGE')
    expect(safePromise).toContain('ErrorDefaults.CODE')
    expect(safePromise).toContain('ErrorDefaults.MESSAGE')
    expect(safePromise).toContain('code == null')
    expect(safePromise).toContain('message == null')
  })

  test('keeps custom GATT refresh operation typed for javac', () => {
    const refreshGattOperation = read('android/src/main/java/com/bleplx/adapter/utils/RefreshGattCustomOperation.java')

    expect(refreshGattOperation).toContain('Observable.amb(')
    expect(refreshGattOperation).toContain('Arrays.asList(')
    expect(refreshGattOperation).not.toContain('Observable.ambArray(')
    expect(refreshGattOperation).toContain('rxBleGattCallback.<Boolean>observeDisconnect()')
    expect(refreshGattOperation).not.toContain('@noinspection unchecked')
  })
})
