// __tests__/GeneratedPlatformSupport.test.js

const childProcess = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const generatedPath = path.join(root, 'docs/generated/PLATFORM_SUPPORT.md')

describe('generated platform support evidence', () => {
  test('is regenerated from validated evidence manifests and is current', () => {
    expect(() =>
      childProcess.execFileSync(process.execPath, ['scripts/docs/generate-platform-support.js', '--check'], {
        cwd: root,
        encoding: 'utf8',
        stdio: 'pipe'
      })
    ).not.toThrow()

    const generated = fs.readFileSync(generatedPath, 'utf8')
    expect(generated).toContain('unified-ble-manager@4.0.0-alpha.30')
    expect(generated).toContain('No evidence record is bound to this exact package version and artifact')
    expect(generated).toContain('reported-unverified-linux-bluez-live')
    expect(generated).toContain('reported-unverified-macos-corebluetooth-live')
    expect(generated).toContain('local-macos-corebluetooth-baseline')
    expect(generated).toContain('Experimental')
    expect(generated).toContain('L0')
    expect(generated).toContain('blocked')
    expect(generated).not.toContain('| Platform | Supported |')
  })
})
