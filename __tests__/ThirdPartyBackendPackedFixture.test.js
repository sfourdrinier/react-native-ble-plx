// __tests__/ThirdPartyBackendPackedFixture.test.js

const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const fixtureRoot = path.join(root, 'fixtures', 'third-party-backend-sdk')

describe('packed third-party backend SDK fixture', () => {
  test('ships an independent external package definition and invokes it from pack/install smoke', () => {
    expect(fs.existsSync(path.join(fixtureRoot, 'package.json'))).toBe(true)
    expect(fs.existsSync(path.join(fixtureRoot, 'src', 'packed-third-party-backend.ts'))).toBe(true)

    const manifest = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'package.json'), 'utf8'))
    expect(manifest.name).toBe('@example/packed-third-party-backend')
    expect(manifest.peerDependencies).toEqual({ 'unified-ble-manager': '>=4.0.0-alpha.0 <5.0.0' })
    expect(manifest.devDependencies).toEqual({ typescript: '5.8.3' })

    const source = fs.readFileSync(path.join(fixtureRoot, 'src', 'packed-third-party-backend.ts'), 'utf8')
    const importSpecifiers = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1])

    expect(importSpecifiers).toEqual([
      'unified-ble-manager/backend-sdk',
      'unified-ble-manager/testing',
    ])
    expect(source).not.toMatch(/(?:^|['\"])\.\.\//m)
    expect(source).not.toContain('live-radio')
    expect(source).toContain("state: 'unavailable'")
    expect(source).toContain("evidenceLevel: 'blocked'")
    expect(source).toContain('runBackendAuthorTck')

    const packInstallSmoke = fs.readFileSync(path.join(root, 'scripts', 'ci', 'pack-install-smoke.js'), 'utf8')
    expect(packInstallSmoke).toContain('runPackedThirdPartyBackendFixture')
    expect(packInstallSmoke).toContain('assertDeclaredToolDependency')
    expect(packInstallSmoke).toContain('resolveIsolatedConsumerToolEntrypoint')
    expect(packInstallSmoke).toContain("'typescript/bin/tsc'")
    expect(packInstallSmoke).not.toContain("path.join(root, 'node_modules', 'typescript', 'bin', 'tsc')")
  })
})
