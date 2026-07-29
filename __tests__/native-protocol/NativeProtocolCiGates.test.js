// __tests__/native-protocol/NativeProtocolCiGates.test.js

const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '../..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/\r\n/g, '\n')
}

describe('Native Protocol executable CI gates', () => {
  test('exposes package-owned Android and Apple native protocol test scripts', () => {
    const packageJson = JSON.parse(read('package.json'))

    expect(packageJson.scripts['test:native-protocol:android']).toBe(
      "cd example/android && ./gradlew :unified-ble-manager:testDebugUnitTest --tests 'com.sfourdrinier.unifiedblemanager.protocol.UnifiedBleProtocolAndroidDispatcher*' --no-daemon --console=plain"
    )
    expect(packageJson.scripts['test:native-protocol:apple']).toBe(
      'node scripts/native-protocol/test-apple-native-protocol.js'
    )
  })

  test('runs dispatcher JVM tests before the classic Android assembly gate without claiming radio coverage', () => {
    const ci = read('.github/workflows/ci.yml')
    const testStep = ci.indexOf('Execute Android Native Protocol dispatcher JVM tests (JVM; no physical BLE radio)')
    const assembleStep = ci.indexOf('Assemble classic example debug APK')

    expect(testStep).toBeGreaterThan(-1)
    expect(assembleStep).toBeGreaterThan(testStep)
    expect(ci).toContain('pnpm test:native-protocol:android')
    expect(ci).toContain("- 'native/protocol/**'")
    expect(ci).not.toContain('Android Native Protocol dispatcher physical radio test')
  })

  test('runs the Apple executable harness alongside the C++ native protocol host tests without claiming radio coverage', () => {
    const ci = read('.github/workflows/ci.yml')
    const apple = read('.github/workflows/apple-ci.yml')
    const script = read('scripts/native-protocol/test-apple-native-protocol.js')

    expect(ci).toContain('Execute Native Protocol C++ host tests (L2; no physical radio)')
    expect(ci).toContain('pnpm test:native-protocol')
    expect(apple).toContain('Execute Apple Native Protocol executable harness (L2 host; no physical BLE radio)')
    expect(apple).toContain('pnpm test:native-protocol:apple')
    expect(script).toContain(
      "run(process.execPath, [path.join(root, 'scripts/native-protocol/test-native-protocol.js')])"
    )
    expect(script).toContain("'swiftc'")
    expect(script).toContain('AppleCoreBluetoothScanParserHarness.swift')
    expect(script).toContain('No physical BLE radio or peripheral behavior was exercised.')
  })
})
