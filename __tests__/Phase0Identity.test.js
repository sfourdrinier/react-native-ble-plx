// __tests__/Phase0Identity.test.js

// __tests__/Phase0Identity.test.js

const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const podspecPath = path.join(root, 'unified-ble-manager.podspec')
const buildGradle = fs.readFileSync(path.join(root, 'android/build.gradle'), 'utf8')
const appPlugin = fs.readFileSync(path.join(root, 'app.plugin.js'), 'utf8')
const pluginSrc = fs.readFileSync(path.join(root, 'plugin/src/withBLE.ts'), 'utf8')

describe('Phase 0 product identity (unified-ble-manager)', () => {
  test('npm package name and 4.0.0-alpha version train', () => {
    expect(pkg.name).toBe('unified-ble-manager')
    expect(pkg.version).toMatch(/^4\.0\.0-alpha\./)
  })

  test('strict package exports isolate manager, backend authoring, and deterministic testing', () => {
    expect(Object.keys(pkg.exports).sort()).toEqual([
      '.',
      './app.plugin.js',
      './backend-sdk',
      './cli',
      './codecs',
      './electron/main',
      './electron/renderer',
      './node/bluez',
      './node/corebluetooth',
      './node/winrt',
      './package.json',
      './profiles/battery-service',
      './profiles/blood-pressure',
      './profiles/commands',
      './profiles/device-information',
      './profiles/health-thermometer',
      './profiles/heart-rate',
      './profiles/ieee-11073',
      './profiles/standard-commands',
      './react-native',
      './testing',
      './web'
    ])
    expect(pkg.exports['./web']).toBeDefined()
    expect(pkg.exports['./node/bluez']).toBeDefined()
    expect(pkg.exports['./node/winrt']).toBeDefined()
    expect(pkg.exports['./electron/renderer']).toBeDefined()
    expect(pkg.exports['./electron']).toBeUndefined()
    expect(pkg.exports['./node']).toBeUndefined()
  })

  test('podspec is unified-ble-manager with Restoration subspec and default_subspecs :none', () => {
    expect(fs.existsSync(podspecPath)).toBe(true)
    const pod = fs.readFileSync(podspecPath, 'utf8')
    expect(pod).toContain('s.name         = "unified-ble-manager"')
    expect(pod).toMatch(/s\.default_subspecs\s*=\s*:none/)
    expect(pod).toContain('subspec "Restoration"')
    expect(pod).toContain('unified-ble-manager/Restoration')
    // Not the old pod name as s.name
    expect(pod).not.toMatch(/s\.name\s*=\s*"react-native-ble-plx"/)
  })

  test('Android namespace and codegen package', () => {
    expect(buildGradle).toContain('namespace = "com.sfourdrinier.unifiedblemanager"')
    expect(buildGradle).toContain('codegenJavaPackageName = "com.sfourdrinier.unifiedblemanager"')
    expect(pkg.codegenConfig.android.javaPackageName).toBe('com.sfourdrinier.unifiedblemanager')
    const moduleJava = path.join(root, 'android/src/main/java/com/sfourdrinier/unifiedblemanager/BlePlxModule.java')
    expect(fs.existsSync(moduleJava)).toBe(true)
    const fgsJava = path.join(
      root,
      'android/src/main/java/com/sfourdrinier/unifiedblemanager/BlePlxForegroundService.java'
    )
    expect(fs.existsSync(fgsJava)).toBe(true)
  })

  test('Expo FGS plugin injects FQCN matching Android namespace (not legacy com.bleplx)', () => {
    const fgsSrc = fs.readFileSync(path.join(root, 'plugin/src/withBLEAndroidForegroundService.ts'), 'utf8')
    // Primary constant must use locked namespace
    expect(fgsSrc).toMatch(
      /BLE_PLX_FOREGROUND_SERVICE_NAME\s*=\s*\n?\s*['"]com\.sfourdrinier\.unifiedblemanager\.BlePlxForegroundService['"]/
    )
    // When declaring a new service, android:name must use the constant (not hard-coded com.bleplx)
    expect(fgsSrc).toContain("'android:name': BLE_PLX_FOREGROUND_SERVICE_NAME")
    // Built plugin output must stay in sync (consumers load plugin/build)
    const fgsBuild = fs.readFileSync(path.join(root, 'plugin/build/withBLEAndroidForegroundService.js'), 'utf8')
    expect(fgsBuild).toContain('com.sfourdrinier.unifiedblemanager.BlePlxForegroundService')
    // Must not still be the only/default inject target
    expect(fgsBuild).not.toMatch(/serviceName\s*=\s*['"]com\.bleplx\.BlePlxForegroundService['"]/)
    expect(fgsBuild).not.toMatch(/BLE_PLX_FOREGROUND_SERVICE_NAME\s*=\s*['"]com\.bleplx\.BlePlxForegroundService['"]/)
  })

  test('Expo plugin entry exists (id follows package name at runtime)', () => {
    expect(appPlugin).toContain("require('./plugin/build/withBLE')")
    expect(pluginSrc).toContain('createRunOncePlugin(withBLE, pkg.name, pkg.version)')
    // package name drives plugin id
    expect(pkg.name).toBe('unified-ble-manager')
  })

  test('MIGRATION_4.0.md records the clean-baseline migration boundary', () => {
    const mig = fs.readFileSync(path.join(root, 'MIGRATION_4.0.md'), 'utf8')
    expect(mig).toContain('no released 4.0 API instructions yet')
    expect(mig).toContain('not a source-compatible rename')
    expect(mig).toMatch(/Base64/)
    expect(mig).toContain('unified-ble-manager')
    expect(mig).toContain('UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md')
    expect(mig).toContain('Base64 only as an explicit codec helper')
    expect(mig).not.toMatch(/zero-change (JS )?API/i)
  })
})
