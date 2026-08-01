// __tests__/AndroidModernization.js

const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const androidJavaRoot = path.join(
  root,
  'android/src/main/java/com/sfourdrinier/unifiedblemanager'
)

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function sourceFilesBelow(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap(entry => {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        return sourceFilesBelow(entryPath)
      }
      return entry.isFile() && /\.(?:java|kt)$/.test(entry.name)
        ? [path.relative(androidJavaRoot, entryPath).split(path.sep).join('/')]
        : []
    })
    .sort()
}

describe('Android RN 0.86 unified protocol boundary', () => {
  test('uses Android API 36 defaults and the modern React Android artifact', () => {
    const gradleProperties = read('android/gradle.properties')
    const buildGradle = read('android/build.gradle')

    expect(gradleProperties).toContain('BlePlx_compileSdkVersion=36')
    expect(gradleProperties).toContain('BlePlx_targetSdkVersion=36')
    expect(buildGradle).toContain('implementation "com.facebook.react:react-android"')
    expect(buildGradle).toContain('apply plugin: "com.facebook.react"')
    expect(buildGradle).toContain('codegenJavaPackageName = "com.sfourdrinier.unifiedblemanager"')
    expect(buildGradle).not.toContain('com.facebook.react:react-native:+')
    expect(buildGradle).not.toContain('TurboReactPackage')
  })

  test('uses the current Android Gradle DSL without changing configured SDK semantics', () => {
    const buildGradle = read('android/build.gradle')

    expect(buildGradle).toContain('compileSdk getExtOrIntegerDefault("compileSdkVersion")')
    expect(buildGradle).toContain('minSdk getExtOrIntegerDefault("minSdkVersion")')
    expect(buildGradle).toContain('targetSdk getExtOrIntegerDefault("targetSdkVersion")')
    expect(buildGradle).toContain('lint {')
    expect(buildGradle).toContain('prefab = true')
    expect(buildGradle).not.toContain('compileSdkVersion getExtOrIntegerDefault')
    expect(buildGradle).not.toContain('minSdkVersion getExtOrIntegerDefault')
    expect(buildGradle).not.toContain('targetSdkVersion getExtOrIntegerDefault')
    expect(buildGradle).not.toContain('lintOptions {')
    expect(buildGradle).not.toContain('prefab true')
  })

  test('registers exactly the generated control-only TurboModule', () => {
    const packageJava = read('android/src/main/java/com/sfourdrinier/unifiedblemanager/BlePlxPackage.java')
    const controlJava = read(
      'android/src/main/java/com/sfourdrinier/unifiedblemanager/protocol/UnifiedBleProtocolControlModule.java'
    )
    const codegenConfig = JSON.parse(read('package.json')).codegenConfig

    expect(packageJava).toContain('import com.facebook.react.BaseReactPackage;')
    expect(packageJava).toContain('import com.sfourdrinier.unifiedblemanager.protocol.UnifiedBleProtocolControlModule;')
    expect(packageJava).toContain('if (UnifiedBleProtocolControlModule.NAME.equals(name))')
    expect(packageJava).toContain('UnifiedBleProtocolControlModule.class.getName()')
    expect(packageJava).not.toMatch(/\bBlePlxModule\b|\bNativeBlePlxSpec\b/)
    expect(packageJava.match(/moduleInfos\.put\(/g)).toHaveLength(1)
    expect(controlJava).toContain('extends NativeUnifiedBleProtocolControlSpec')
    expect(controlJava).toContain('public static final String NAME = "UnifiedBleProtocolControl"')
    expect(controlJava).toContain('UnifiedBleProtocolJsiBinding.install')
    expect(controlJava).not.toContain('Base64')
    expect(codegenConfig.jsSrcsDir).toBe('src')
  })

  test('ships only the current protocol source graph and no legacy Android bridge', () => {
    expect(sourceFilesBelow(androidJavaRoot)).toEqual([
      'BlePlxPackage.java',
      'protocol/ProtocolCommandDecoder.kt',
      'protocol/ProtocolWireEncoder.kt',
      'protocol/UnifiedBleProtocolAndroidDispatcher.kt',
      'protocol/UnifiedBleProtocolControlModule.java',
      'protocol/UnifiedBleProtocolJsiBinding.java',
      'protocol/generated/NativeProtocolV1Schema.kt',
      'radio/GattOccurrenceResolver.kt',
      'radio/OwnedAndroidLog.kt',
      'radio/OwnedAndroidGattRadio.kt'
    ].sort())
    const protocolDispatcher = read(
      'android/src/main/java/com/sfourdrinier/unifiedblemanager/protocol/UnifiedBleProtocolAndroidDispatcher.kt'
    )
    const radio = read('android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedAndroidGattRadio.kt')
    expect(protocolDispatcher).toContain('OwnedAndroidGattRadio')
    expect(protocolDispatcher).not.toMatch(/com\.sfourdrinier\.unifiedblemanager\.(adapter|converter)|Base64|BlePlxModule/)
    expect(radio).not.toMatch(/com\.sfourdrinier\.unifiedblemanager\.(adapter|converter)|Base64/)
  })

  test('does not declare a foreground service that the protocol does not own', () => {
    const manifests = [
      read('android/src/main/AndroidManifest.xml'),
      read('android/src/main/AndroidManifestNew.xml'),
      read('example/android/app/src/main/AndroidManifest.xml')
    ]
    const plugin = read('plugin/src/withBLE.ts')

    for (const manifest of manifests) {
      expect(manifest).not.toMatch(/BlePlxForegroundService|FOREGROUND_SERVICE|POST_NOTIFICATIONS/)
    }
    expect(plugin).not.toMatch(/androidEnableForegroundService|withBLEAndroidForegroundService/)
    expect(fs.existsSync(path.join(root, 'plugin/src/withBLEAndroidForegroundService.ts'))).toBe(false)
  })
})
