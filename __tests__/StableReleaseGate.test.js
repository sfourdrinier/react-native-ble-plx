// __tests__/StableReleaseGate.test.js

'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const zlib = require('zlib')
const { spawnSync } = require('child_process')
const { canonicalJson } = require('../scripts/evidence/evidence-command-receipt')

const repositoryRoot = path.resolve(__dirname, '..')
const evidenceFixtureDirectory = path.join(repositoryRoot, 'evidence', 'v1', 'fixtures')
const artifactsFixtureDirectory = path.join(evidenceFixtureDirectory, 'artifacts')
const gatePath = path.join(repositoryRoot, 'scripts', 'evidence', 'stable-release-gate.js')
const stableReleaseCliPath = path.join(repositoryRoot, 'scripts', 'evidence', 'validate-stable-release.js')
const {
  generateStableSupportMatrix,
  stableEvidenceAreas,
  stableMinimumSupportLabels,
  stableReleaseCheckKinds,
  stableReleaseCheckSubjects,
  stableSection31ItemIds,
  validateStableRelease
} = require(gatePath)
const { approvedCiFromRun, generatedPublishArtifact, parseArguments, verifyStableTagCommit } = require(
  stableReleaseCliPath
)

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8'))
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

function runGit(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout.trim()
}

function writeOctal(buffer, offset, length, value) {
  const encoded = Buffer.from(`${value.toString(8).padStart(length - 1, '0')}\0`, 'ascii')
  encoded.copy(buffer, offset)
}

function tarEntry(pathname, content) {
  const header = Buffer.alloc(512)
  Buffer.from(pathname, 'utf8').copy(header, 0)
  writeOctal(header, 100, 8, 0o644)
  writeOctal(header, 108, 8, 0)
  writeOctal(header, 116, 8, 0)
  writeOctal(header, 124, 12, content.length)
  writeOctal(header, 136, 12, 0)
  header.fill(0x20, 148, 156)
  header[156] = '0'.charCodeAt(0)
  Buffer.from('ustar\0', 'ascii').copy(header, 257)
  Buffer.from('00', 'ascii').copy(header, 263)
  const checksum = header.reduce((total, byte) => total + byte, 0)
  writeOctal(header, 148, 8, checksum)
  const padding = Buffer.alloc((512 - (content.length % 512)) % 512)
  return Buffer.concat([header, content, padding])
}

function writePackageArtifact(root) {
  const publishFileName = 'unified-ble-manager-4.0.0.tgz'
  const pathWithinRoot = `evidence/v1/fixtures/artifacts/${publishFileName}`
  const packageJson = Buffer.from(JSON.stringify({ name: 'unified-ble-manager', version: '4.0.0' }), 'utf8')
  const module = Buffer.from('module.exports = {}\n', 'utf8')
  const archive = Buffer.concat([
    tarEntry('package/package.json', packageJson),
    tarEntry('package/lib/commonjs/index.js', module),
    Buffer.alloc(1024)
  ])
  const file = path.join(root, ...pathWithinRoot.split('/'))
  fs.writeFileSync(file, zlib.gzipSync(archive, { mtime: 0 }))
  return { path: pathWithinRoot, publishFileName, sha256: sha256(fs.readFileSync(file)) }
}

function writeCheckArtifact(root, check, release) {
  const pathWithinRoot = `evidence/v1/fixtures/artifacts/stable-release-${check}.json`
  const file = path.join(root, ...pathWithinRoot.split('/'))
  writeJson(file, {
    schema: 'unified-ble-manager/stable-release-check',
    version: 1,
    kind: check,
    status: 'passed',
    subjects: stableReleaseCheckSubjects[check].map(relativePath => {
      const source = path.join(repositoryRoot, relativePath)
      const target = path.join(root, relativePath)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(source, target)
      return { path: relativePath, sha256: sha256(fs.readFileSync(target)) }
    }),
    release: {
      packageName: release.packageName,
      version: release.version,
      tag: release.tag,
      sourceCommit: release.sourceCommit,
      packageArtifactSha256: release.packageArtifact.sha256
    },
    summary: 'Synthetic fixture only. This does not evidence a real release.'
  })
  return { path: pathWithinRoot, sha256: sha256(fs.readFileSync(file)) }
}

function createCompleteStableFixture() {
  const input = readJson('evidence/v1/fixtures/stable-release-synthetic-input.json')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stable-release-gate-'))
  const fixtureArtifacts = path.join(root, 'evidence', 'v1', 'fixtures', 'artifacts')
  fs.mkdirSync(fixtureArtifacts, { recursive: true })
  fs.cpSync(artifactsFixtureDirectory, fixtureArtifacts, { recursive: true })

  const sourceCommit = input.sourceCommit
  const packageArtifact = writePackageArtifact(root)
  const requirements = stableEvidenceAreas.map((area, index) => ({
    area,
    claimId: `${input.claimPrefix}-${area}`,
    revision: 1,
    backendId: `fixture-stable-backend-${String(index)}`,
    platformId: `fixture-stable-platform-${String(index)}`,
    hostId: `fixture-stable-host-${String(index)}`,
    minimumSupportLabel: stableMinimumSupportLabels[area]
  }))
  const records = requirements.map((requirement, index) => {
    const record = clone(readJson('evidence/v1/fixtures/valid-live-preview-l4.json'))
    record.claim.id = requirement.claimId
    record.claim.publishedSupportLabel = requirement.minimumSupportLabel
    record.claim.targetSupportLabel = requirement.minimumSupportLabel
    record.claim.supportMatrix =
      requirement.minimumSupportLabel === 'Preview'
        ? { environments: [], entries: [] }
        : {
            environments: [
              {
                id: `fixture-stable-environment-${String(index)}`,
                platformId: `fixture-stable-platform-${String(index)}`,
                hostId: `fixture-stable-host-${String(index)}`,
                runtime: { node: '22.16.0' }
              }
            ],
            entries: [
              {
                environmentId: `fixture-stable-environment-${String(index)}`,
                capabilityIds: ['fixture-scan'],
                scenarioIds: ['fixture-live-vertical']
              }
            ]
          }
    record.subject.backend.id = requirement.backendId
    record.subject.platform.id = requirement.platformId
    record.subject.host.id = requirement.hostId
    record.subject.packageArtifact = {
      name: input.packageName,
      version: input.packageVersion,
      availability: 'verified',
      type: 'tarball',
      path: packageArtifact.path,
      sha256: packageArtifact.sha256,
      artifactId: 'fixture-package-artifact'
    }
    const packageArtifactRecord = record.artifacts.find(artifact => artifact.id === 'fixture-package-artifact')
    packageArtifactRecord.packageType = 'tarball'
    packageArtifactRecord.path = packageArtifact.path
    packageArtifactRecord.sha256 = packageArtifact.sha256
    packageArtifactRecord.mediaType = 'application/gzip'
    record.source.commit = sourceCommit
    return record
  })
  const release = {
    $schema: 'evidence/v1/schema/stable-release.schema.json',
    schema: { id: 'unified-ble-manager/stable-release', version: '1.0.0' },
    packageName: input.packageName,
    version: input.packageVersion,
    tag: input.tag,
    sourceCommit,
    packageArtifact,
    evidence: { requiredClaims: requirements },
    supportMatrix: {
      generator: 'unified-ble-manager/stable-support-matrix',
      version: 1,
      path: 'evidence/v1/fixtures/artifacts/stable-release-support-matrix.json',
      sha256: ''
    },
    section31: {
      plan: { path: 'docs/UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md', sha256: '' },
      roadmap: { path: 'ROADMAP.4.0.md', sha256: '' },
      gaps: { path: 'docs/GAPS.4.0.md', sha256: '' },
      items: stableSection31ItemIds.map(id => ({ id, status: 'passed' }))
    },
    approvedCi: input.approvedCi,
    checks: {}
  }

  fs.writeFileSync(
    path.join(root, release.supportMatrix.path),
    `${canonicalJson(generateStableSupportMatrix(release, records))}\n`
  )
  release.supportMatrix.sha256 = sha256(fs.readFileSync(path.join(root, release.supportMatrix.path)))
  ;['plan', 'roadmap', 'gaps'].forEach(key => {
    const source = path.join(repositoryRoot, release.section31[key].path)
    const target = path.join(root, release.section31[key].path)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(source, target)
    release.section31[key].sha256 = sha256(fs.readFileSync(target))
  })
  stableReleaseCheckKinds.forEach(check => {
    release.checks[check] = writeCheckArtifact(root, check, release)
  })
  return { root, release, records }
}

function verificationContext(fixture, overrides = {}) {
  return {
    tag: 'v4.0.0',
    tagCommit: '1111111111111111111111111111111111111111',
    verifiedSourceCommit: fixture.release.sourceCommit,
    package: { name: 'unified-ble-manager', version: '4.0.0' },
    approvedCi: fixture.release.approvedCi,
    publishArtifact: {
      fileName: fixture.release.packageArtifact.publishFileName,
      sha256: fixture.release.packageArtifact.sha256
    },
    ...overrides
  }
}

describe('stable release evidence gate', () => {
  test('runs the GA evidence gate only for final version tags', () => {
    const workflow = fs.readFileSync(path.join(repositoryRoot, '.github', 'workflows', 'publish.yml'), 'utf8')
    const releaseGuide = fs.readFileSync(path.join(repositoryRoot, 'RELEASE.md'), 'utf8')
    const evidenceGuide = fs.readFileSync(path.join(repositoryRoot, 'evidence', 'v1', 'README.md'), 'utf8')
    expect(workflow).toContain('id: release_channel')
    expect(workflow).toContain('echo "is_stable=false" >> "$GITHUB_OUTPUT"')
    expect(workflow).toContain('echo "is_stable=true" >> "$GITHUB_OUTPUT"')
    expect(workflow).toContain("if: steps.release_channel.outputs.is_stable == 'true'")
    expect(workflow).toContain('fetch-depth: 0')
    expect(workflow).toContain('git fetch --no-tags origin +refs/heads/master:refs/remotes/origin/master')
    expect(workflow).toContain('--publish-tarball "${PUBLISH_TARBALL}"')
    expect(workflow).toContain('npm publish "${PUBLISH_TARBALL}" --provenance --access public --tag "${NPM_DIST_TAG}"')
    expect(workflow).toContain('npm view "unified-ble-manager@${VER}" dist.tarball --json')
    expect(workflow).toContain('for ATTEMPT in $(seq 1 12)')
    expect(workflow).toContain('npm registry metadata did not become visible within the bounded retry window')
    expect(workflow).toContain('Registry tarball SHA-256 does not match the exact generated publish tarball')
    expect(workflow).toContain("curl --fail --location --silent --show-error --proto '=https'")
    expect(releaseGuide).toContain('evidence-only release commit')
    expect(evidenceGuide).toContain('evidence-only descendant')
  })

  test('keeps the runtime requirements synchronized with the stable release schema', () => {
    const schema = readJson('evidence/v1/schema/stable-release.schema.json')
    expect(schema.required).toEqual(
      expect.arrayContaining(['packageArtifact', 'evidence', 'supportMatrix', 'section31', 'approvedCi', 'checks'])
    )
    expect(schema.$defs.requiredClaim.properties.area.enum).toEqual(stableEvidenceAreas)
    expect(schema.properties.checks.required).toEqual(stableReleaseCheckKinds)
    expect(stableReleaseCheckSubjects.sbom).toEqual([
      'SBOM.cdx.json',
      'scripts/release/generate-dependency-artifacts.js',
    ])
    expect(schema.$defs.section31Item.properties.id.enum).toEqual(stableSection31ItemIds)
    expect(stableMinimumSupportLabels.deterministic).toBe('Preview')
    stableEvidenceAreas
      .filter(area => area !== 'deterministic')
      .forEach(area => {
        expect(stableMinimumSupportLabels[area]).toBe('Supported')
      })
  })

  test('refuses prerelease tags and requires a stable tag argument', () => {
    expect(() => parseArguments([])).toThrow('--tag is required')
    expect(() => parseArguments(['--tag', 'v4.0.0'])).toThrow('--publish-tarball is required')
    expect(() =>
      parseArguments(['--tag', 'v4.0.0-rc.1', '--publish-tarball', '.release/unified-ble-manager-4.0.0.tgz'])
    ).toThrow('stable vX.Y.Z tag')
    expect(
      parseArguments(['--tag', 'v4.0.0', '--publish-tarball', '.release/unified-ble-manager-4.0.0.tgz'])
    ).toMatchObject({
      tag: 'v4.0.0',
      releaseManifest: 'evidence/v1/releases/v4.0.0.json',
      publishTarball: '.release/unified-ble-manager-4.0.0.tgz'
    })
  })

  test('accepts only an evidence-only release commit over the tested source commit', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stable-release-git-'))
    try {
      runGit(root, ['init', '--initial-branch=master'])
      runGit(root, ['config', 'user.name', 'Stable Fixture'])
      runGit(root, ['config', 'user.email', 'stable@example.invalid'])
      fs.writeFileSync(path.join(root, 'fixture.txt'), 'first\n')
      runGit(root, ['add', 'fixture.txt'])
      runGit(root, ['commit', '-m', 'first'])
      const approvedCommit = runGit(root, ['rev-parse', 'HEAD'])
      fs.mkdirSync(path.join(root, 'evidence', 'v1', 'releases'), { recursive: true })
      fs.writeFileSync(path.join(root, 'evidence', 'v1', 'releases', 'v4.0.0.json'), '{}\n')
      runGit(root, ['add', 'evidence/v1/releases/v4.0.0.json'])
      runGit(root, ['commit', '-m', 'release evidence'])
      const releaseCommit = runGit(root, ['rev-parse', 'HEAD'])
      runGit(root, ['update-ref', 'refs/remotes/origin/master', releaseCommit])
      runGit(root, ['tag', 'v4.0.0', releaseCommit])
      expect(verifyStableTagCommit(root, 'v4.0.0', approvedCommit)).toEqual({
        sourceCommit: approvedCommit,
        tagCommit: releaseCommit,
      })
      expect(() => verifyStableTagCommit(root, 'v4.0.0', releaseCommit)).toThrow('evidence-only descendant')

      fs.writeFileSync(path.join(root, 'fixture.txt'), 'third\n')
      runGit(root, ['add', 'fixture.txt'])
      runGit(root, ['commit', '-m', 'third'])
      const unapprovedCommit = runGit(root, ['rev-parse', 'HEAD'])
      runGit(root, ['tag', 'v4.0.1', unapprovedCommit])
      runGit(root, ['update-ref', 'refs/remotes/origin/master', unapprovedCommit])
      expect(() => verifyStableTagCommit(root, 'v4.0.1', approvedCommit)).toThrow('non-release path fixture.txt')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  test('accepts only a completed successful run from the approved CI workflow', () => {
    const input = readJson('evidence/v1/fixtures/stable-release-synthetic-input.json')
    const run = {
      id: input.approvedCi.runId,
      path: input.approvedCi.workflowPath,
      html_url: input.approvedCi.runUrl,
      head_sha: input.approvedCi.headCommit,
      status: 'completed',
      conclusion: 'success'
    }
    expect(approvedCiFromRun(run, input.approvedCi.runId)).toEqual(input.approvedCi)
    expect(() => approvedCiFromRun({ ...run, conclusion: 'failure' }, input.approvedCi.runId)).toThrow(
      'not a completed successful run'
    )
    expect(() => approvedCiFromRun({ ...run, path: '.github/workflows/publish.yml' }, input.approvedCi.runId)).toThrow(
      'does not use .github/workflows/ci.yml'
    )
  })

  test('accepts only a complete, source-bound synthetic stable release collection', () => {
    const fixture = createCompleteStableFixture()
    try {
      expect(
        validateStableRelease(fixture.release, fixture.records, fixture.root, verificationContext(fixture))
      ).toEqual([])
      expect(generatedPublishArtifact(fixture.root, fixture.release.packageArtifact.path)).toEqual(
        verificationContext(fixture).publishArtifact
      )
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  test('rejects unverified source, approved CI, and generated publish tarball bindings', () => {
    const fixture = createCompleteStableFixture()
    try {
      const differentCommit = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      const tagErrors = validateStableRelease(
        fixture.release,
        fixture.records,
        fixture.root,
        verificationContext(fixture, { verifiedSourceCommit: differentCommit })
      ).join('\n')
      expect(tagErrors).toContain('verified source commit: must exactly match the stable release source commit')

      fixture.release.approvedCi.headCommit = differentCommit
      const ciErrors = validateStableRelease(
        fixture.release,
        fixture.records,
        fixture.root,
        verificationContext(fixture, { approvedCi: fixture.release.approvedCi })
      ).join('\n')
      expect(ciErrors).toContain('approvedCi.headCommit: must exactly match the stable release source commit')

      fixture.release.approvedCi.headCommit = fixture.release.sourceCommit
      const tarballErrors = validateStableRelease(
        fixture.release,
        fixture.records,
        fixture.root,
        verificationContext(fixture, {
          publishArtifact: {
            fileName: fixture.release.packageArtifact.publishFileName,
            sha256: differentCommit.repeat(2).slice(0, 64)
          }
        })
      ).join('\n')
      expect(tarballErrors).toContain('publish artifact sha256: must match the evidence-bound package artifact digest')
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  test('rejects blocked or unverified required stable evidence', () => {
    const fixture = createCompleteStableFixture()
    try {
      fixture.records[0].proof.status = 'blocked'
      fixture.records[0].proof.supportGate = false
      fixture.records[0].proof.reason = 'Synthetic blocked proof.'
      fixture.records[0].proof.scenarios[0].result = 'blocked'
      fixture.records[0].proof.scenarios[0].reason = 'Synthetic blocked scenario.'
      fixture.records[0].execution.provenance = 'reported-unverified'
      const errors = validateStableRelease(
        fixture.release,
        fixture.records,
        fixture.root,
        verificationContext(fixture)
      ).join('\n')
      expect(errors).toContain('required stable claim fixture-stable-deterministic must be passed')
      expect(errors).toContain('required stable claims cannot use reported-unverified provenance')
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  test('rejects generated-matrix drift, an incomplete Section 31 item, a failed required check, and unapproved CI', () => {
    const fixture = createCompleteStableFixture()
    try {
      fs.writeFileSync(path.join(fixture.root, fixture.release.supportMatrix.path), '{}\n')
      fixture.release.supportMatrix.sha256 = sha256(
        fs.readFileSync(path.join(fixture.root, fixture.release.supportMatrix.path))
      )
      fixture.release.section31.items[0].status = 'blocked'
      const securityCheckPath = path.join(fixture.root, fixture.release.checks.security.path)
      const securityCheck = JSON.parse(fs.readFileSync(securityCheckPath, 'utf8'))
      securityCheck.status = 'failed'
      securityCheck.subjects[0].sha256 = 'a'.repeat(64)
      writeJson(securityCheckPath, securityCheck)
      fixture.release.checks.security.sha256 = sha256(fs.readFileSync(securityCheckPath))
      const unapprovedCi = { ...fixture.release.approvedCi, headCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }
      const errors = validateStableRelease(
        fixture.release,
        fixture.records,
        fixture.root,
        verificationContext(fixture, { approvedCi: unapprovedCi })
      ).join('\n')
      expect(errors).toContain('must equal the deterministic generated stable support matrix')
      expect(errors).toContain('section31.items[0].status: must be passed for a stable release')
      expect(errors).toContain('checks.security.artifact.status: must be passed')
      expect(errors).toContain('checks.security.artifact.subjects[0].sha256: does not match the retained file digest')
      expect(errors).toContain('approvedCi.headCommit: does not match the externally verified CI run')
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  test('rejects the current incomplete evidence collection for a stable tag', () => {
    const fixture = createCompleteStableFixture()
    try {
      const currentRecords = fs
        .readdirSync(path.join(repositoryRoot, 'evidence', 'v1', 'records'))
        .filter(filename => filename.endsWith('.json'))
        .map(filename => readJson(`evidence/v1/records/${filename}`))
      expect(
        validateStableRelease(fixture.release, currentRecords, fixture.root, verificationContext(fixture)).join('\n')
      ).toContain('is missing from the evidence collection')
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true })
    }
  })
})
