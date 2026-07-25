/**
 * F004 — publish-time rewrite of shim dependency file:../.. → exact semver.
 * Authoritative tool: scripts/prepare-shim-pack.js (temp dir; does not mutate monorepo source).
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.join(__dirname, '..')
const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const shimPkgPath = path.join(root, 'packages/react-native-ble-plx-shim/package.json')
const packScript = path.join(root, 'scripts/prepare-shim-pack.js')

describe('prepare-shim-pack (F004)', () => {
  test('monorepo source still uses file: for local dev', () => {
    const shimPkg = JSON.parse(fs.readFileSync(shimPkgPath, 'utf8'))
    expect(shimPkg.dependencies['unified-ble-manager']).toMatch(/file:|\.\./)
  })

  test('prepare-shim-pack --print-dir rewrites to exact root version (not file:)', () => {
    const r = spawnSync(process.execPath, [packScript, '--print-dir'], {
      encoding: 'utf8',
      cwd: root
    })
    expect(r.status).toBe(0)
    const dir = r.stdout.trim()
    expect(fs.existsSync(dir)).toBe(true)
    const packed = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    expect(packed.dependencies['unified-ble-manager']).toBe(rootPkg.version)
    expect(packed.dependencies['unified-ble-manager']).not.toMatch(/file:|\.\.\//)
    expect(packed.version).toBe(rootPkg.version)
    expect(packed.name).toBe('@sfourdrinier/react-native-ble-plx')
    // Host subpaths must ship in the packed tree
    expect(fs.existsSync(path.join(dir, 'web.js'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'electron.js'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'node.js'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'app.plugin.js'))).toBe(true)
  })

  test('--assert-packed rejects monorepo file: dependency', () => {
    const r = spawnSync(process.execPath, [packScript, '--assert-packed', shimPkgPath], {
      encoding: 'utf8',
      cwd: root
    })
    expect(r.status).not.toBe(0)
  })

  test('prepare-shim-pack does not mutate on-disk monorepo shim package.json', () => {
    const before = fs.readFileSync(shimPkgPath, 'utf8')
    spawnSync(process.execPath, [packScript, '--print-dir'], { encoding: 'utf8', cwd: root })
    const after = fs.readFileSync(shimPkgPath, 'utf8')
    expect(after).toBe(before)
  })
})
