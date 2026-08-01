// __tests__/ReleaseArtifacts.test.js

const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const root = path.join(__dirname, '..')
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/\r\n/g, '\n')
const readJson = relativePath => JSON.parse(read(relativePath))

describe('open-source release policies and dependency artifacts', () => {
  test('publishes the complete policy set with actionable reporting and decision rules', () => {
    const security = read('SECURITY.md')
    const support = read('SUPPORT.md')
    const governance = read('GOVERNANCE.md')
    const contributing = read('CONTRIBUTING.md')
    const dependencyPolicy = read('docs/DEPENDENCY_AND_ARTIFACT_POLICY.md')

    expect(security).toContain('GitHub Security Advisory')
    expect(security).toContain('Do not open a public issue')
    expect(security).toContain('Supported versions')
    expect(support).toContain('Evidence-backed support labels')
    expect(support).toContain('generated/PLATFORM_SUPPORT.md')
    expect(governance).toContain('Backend contract governance')
    expect(governance).toContain('ADR')
    expect(contributing).toContain('pnpm verify:release')
    expect(contributing).toContain('zero warnings')
    expect(dependencyPolicy).toContain('CycloneDX 1.6')
    expect(dependencyPolicy).toContain('unresolved license')
    expect(dependencyPolicy).toContain('kind-specific source-file digests')
    expect(read('RELEASE.md')).not.toContain('private vulnerability reporting is\ndisabled')
  })

  test('keeps a reproducible CycloneDX SBOM and audited license inventory fresh', () => {
    execFileSync(process.execPath, ['scripts/release/generate-dependency-artifacts.js', '--check'], {
      cwd: root,
      stdio: 'pipe',
    })

    const sbom = readJson('SBOM.cdx.json')
    const inventory = readJson('THIRD_PARTY_LICENSES.json')
    expect(sbom.bomFormat).toBe('CycloneDX')
    expect(sbom.specVersion).toBe('1.6')
    expect(sbom.version).toBe(1)
    expect(sbom.metadata.component.name).toBe('unified-ble-manager')
    expect(sbom.metadata.component.version).toBe(require('../package.json').version)
    expect(sbom.components.length).toBeGreaterThan(0)
    expect(new Set(sbom.components.map(component => component['bom-ref'])).size).toBe(sbom.components.length)
    expect(sbom.components.every(component => component.purl.startsWith('pkg:npm/'))).toBe(true)
    expect(inventory.schema).toBe('unified-ble-manager/third-party-license-inventory')
    expect(inventory.source.method).toBe('pnpm-lock production graph with installed-manifest license audit')
    expect(inventory.unresolved).toEqual([])
    expect(inventory.packages.length).toBe(sbom.components.length)
    expect(sbom.dependencies).toHaveLength(sbom.components.length + 1)
    expect(sbom.dependencies.some(dependency => dependency.dependsOn.length > 0)).toBe(true)
    expect(read('scripts/release/generate-dependency-artifacts.js')).not.toContain('pnpm licenses')
  })

  test('generation is byte-for-byte reproducible and does not expose local paths', () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ubm-release-artifacts-'))
    const first = path.join(temporaryRoot, 'first')
    const second = path.join(temporaryRoot, 'second')
    fs.mkdirSync(first)
    fs.mkdirSync(second)

    try {
      for (const outputDirectory of [first, second]) {
        execFileSync(
          process.execPath,
          ['scripts/release/generate-dependency-artifacts.js', '--output-directory', outputDirectory],
          { cwd: root, stdio: 'pipe' }
        )
      }

      for (const fileName of ['SBOM.cdx.json', 'THIRD_PARTY_LICENSES.json']) {
        const firstBytes = fs.readFileSync(path.join(first, fileName))
        const secondBytes = fs.readFileSync(path.join(second, fileName))
        expect(crypto.createHash('sha256').update(firstBytes).digest('hex')).toBe(
          crypto.createHash('sha256').update(secondBytes).digest('hex')
        )
        expect(firstBytes.toString('utf8')).not.toContain('/Users/')
        expect(firstBytes.toString('utf8')).not.toContain('node_modules/.pnpm')
      }
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true })
    }
  })

  test('enforces artifact freshness in CI, local release verification, and publication', () => {
    const packageJson = readJson('package.json')
    const ci = read('.github/workflows/ci.yml')
    const publish = read('.github/workflows/publish.yml')
    const verifyRelease = read('scripts/verify-release.sh')

    expect(packageJson.scripts['release:artifacts']).toBe(
      'node scripts/release/generate-dependency-artifacts.js'
    )
    expect(packageJson.scripts['release:artifacts:check']).toBe(
      'node scripts/release/generate-dependency-artifacts.js --check'
    )
    for (const publishedFile of [
      'SECURITY.md',
      'SUPPORT.md',
      'GOVERNANCE.md',
      'CONTRIBUTING.md',
      'SBOM.cdx.json',
      'THIRD_PARTY_LICENSES.json',
    ]) {
      expect(packageJson.files).toContain(publishedFile)
    }
    expect(ci).toContain('pnpm release:artifacts:check')
    expect(publish).toContain('pnpm release:artifacts:check')
    expect(publish).toContain('SBOM.cdx.json')
    expect(publish).toContain('THIRD_PARTY_LICENSES.json')
    expect(publish).toContain('SHA256SUMS')
    expect(publish).toContain('dist.attestations')
    expect(publish).toContain('https://slsa.dev/provenance/v1')
    expect(publish).toContain('npm provenance metadata did not become visible')
    expect(verifyRelease).toContain('pnpm release:artifacts:check')
  })
})
