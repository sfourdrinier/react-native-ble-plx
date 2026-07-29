// __tests__/OwnedCore.structure.test.js

const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const androidRoot = path.join(
  root,
  'android/src/main/java/com/sfourdrinier/unifiedblemanager'
)

function javaAndKotlinFiles(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap(entry => {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) return javaAndKotlinFiles(entryPath)
      return entry.isFile() && /\.(?:java|kt)$/.test(entry.name)
        ? [path.relative(androidRoot, entryPath).split(path.sep).join('/')]
        : []
    })
    .sort()
}

describe('Unified Android native protocol structure', () => {
  test('keeps the protocol radio and generated control module as the only Android runtime boundary', () => {
    const dispatcher = fs.readFileSync(
      path.join(
        root,
        'android/src/main/java/com/sfourdrinier/unifiedblemanager/protocol/UnifiedBleProtocolAndroidDispatcher.kt'
      ),
      'utf8'
    )
    const radio = fs.readFileSync(
      path.join(
        root,
        'android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedAndroidGattRadio.kt'
      ),
      'utf8'
    )
    const buildGradle = fs.readFileSync(path.join(root, 'android/build.gradle'), 'utf8')

    expect(javaAndKotlinFiles(androidRoot)).toEqual([
      'BlePlxPackage.java',
      'protocol/ProtocolCommandDecoder.kt',
      'protocol/ProtocolWireEncoder.kt',
      'protocol/UnifiedBleProtocolAndroidDispatcher.kt',
      'protocol/UnifiedBleProtocolControlModule.java',
      'protocol/UnifiedBleProtocolJsiBinding.java',
      'protocol/generated/NativeProtocolV1Schema.kt',
      'radio/OwnedAndroidGattRadio.kt',
      'radio/OwnedAndroidLog.kt'
    ])
    expect(dispatcher).toContain('OwnedAndroidGattRadio')
    expect(dispatcher).not.toMatch(/com\.sfourdrinier\.unifiedblemanager\.(adapter|converter)|Base64|BlePlxModule/)
    expect(radio).toContain('fun readCharacteristicExact')
    expect(radio).toContain('fun writeCharacteristicExact')
    expect(radio).toContain('fun setNotifyExact')
    expect(radio).not.toMatch(/com\.sfourdrinier\.unifiedblemanager\.(adapter|converter)|Base64/)
    expect(buildGradle).not.toMatch(/rxandroidble|rxjava/i)
  })
})
