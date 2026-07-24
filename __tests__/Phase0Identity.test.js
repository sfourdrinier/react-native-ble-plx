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

  test('exports sketch includes web, electron, node', () => {
    expect(pkg.exports).toBeDefined()
    expect(pkg.exports['./web']).toBeDefined()
    expect(pkg.exports['./electron']).toBeDefined()
    expect(pkg.exports['./node']).toBeDefined()
    expect(pkg.exports['.']).toBeDefined()
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
    expect(buildGradle).toContain('namespace "com.sfourdrinier.unifiedblemanager"')
    expect(buildGradle).toContain('codegenJavaPackageName = "com.sfourdrinier.unifiedblemanager"')
    expect(pkg.codegenConfig.android.javaPackageName).toBe('com.sfourdrinier.unifiedblemanager')
    const moduleJava = path.join(
      root,
      'android/src/main/java/com/sfourdrinier/unifiedblemanager/BlePlxModule.java'
    )
    expect(fs.existsSync(moduleJava)).toBe(true)
  })

  test('Expo plugin entry exists (id follows package name at runtime)', () => {
    expect(appPlugin).toContain("require('./plugin/build/withBLE')")
    expect(pluginSrc).toContain('createRunOncePlugin(withBLE, pkg.name, pkg.version)')
    // package name drives plugin id
    expect(pkg.name).toBe('unified-ble-manager')
  })

  test('shim package is re-export only', () => {
    const shimPkg = JSON.parse(
      fs.readFileSync(path.join(root, 'packages/react-native-ble-plx-shim/package.json'), 'utf8')
    )
    expect(shimPkg.name).toBe('@sfourdrinier/react-native-ble-plx')
    expect(shimPkg.version).toBe(pkg.version)
    expect(shimPkg.dependencies['unified-ble-manager']).toMatch(/file:|\.\./)
    const shimIndex = fs.readFileSync(
      path.join(root, 'packages/react-native-ble-plx-shim/index.js'),
      'utf8'
    )
    expect(shimIndex).toMatch(/require\(['"]unified-ble-manager['"]\)|require\(['"]\.\.\/\.\.['"]\)/)
    // No native tree in shim
    expect(fs.existsSync(path.join(root, 'packages/react-native-ble-plx-shim/android'))).toBe(false)
    expect(fs.existsSync(path.join(root, 'packages/react-native-ble-plx-shim/ios'))).toBe(false)
  })

  test('MIGRATION_4.0.md leads with zero-change Base64 + rename steps', () => {
    const mig = fs.readFileSync(path.join(root, 'MIGRATION_4.0.md'), 'utf8')
    expect(mig).toMatch(/zero-change/i)
    expect(mig).toMatch(/Base64/)
    expect(mig).toContain('unified-ble-manager')
    expect(mig).toContain('unified-ble-manager/web')
    expect(mig).toContain('unified-ble-manager/electron')
    expect(mig).toContain('unified-ble-manager/node')
  })
})
