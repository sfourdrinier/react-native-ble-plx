// __tests__/CanonicalPackageAbsence.test.js

const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8')

describe('4.0 canonical package baseline', () => {
  test('does not retain scoped-package shim source or preparation helpers', () => {
    expect(fs.existsSync(path.join(root, 'packages/react-native-ble-plx-shim'))).toBe(false)
    expect(fs.existsSync(path.join(root, 'scripts/prepare-shim-pack.js'))).toBe(false)
    expect(fs.existsSync(path.join(root, 'scripts/prepare-shim-for-publish.js'))).toBe(false)
  })

  test('keeps release, package, test, and plugin paths canonical-only', () => {
    const activePaths = [
      '.github/workflows/publish.yml',
      'scripts/verify-release.sh',
      'scripts/ci/pack-install-smoke.js',
      'scripts/ci/verify-package-tarballs.js',
      'jest.config.js',
      'package.json',
      'plugin/src/withBLERestorationPodfile.ts',
      'README.md',
      'CLAUDE.md'
    ]

    for (const activePath of activePaths) {
      expect(read(activePath)).not.toContain('@sfourdrinier/react-native-ble-plx')
      expect(read(activePath)).not.toMatch(/prepare-shim|pack:shim|dual packages|canonical \+ shim/i)
    }
  })
})
