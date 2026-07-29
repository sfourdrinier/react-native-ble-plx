// __tests__/native-protocol/AndroidDescriptorProtocolContract.test.js

const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '../..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('Android native protocol descriptor contract', () => {
  test('carries descriptor paths and owned bytes through the generated schema and Android dispatch boundary', () => {
    const schema = JSON.parse(read('native/protocol/schema/native-protocol-v1.json'))
    const records = new Map(schema.records.map(record => [record.name, record.fields.map(field => field[0])]))
    const androidBoundary = read('src/native-protocol/rn-android-boundary.ts')
    const androidDispatcher = read(
      'android/src/main/java/com/sfourdrinier/unifiedblemanager/protocol/UnifiedBleProtocolAndroidDispatcher.kt'
    )
    const androidBinding = read(
      'android/src/main/java/com/sfourdrinier/unifiedblemanager/protocol/UnifiedBleProtocolJsiBinding.java'
    )

    expect(schema.commandKinds).toEqual(expect.arrayContaining(['readDescriptor', 'writeDescriptor']))
    expect(schema.resultKinds).toEqual(expect.arrayContaining(['descriptorRead', 'descriptorWrite']))
    expect(records.get('result')).toEqual(expect.arrayContaining(['descriptorPath', 'binary']))
    expect(androidBoundary).toContain("this.dispatch('readDescriptor'")
    expect(androidBoundary).toContain("commandRecord(protocolVersion, 'writeDescriptor'")
    expect(androidBoundary).toContain('private descriptorPath(')
    expect(androidDispatcher).toContain('"readDescriptor" -> readDescriptor(command)')
    expect(androidDispatcher).toContain('"writeDescriptor" -> writeDescriptor(command)')
    expect(androidDispatcher).toContain('radio.readDescriptorExact(')
    expect(androidDispatcher).toContain('radio.writeDescriptorExact(')
    expect(androidBinding).toContain('emitDescriptorRead')
  })
})
