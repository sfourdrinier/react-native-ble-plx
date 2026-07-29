// __tests__/LegacyArchitectureAbsence.test.js

const fs = require('fs')
const path = require('path')

const rootDirectory = path.join(__dirname, '..')

const retiredSourcePaths = Object.freeze([
  'src/BleError.ts',
  'src/BleManager.ts',
  'src/BleModule.ts',
  'src/Characteristic.ts',
  'src/ConnectionManager.ts',
  'src/Descriptor.ts',
  'src/Device.ts',
  'src/DeviceOperationQueue.ts',
  'src/NativeBlePlx.ts',
  'src/Service.ts',
  'src/TypeDefinition.ts',
  'src/Utils.ts',
  'src/discovery/index.ts',
  'src/encoding.ts',
  'src/helpers/index.ts',
  'src/hosts/electron.ts',
  'src/longWrite.ts',
  'src/permissions.ts',
  'src/port/PortBleManager.ts',
  'src/profiles/battery.ts',
  'src/profiles/bloodPressure.ts',
  'src/profiles/deviceInformation.ts',
  'src/profiles/healthThermometer.ts',
  'src/profiles/heartRate.ts',
  'src/profiles/ieee11073.ts',
  'src/profiles/index.ts',
  'src/profiles/serviceHelpers.ts',
  'src/profiles/types.ts',
  'src/stringUtils.ts',
  'src/supports.ts',
  'src/unsupported.ts'
])

const retiredExampleAndBenchmarkPaths = Object.freeze([
  'example-electron/deviceIdGuard.js',
  'example-electron/live-polar.js',
  'example-electron/main.js',
  'example-electron/preload.js',
  'example-web/centralDemo.mjs',
  'example-web/heartRate.mjs',
  'example-web/index.html',
  'example-web/main.js',
  'example-web/vite.config.js',
  'example-shared/centralDemo.js',
  'example-shared/centralDemo.mjs',
  'example-shared/heartRate.js',
  'example-shared/heartRate.mjs',
  'example-shared/profiles.js',
  'example-shared/profiles.mjs',
  'example-shared/readCommonProfiles.js',
  'example-shared/ui/app.js',
  'example-shared/ui/boot.js',
  'example-shared/ui/createWebBleBridge.js',
  'example-shared/ui/index.html',
  'benchmarks/scripts/ub4-perf-baseline.js',
  'benchmarks/scripts/validate-ub4-perf-baseline.js',
  'benchmarks/tests/ub4-perf-baseline.test.js'
])

describe('retired 3.x architecture absence', () => {
  test('ships no legacy manager, port, host matrix, wrapper, or Base64 source', () => {
    const remainingPaths = retiredSourcePaths.filter(relativePath => fs.existsSync(path.join(rootDirectory, relativePath)))

    expect(remainingPaths).toEqual([])
  })

  test('keeps native CoreBluetooth on the contract boundary only', () => {
    const coreBluetoothBoundarySource = fs.readFileSync(
      path.join(rootDirectory, 'native/electron/corebluetooth/index.js'),
      'utf8'
    )

    expect(fs.existsSync(path.join(rootDirectory, 'native/electron/bluez/index.js'))).toBe(false)
    expect(coreBluetoothBoundarySource).toContain('createContractBoundary')
    expect(coreBluetoothBoundarySource).not.toContain('createPort')
    expect(coreBluetoothBoundarySource).not.toContain('wrapAsBlePort')
    expect(coreBluetoothBoundarySource).not.toContain('Base64')
  })

  test('ships no retired example, UI bridge, or benchmark architecture', () => {
    const remainingPaths = retiredExampleAndBenchmarkPaths.filter(relativePath =>
      fs.existsSync(path.join(rootDirectory, relativePath))
    )

    expect(remainingPaths).toEqual([])
  })

  test('documents Electron only through the retained deterministic 4.0 smoke contract', () => {
    const electronReadme = fs.readFileSync(path.join(rootDirectory, 'example-electron/README.md'), 'utf8')

    expect(electronReadme).toContain('example-electron/smoke.js')
    expect(electronReadme).not.toContain('createCoreBluetoothBlePort')
    expect(electronReadme).not.toContain('example-electron/main.js')
    expect(electronReadme).not.toContain('example-shared/ui/')
  })
})
