// __tests__/ReactNativePackedArtifacts.test.js

const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')

describe('packed React Native host artifacts', () => {
  test('declares and verifies the source tree required by React Native Codegen', () => {
    const packageJson = require(path.join(root, 'package.json'))
    const tarballVerifierPath = path.join(root, 'scripts', 'ci', 'verify-package-tarballs.js')
    const tarballVerifier = fs.readFileSync(tarballVerifierPath, 'utf8')

    expect(packageJson.codegenConfig.jsSrcsDir).toBe('src')
    expect(packageJson.files).toContain('src')
    expect(fs.existsSync(path.join(root, 'src', 'NativeUnifiedBleProtocolControl.ts'))).toBe(true)
    expect(tarballVerifier).toContain('expectedCodegenSourceEntries')
    expect(tarballVerifier).toContain('Packed React Native Codegen source set differs')
  })

  test('includes the generated protocol control required by Metro from the public host entrypoint', () => {
    const publicEntryPath = path.join(root, 'lib', 'module', 'react-native.js')
    const controlPath = path.join(root, 'lib', 'module', 'NativeUnifiedBleProtocolControl.js')
    const publicEntry = fs.readFileSync(publicEntryPath, 'utf8')

    expect(publicEntry).toContain("require('./NativeUnifiedBleProtocolControl')")
    expect(fs.existsSync(controlPath)).toBe(true)
  })
})
