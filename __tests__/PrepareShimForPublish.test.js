// __tests__/PrepareShimForPublish.test.js

/**
 * F004 — publish-time rewrite of shim dependency file:../.. → exact semver.
 * Authoritative tool: scripts/prepare-shim-pack.js (temp dir; does not mutate monorepo source).
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const {
  assertPackDestinationEmpty,
  assertPacked,
  prepareDir,
  removePreparedDirectory,
  tarballName
} = require('../scripts/prepare-shim-pack')

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
    try {
      expect(fs.existsSync(dir)).toBe(true)
      const packed = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
      expect(packed.dependencies['unified-ble-manager']).toBe(rootPkg.version)
      expect(packed.dependencies['unified-ble-manager']).not.toMatch(/file:|\.\.\//)
      expect(packed.version).toBe(rootPkg.version)
      expect(packed.name).toBe('@sfourdrinier/react-native-ble-plx')
      expect(Object.keys(packed.exports).sort()).toEqual(['.', './app.plugin.js', './package.json'])
      expect(fs.existsSync(path.join(dir, 'app.plugin.js'))).toBe(true)
      for (const removedHostProxy of ['web.js', 'web.d.ts', 'electron.js', 'electron.d.ts', 'node.js', 'node.d.ts']) {
        expect(fs.existsSync(path.join(dir, removedHostProxy))).toBe(false)
      }
    } finally {
      removePreparedDirectory(dir)
    }
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
    const result = spawnSync(process.execPath, [packScript, '--print-dir'], { encoding: 'utf8', cwd: root })
    const dir = result.stdout.trim()
    try {
      const after = fs.readFileSync(shimPkgPath, 'utf8')
      expect(after).toBe(before)
    } finally {
      removePreparedDirectory(dir)
    }
  })

  test('rejects a shim package that uses a non-exact canonical dependency version', () => {
    const dir = prepareDir()
    const packagePath = path.join(dir, 'package.json')
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
    packageJson.dependencies['unified-ble-manager'] = `^${rootPkg.version}`
    fs.writeFileSync(packagePath, JSON.stringify(packageJson))

    try {
      expect(() => assertPacked(packagePath)).toThrow(/exact unified-ble-manager version/)
    } finally {
      removePreparedDirectory(dir)
    }
  })

  test('refuses to overwrite an existing shim tarball in the requested artifact directory', () => {
    const directory = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ble-plx-shim-artifacts-'))
    const expectedTarball = path.join(
      directory,
      tarballName({ name: '@sfourdrinier/react-native-ble-plx', version: rootPkg.version })
    )
    fs.writeFileSync(expectedTarball, 'existing artifact')

    try {
      expect(() =>
        assertPackDestinationEmpty(directory, { name: '@sfourdrinier/react-native-ble-plx', version: rootPkg.version })
      ).toThrow(/Refusing to overwrite existing shim tarball/)
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
})
