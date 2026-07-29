// __tests__/native-protocol/NativeProtocolV1.test.js

// __tests__/native-protocol/NativeProtocolV1.test.js

const childProcess = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const root = path.resolve(__dirname, '../..')
const schemaPath = path.join(root, 'native/protocol/schema/native-protocol-v1.json')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('Native Protocol v1 schema authority', () => {
  test('locks every record, enum, and field to an explicit immutable v1 ABI wire ID', () => {
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'))
    const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(schemaPath), schema.abiManifest), 'utf8'))
    expect(manifest.version).toBe(schema.abiVersion)
    expect(Object.keys(manifest.recordKinds)).toEqual(expect.arrayContaining(schema.recordKinds))
    for (const [name, values] of Object.entries(schema)) {
      if (name !== 'recordKinds' && name !== 'records' && Array.isArray(values)) {
        expect(Object.keys(manifest.enums[name])).toEqual(expect.arrayContaining(values))
      }
    }
    for (const record of schema.records) {
      const fieldIds = record.fields.map(([name]) => manifest.fields[record.name][name])
      expect(fieldIds.every(id => Number.isInteger(id) && id > 0 && id <= 65535)).toBe(true)
      expect(new Set(fieldIds).size).toBe(fieldIds.length)
    }
  })

  test('has deterministic generated C++, Android, Apple, TypeScript, and control Codegen bindings', () => {
    childProcess.execFileSync(process.execPath, ['scripts/native-protocol/generate-native-protocol.js', '--check'], {
      cwd: root,
      stdio: 'pipe'
    })
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'))
    const cpp = read('native/protocol/generated/NativeProtocolV1Schema.hpp')
    const kotlin = read(
      'android/src/main/java/com/sfourdrinier/unifiedblemanager/protocol/generated/NativeProtocolV1Schema.kt'
    )
    const swift = read('ios/Generated/NativeProtocolV1Schema.swift')
    const typescript = read('src/native-protocol/generated/native-protocol-v1-schema.ts')
    for (const kind of schema.recordKinds) {
      expect(cpp).toContain(`${kind} =`)
      expect(kotlin).toContain(kind.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase())
      expect(swift).toContain(`case ${kind} =`)
      expect(typescript).toContain(`'${kind}'`)
    }
    expect(cpp).not.toContain('Base64')
    expect(kotlin).not.toContain('Base64')
    expect(swift).not.toContain('Base64')
    expect(typescript).not.toContain('Base64')
  })

  test('generates RN 0.86 supported control-only Codegen shapes on Android and Apple', () => {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'unified-ble-native-codegen-'))
    try {
      childProcess.execFileSync(
        process.execPath,
        [
          'node_modules/react-native/scripts/generate-codegen-artifacts.js',
          '-p',
          '.',
          '-t',
          'all',
          '-o',
          output,
          '-s',
          'library',
          '-f'
        ],
        { cwd: root, stdio: 'pipe' }
      )
      const generatedFiles = listFiles(output)
      const androidSpec = generatedFiles.find(file => file.endsWith('NativeUnifiedBleProtocolControlSpec.java'))
      const appleHeader = generatedFiles.find(
        file => file.endsWith('BlePlxSpec.h') && file.includes(`${path.sep}ios${path.sep}`)
      )
      expect(androidSpec).toBeDefined()
      expect(appleHeader).toBeDefined()
      const android = fs.readFileSync(androidSpec, 'utf8')
      const apple = fs.readFileSync(appleHeader, 'utf8')
      const appleControlStart = apple.indexOf('namespace NativeUnifiedBleProtocolControl')
      const appleControlEnd = apple.indexOf('NS_ASSUME_NONNULL_END', appleControlStart)
      const appleControl = apple.slice(appleControlStart, appleControlEnd)
      expect(android).toContain('NativeUnifiedBleProtocolControlSpec')
      expect(android).toContain('handshake')
      expect(android).toContain('cancelOperation(ReadableMap correlation')
      expect(android).toContain('closeAttachment(ReadableMap attachment')
      expect(android).not.toMatch(/Uint8Array|ArrayBuffer|Base64/)
      expect(appleControlStart).toBeGreaterThanOrEqual(0)
      expect(appleControlEnd).toBeGreaterThan(appleControlStart)
      expect(appleControl).toContain('NativeUnifiedBleProtocolControlSpec')
      expect(appleControl).toContain('handshake')
      expect(appleControl).not.toMatch(/Uint8Array|ArrayBuffer|Base64/)
    } finally {
      fs.rmSync(output, { recursive: true, force: true })
    }
  })

  test('registers lifecycle-owned protocol control modules on Android and Apple', () => {
    const androidPackage = read('android/src/main/java/com/sfourdrinier/unifiedblemanager/BlePlxPackage.java')
    const androidControl = read(
      'android/src/main/java/com/sfourdrinier/unifiedblemanager/protocol/UnifiedBleProtocolControlModule.java'
    )
    const appleControl = read('ios/UnifiedBleProtocolControl.mm')
    const packageJson = JSON.parse(read('package.json'))
    expect(androidPackage).toContain('UnifiedBleProtocolControlModule.NAME')
    expect(androidControl).toContain('extends NativeUnifiedBleProtocolControlSpec')
    expect(androidControl).toContain('public synchronized void invalidate()')
    expect(appleControl).toMatch(
      /@interface\s+UnifiedBleProtocolControl\s*:\s*NSObject\s*<\s*NativeUnifiedBleProtocolControlSpec\s*,\s*RCTTurboModuleWithJSIBindings\s*>/
    )
    expect(appleControl).toContain('NativeUnifiedBleProtocolControlSpecJSI')
    expect(packageJson.codegenConfig.ios.modulesProvider).toEqual(
      expect.objectContaining({
        UnifiedBleProtocolControl: 'UnifiedBleProtocolControl'
      })
    )
  })

  test('installs the single native JSI binary runtime through metadata-only control', () => {
    const control = read('src/NativeUnifiedBleProtocolControl.ts')
    const androidControl = read(
      'android/src/main/java/com/sfourdrinier/unifiedblemanager/protocol/UnifiedBleProtocolControlModule.java'
    )
    const androidBinding = read(
      'android/src/main/java/com/sfourdrinier/unifiedblemanager/protocol/UnifiedBleProtocolJsiBinding.java'
    )
    const nativeBinding = read('android/src/main/jni/UnifiedBleProtocolJsiBinding.cpp')
    const runtime = read('native/protocol/src/NativeProtocolControlRuntime.cpp')

    expect(control).toContain('installExecutionRuntime')
    expect(androidControl).toContain('UnifiedBleProtocolJsiBinding.install')
    expect(androidBinding).toContain('RuntimeExecutor')
    expect(nativeBinding).toContain('retainUint8Array')
    expect(nativeBinding).toContain('submit')
    expect(nativeBinding).toContain('dispatchCommandToAndroid')
    expect(nativeBinding).toContain('__unifiedBleNativeProtocolV1')
    expect(runtime).toContain('retainUint8Array')
    expect(runtime).toContain('copyBinary')
    expect(runtime).toContain('releaseBinary')
    expect(runtime).toContain('registerCommand')
    expect(runtime).toContain('settleResult')
    expect(runtime).toContain('deliverUint8ArrayCopy')
    expect(nativeBinding).not.toMatch(/Base64/)
  })

  test('keeps Android JNI advertisement bytes and rejected command input under explicit native ownership', () => {
    const androidBinding = read('android/src/main/jni/UnifiedBleProtocolJsiBinding.cpp')
    const nativeRuntime = read('native/protocol/src/NativeProtocolControlRuntime.cpp')
    const androidBoundary = read('src/native-protocol/rn-android-boundary.ts')

    expect(androidBinding).toContain('void emitAdvertisementFromJava(')
    expect(androidBinding).toContain('activeRuntime->retainNativeBytes(')
    expect(androidBinding).toContain('rawRecord:androidBluetoothLe')
    expect(androidBoundary).toContain('const advertisementBytes = this.takeAdvertisementBytes(parsedAdvertisement)')
    expect(androidBoundary).toContain('advertisementFromRecord(parsedAdvertisement, advertisementBytes)')
    expect(androidBinding).toContain('activeRuntime->rejectCommandDispatch(command)')
    expect(nativeRuntime).toContain('bool NativeProtocolControlRuntime::rejectCommandDispatch(')
    expect(nativeRuntime).toContain('NativeOperationState::failed')
    expect(nativeRuntime).toContain('binaryTransport_->release(*inputBinary)')
    expect(nativeRuntime.indexOf('operations_->registerOperation(operation, cancellable);')).toBeLessThan(
      nativeRuntime.indexOf('binaryTransport_->copyForNative(')
    )
  })

  test('represents complete paths, rich advertisements, errors, cancellation, and restoration', () => {
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'))
    const records = new Map(schema.records.map(record => [record.name, record.fields.map(field => field[0])]))
    expect(records.get('characteristicPath')).toEqual(['service', 'characteristicUuid', 'characteristicOccurrence'])
    expect(records.get('descriptorPath')).toEqual(['characteristic', 'descriptorUuid', 'descriptorOccurrence'])
    expect(records.get('operationCorrelation')).toEqual(['attachment', 'dispatchEpoch', 'nonce'])
    expect(records.get('advertisement')).toEqual(
      expect.arrayContaining([
        'serviceUuids',
        'solicitedServiceUuids',
        'overflowServiceUuids',
        'serviceData',
        'manufacturerData',
        'rawRecord',
        'scanResponseRecord',
        'fieldProvenance'
      ])
    )
    expect(records.get('error')).toEqual(
      expect.arrayContaining(['androidGattStatus', 'coreBluetoothDomain', 'coreBluetoothCode', 'safeMetadata'])
    )
    expect(records.get('restorationAdoptionResult')).toEqual(
      expect.arrayContaining(['receiptId', 'outcome', 'records'])
    )
    expect(records.get('scanOptions')).toEqual(
      expect.arrayContaining(['serviceUuids', 'allowDuplicates', 'scanMode', 'callbackType', 'legacyScan'])
    )
    expect(records.get('databaseSnapshot')).toEqual(
      expect.arrayContaining(['databasePath', 'services', 'characteristics', 'descriptors'])
    )
    expect(records.get('adapterStateSnapshot')).toEqual(
      expect.arrayContaining(['availability', 'authorization', 'power', 'safeReason'])
    )
    expect(records.get('event')).toEqual(expect.arrayContaining(['adapterState']))
    expect(schema.adapterAvailability).toEqual(expect.arrayContaining(['available', 'unsupported', 'unknown']))
    expect(schema.adapterAuthorization).toEqual(expect.arrayContaining(['granted', 'denied', 'notDetermined']))
    expect(schema.adapterPower).toEqual(expect.arrayContaining(['on', 'off', 'resetting', 'unknown']))
    expect(records.get('command')).toEqual(expect.arrayContaining(['scanOptions', 'writeMode']))
    expect(records.get('result')).toEqual(expect.arrayContaining(['databaseSnapshot']))
    expect(schema.commandKinds).toEqual(expect.arrayContaining(['cancel', 'subscribe', 'unsubscribe']))
  })
})

function listFiles(directory) {
  const files = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...listFiles(entryPath))
    } else if (entry.isFile()) {
      files.push(entryPath)
    }
  }
  return files
}
