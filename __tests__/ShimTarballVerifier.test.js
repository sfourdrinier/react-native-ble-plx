// __tests__/ShimTarballVerifier.test.js

const fs = require('fs')
const path = require('path')
const {
  expectedShimArchiveEntries,
  assertExactShimArchiveEntries,
  assertExactShimManifest
} = require('../scripts/ci/verify-package-tarballs')

const canonicalVersion = '4.0.0-alpha.8'

function exactShimManifest() {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../packages/react-native-ble-plx-shim/package.json'), 'utf8')
  )
  manifest.version = canonicalVersion
  manifest.dependencies['unified-ble-manager'] = canonicalVersion
  return manifest
}

describe('shim tarball exact archive allowlist', () => {
  test('accepts exactly the source-derived permitted shim files', () => {
    const expected = expectedShimArchiveEntries()

    expect(() =>
      assertExactShimArchiveEntries(new Map([...expected].map(entry => [entry, Buffer.alloc(0)])))
    ).not.toThrow()
  })

  test('rejects a legacy proxy even when every required entry is present', () => {
    const expected = expectedShimArchiveEntries()
    const files = new Map([...expected].map(entry => [entry, Buffer.alloc(0)]))
    files.set('package/web.js', Buffer.from('module.exports = {}'))

    expect(() => assertExactShimArchiveEntries(files)).toThrow('Unexpected: package/web.js')
  })

  test('rejects a missing permitted runtime entry', () => {
    const expected = expectedShimArchiveEntries()
    const files = new Map([...expected].map(entry => [entry, Buffer.alloc(0)]))
    files.delete('package/index.js')

    expect(() => assertExactShimArchiveEntries(files)).toThrow('Missing: package/index.js')
  })
})

describe('shim tarball exact manifest surface', () => {
  test('accepts the exact transitional package entrypoints', () => {
    expect(() => assertExactShimManifest(exactShimManifest(), canonicalVersion)).not.toThrow()
  })

  test('rejects an unauthorized export alias', () => {
    const manifest = exactShimManifest()
    manifest.exports['./web'] = './index.js'

    expect(() => assertExactShimManifest(manifest, canonicalVersion)).toThrow(
      'Packed shim exports must have exactly these keys'
    )
  })

  test.each([
    [
      'missing root condition',
      manifest => {
        delete manifest.exports['.']['react-native']
      },
      'Packed shim root export must have exactly these keys'
    ],
    [
      'redirected root target',
      manifest => {
        manifest.exports['.'].default = './app.plugin.js'
      },
      'Packed shim root export default must equal ./index.js'
    ],
    [
      'redirected react-native entrypoint',
      manifest => {
        manifest['react-native'] = 'app.plugin.js'
      },
      'Packed shim react-native must equal index.js'
    ]
  ])('rejects a %s', (_label, mutate, message) => {
    const manifest = exactShimManifest()
    mutate(manifest)

    expect(() => assertExactShimManifest(manifest, canonicalVersion)).toThrow(message)
  })
})
