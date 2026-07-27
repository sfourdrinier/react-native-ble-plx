// __tests__/CodemodBytesPath.test.js

/**
 * Optional EXPERIMENTAL codemod fixture tests — drives transform-bytes-path.js.
 * Not required for 4.0 upgrade (Base64 path remains default).
 * Monorepo-only: scripts/ is not published on npm.
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  transformSource,
  transformSourceWithReport,
  analyzeReadCalls,
  REVIEW_MARKER
} = require('../scripts/codemod/transform-bytes-path')

const root = path.join(__dirname, '..')
const beforePath = path.join(root, 'scripts/codemod/fixtures/before-read.js')
const expectedPath = path.join(root, 'scripts/codemod/fixtures/after-read-expected.js')
const beforeSafePath = path.join(root, 'scripts/codemod/fixtures/before-read-safe.js')
const expectedSafePath = path.join(root, 'scripts/codemod/fixtures/after-read-safe-expected.js')
const beforeMixedPath = path.join(root, 'scripts/codemod/fixtures/before-read-mixed.js')
const expectedMixedPath = path.join(root, 'scripts/codemod/fixtures/after-read-mixed-expected.js')

describe('codemod transform-bytes-path (fixture-driven, F018/F055/F044/F099)', () => {
  test('safe mode does not rename when .value is returned (Base64 consumer)', () => {
    const before = fs.readFileSync(beforePath, 'utf8')
    const expected = fs.readFileSync(expectedPath, 'utf8')
    const { out, report } = transformSourceWithReport(before)
    expect(out).toContain(REVIEW_MARKER)
    expect(out).toContain('readCharacteristicForDevice(')
    expect(out).not.toContain('readCharacteristicForDeviceAsBytes(')
    expect(report.skipped).toBeGreaterThan(0)
    expect(report.rewritten).toBe(0)
    // Expected fixture documents the skip + review marker approach
    expect(expected).toContain(REVIEW_MARKER)
    expect(expected).not.toContain('readCharacteristicForDeviceAsBytes')
  })

  test('safe mode rewrites when .value is not consumed as Base64', () => {
    const before = fs.readFileSync(beforeSafePath, 'utf8')
    const expected = fs.readFileSync(expectedSafePath, 'utf8')
    const out = transformSource(before)
    expect(out).toContain('readCharacteristicForDeviceAsBytes(')
    expect(out).not.toMatch(/readCharacteristicForDevice\s*\(/)
    expect(out.trim()).toBe(expected.trim())
  })

  test('mixed file: selective rewrite — Base64-return skipped, uuid-only rewritten (F099)', () => {
    const before = fs.readFileSync(beforeMixedPath, 'utf8')
    const expected = fs.readFileSync(expectedMixedPath, 'utf8')
    const { out, report } = transformSourceWithReport(before)

    expect(report.skipped).toBe(1)
    expect(report.rewritten).toBe(1)
    expect(out).toContain(REVIEW_MARKER)
    // Base64 path kept classic
    expect(out).toMatch(/const a = await manager\.readCharacteristicForDevice\s*\(/)
    // uuid-only path rewritten
    expect(out).toMatch(/const b = await manager\.readCharacteristicForDeviceAsBytes\s*\(/)
    expect(out.trim()).toBe(expected.trim())

    // AST analysis exposes per-call decisions
    const decisions = analyzeReadCalls(before)
    expect(decisions).toHaveLength(2)
    expect(decisions.filter(d => d.skip)).toHaveLength(1)
    expect(decisions.filter(d => !d.skip)).toHaveLength(1)
  })

  test('--aggressive renames but marks remaining .value consumers for review', () => {
    const before = fs.readFileSync(beforePath, 'utf8')
    const { out, report } = transformSourceWithReport(before, { aggressive: true })
    expect(out).toContain('readCharacteristicForDeviceAsBytes(')
    expect(out).toContain(REVIEW_MARKER)
    expect(report.rewritten).toBeGreaterThan(0)
    // Still returns c.value — human must adapt (Uint8Array, not Base64)
    expect(out).toMatch(/return\s+c\.value/)
  })

  test('does not rewrite write methods (would leave Base64 args on FromBytes APIs)', () => {
    const src =
      "manager.writeCharacteristicWithResponseForDevice(id, s, c, 'YQ==')\n" +
      'manager.readCharacteristicForDevice(id, s, c)\n'
    // no .value use → safe rename of read only
    const out = transformSource(src)
    expect(out).toContain('writeCharacteristicWithResponseForDevice(')
    expect(out).not.toContain('FromBytes')
    expect(out).toContain('readCharacteristicForDeviceAsBytes(')
  })

  test('CLI --check exits 0 on before fixture (marker path)', () => {
    const { spawnSync } = require('child_process')
    const r = spawnSync(
      process.execPath,
      [path.join(root, 'scripts/codemod/transform-bytes-path.js'), '--check', beforePath],
      { encoding: 'utf8' }
    )
    expect(r.status).toBe(0)
    expect(r.stdout + r.stderr).toMatch(/OK/)
  })

  test('CLI --dry-run reports skips without requiring write', () => {
    const { spawnSync } = require('child_process')
    const r = spawnSync(
      process.execPath,
      [path.join(root, 'scripts/codemod/transform-bytes-path.js'), '--dry-run', beforePath],
      { encoding: 'utf8' }
    )
    expect(r.status).toBe(0)
    expect(r.stdout + r.stderr).toMatch(/skipped=|report/i)
  })

  test('CLI --write persists transform to disk (F044)', () => {
    const { spawnSync } = require('child_process')
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ble-codemod-'))
    const tmpFile = path.join(tmpDir, 'sample.js')
    fs.copyFileSync(beforeSafePath, tmpFile)

    const r = spawnSync(
      process.execPath,
      [path.join(root, 'scripts/codemod/transform-bytes-path.js'), '--write', tmpFile],
      { encoding: 'utf8' }
    )
    expect(r.status).toBe(0)
    expect(r.stdout + r.stderr).toMatch(/wrote:|rewritten=/i)

    const written = fs.readFileSync(tmpFile, 'utf8')
    expect(written).toContain('readCharacteristicForDeviceAsBytes(')
    expect(written).not.toMatch(/readCharacteristicForDevice\s*\(/)

    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('MIGRATION does not present the transitional codemod as a 4.0 path', () => {
    const mig = fs.readFileSync(path.join(root, 'MIGRATION_4.0.md'), 'utf8')
    expect(mig).toContain('no released 4.0 API instructions yet')
    expect(mig).not.toMatch(/optional bytes codemod \(experimental/i)
    expect(mig).not.toContain('--write')
  })
})
