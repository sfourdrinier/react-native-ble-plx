/**
 * Optional codemod v0 fixture test — drives shipped transform-bytes-path.js.
 */
const fs = require('fs')
const path = require('path')
const { transformSource } = require('../scripts/codemod/transform-bytes-path')

const root = path.join(__dirname, '..')
const beforePath = path.join(root, 'scripts/codemod/fixtures/before-read.js')
const expectedPath = path.join(root, 'scripts/codemod/fixtures/after-read-expected.js')

describe('codemod transform-bytes-path (fixture-driven)', () => {
  test('rewrites readCharacteristicForDevice to AsBytes form', () => {
    const before = fs.readFileSync(beforePath, 'utf8')
    const expected = fs.readFileSync(expectedPath, 'utf8')
    const out = transformSource(before)
    expect(out).toContain('readCharacteristicForDeviceAsBytes')
    expect(out).not.toMatch(/readCharacteristicForDevice\s*\(/)
    // Expected fixture documents the same bytes-path call site
    expect(expected).toContain('readCharacteristicForDeviceAsBytes')
    expect(out).toContain('00002a37-0000-1000-8000-00805f9b34fb')
  })

  test('CLI --check exits 0 on before fixture', () => {
    const { spawnSync } = require('child_process')
    const r = spawnSync(
      process.execPath,
      [path.join(root, 'scripts/codemod/transform-bytes-path.js'), '--check', beforePath],
      { encoding: 'utf8' }
    )
    expect(r.status).toBe(0)
    expect(r.stdout + r.stderr).toMatch(/OK/)
  })
})
