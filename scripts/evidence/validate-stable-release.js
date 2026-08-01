// scripts/evidence/validate-stable-release.js

'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')
const { readContainedJson } = require('./evidence-secure-files')
const { validateStableRelease } = require('./stable-release-gate')

function fail(message) {
  console.error(`[validateStableRelease] ${message}`)
  process.exitCode = 1
}

function parseArguments(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!['--tag', '--release-manifest', '--records-dir', '--package-json', '--publish-tarball'].includes(argument))
      throw new Error(`unknown argument: ${argument}`)
    const value = argv[index + 1]
    if (typeof value !== 'string' || value.length === 0) throw new Error(`${argument} requires a value`)
    if (options[argument] !== undefined) throw new Error(`${argument} must appear only once`)
    options[argument] = value
    index += 1
  }
  if (typeof options['--tag'] !== 'string') throw new Error('--tag is required')
  if (typeof options['--publish-tarball'] !== 'string') throw new Error('--publish-tarball is required')
  if (!/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(options['--tag']))
    throw new Error('--tag must be a stable vX.Y.Z tag without a prerelease identifier')
  return {
    tag: options['--tag'],
    releaseManifest: options['--release-manifest'] || `evidence/v1/releases/${options['--tag']}.json`,
    recordsDirectory: options['--records-dir'] || 'evidence/v1/records',
    packageJson: options['--package-json'] || 'package.json',
    publishTarball: options['--publish-tarball']
  }
}

function repositoryPath(root, relativePath, expectedPrefix) {
  if (typeof relativePath !== 'string') throw new Error(`unsafe repository-relative path: ${String(relativePath)}`)
  const insidePrefix =
    expectedPrefix === '' || relativePath === expectedPrefix || relativePath.startsWith(`${expectedPrefix}/`)
  if (
    relativePath.length === 0 ||
    !insidePrefix ||
    relativePath.includes('\\') ||
    path.posix.isAbsolute(relativePath) ||
    path.posix.normalize(relativePath) !== relativePath ||
    relativePath.includes('/../') ||
    relativePath.startsWith('../')
  ) {
    throw new Error(`unsafe repository-relative path: ${String(relativePath)}`)
  }
  const rootRealPath = fs.realpathSync(root)
  const absolutePath = path.resolve(rootRealPath, ...relativePath.split('/'))
  if (!absolutePath.startsWith(`${rootRealPath}${path.sep}`))
    throw new Error(`path escapes repository root: ${relativePath}`)
  let component = rootRealPath
  for (const part of relativePath.split('/')) {
    component = path.join(component, part)
    if (fs.lstatSync(component).isSymbolicLink())
      throw new Error(`path must not traverse a symbolic link: ${relativePath}`)
  }
  return absolutePath
}

function readRecords(root, relativeDirectory) {
  const directory = repositoryPath(root, relativeDirectory, 'evidence/v1/records')
  const stat = fs.lstatSync(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error(`records directory must be a regular directory: ${relativeDirectory}`)
  return fs
    .readdirSync(directory)
    .filter(filename => filename.endsWith('.json'))
    .sort()
    .map(filename => {
      const relativePath = `${relativeDirectory}/${filename}`
      return {
        path: relativePath,
        manifest: readContainedJson(root, repositoryPath(root, relativePath, 'evidence/v1/records'))
      }
    })
}

function git(root, gitArguments) {
  const result = spawnSync('git', gitArguments, { cwd: root, encoding: 'utf8', shell: false })
  if (result.error) throw new Error(`git ${gitArguments.join(' ')} failed to start: ${result.error.message}`)
  return result
}

function requireGitOutput(root, gitArguments) {
  const result = git(root, gitArguments)
  if (result.status !== 0)
    throw new Error(`git ${gitArguments.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`)
  return result.stdout.trim()
}

const allowedReleaseCommitPaths = Object.freeze([
  'docs/generated/PLATFORM_SUPPORT.md',
  'evidence/v1/artifacts/',
  'evidence/v1/records/',
  'evidence/v1/releases/',
])

function isAllowedReleaseCommitPath(relativePath) {
  return allowedReleaseCommitPaths.some(allowed =>
    allowed.endsWith('/') ? relativePath.startsWith(allowed) : relativePath === allowed
  )
}

function verifyStableTagCommit(root, tag, sourceCommit) {
  if (!/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(tag))
    throw new Error('tag ancestry verification requires a stable vX.Y.Z tag')
  if (!/^[a-f0-9]{40}$/u.test(sourceCommit))
    throw new Error('tag ancestry verification requires a full source commit SHA')
  const tagCommit = requireGitOutput(root, ['rev-parse', `${tag}^{commit}`])
  if (sourceCommit === tagCommit)
    throw new Error('stable tag commit must be an evidence-only descendant of the tested source commit')
  const sourceAncestry = git(root, ['merge-base', '--is-ancestor', sourceCommit, tagCommit])
  if (sourceAncestry.status !== 0)
    throw new Error(`tested source commit ${sourceCommit} is not an ancestor of stable tag commit ${tagCommit}`)
  const changedPaths = requireGitOutput(root, ['diff', '--name-status', '--no-renames', sourceCommit, tagCommit])
  for (const line of changedPaths.split('\n').filter(Boolean)) {
    const separator = line.indexOf('\t')
    if (separator < 1) throw new Error(`cannot parse stable release commit change: ${line}`)
    const status = line.slice(0, separator)
    const relativePath = line.slice(separator + 1)
    if (!['A', 'M'].includes(status))
      throw new Error(`stable release commit may not ${status} path ${relativePath}`)
    if (!isAllowedReleaseCommitPath(relativePath))
      throw new Error(`stable release commit changed non-release path ${relativePath}`)
  }
  if (changedPaths.length === 0) throw new Error('stable release commit contains no evidence or generated support change')
  const masterAncestry = git(root, ['merge-base', '--is-ancestor', tagCommit, 'refs/remotes/origin/master'])
  if (masterAncestry.error) throw new Error(`cannot verify tag/master ancestry: ${masterAncestry.error.message}`)
  if (masterAncestry.status !== 0)
    throw new Error(`tag commit ${tagCommit} is not an ancestor of refs/remotes/origin/master`)
  return { sourceCommit, tagCommit }
}

function generatedPublishArtifact(root, relativePath) {
  const absolutePath = repositoryPath(root, relativePath, '')
  const stat = fs.lstatSync(absolutePath)
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error(`publish tarball must be a regular non-symbolic-link file: ${relativePath}`)
  return {
    fileName: path.basename(relativePath),
    sha256: crypto.createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex')
  }
}

function approvedCiFromRun(run, runId) {
  if (run === null || typeof run !== 'object' || Array.isArray(run))
    throw new Error(`approved CI run ${String(runId)} must be a JSON object`)
  if (run.status !== 'completed' || run.conclusion !== 'success')
    throw new Error(`approved CI run ${String(runId)} is not a completed successful run`)
  if (run.path !== '.github/workflows/ci.yml')
    throw new Error(`approved CI run ${String(runId)} does not use .github/workflows/ci.yml`)
  if (run.id !== runId) throw new Error(`approved CI response does not match run ${String(runId)}`)
  if (typeof run.head_sha !== 'string' || !/^[a-f0-9]{40}$/u.test(run.head_sha))
    throw new Error(`approved CI run ${String(runId)} does not report a full commit SHA`)
  if (typeof run.html_url !== 'string') throw new Error(`approved CI run ${String(runId)} does not report a run URL`)
  return {
    workflowPath: run.path,
    runId: run.id,
    runUrl: run.html_url,
    headCommit: run.head_sha,
    conclusion: run.conclusion
  }
}

function verifiedApprovedCi(release) {
  const repository = process.env.GITHUB_REPOSITORY
  if (typeof repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository))
    throw new Error('GITHUB_REPOSITORY must identify the current GitHub repository')
  const runId = release?.approvedCi?.runId
  if (!Number.isInteger(runId) || runId < 1)
    throw new Error('stable release manifest approvedCi.runId must be a positive integer')
  const result = spawnSync('gh', ['api', '--method', 'GET', `repos/${repository}/actions/runs/${String(runId)}`], {
    encoding: 'utf8',
    shell: false
  })
  if (result.error) throw new Error(`cannot start gh for approved CI verification: ${result.error.message}`)
  if (result.status !== 0)
    throw new Error(`cannot verify approved CI run ${String(runId)}: ${(result.stderr || result.stdout || '').trim()}`)
  let run
  try {
    run = JSON.parse(result.stdout)
  } catch (error) {
    throw new Error(`approved CI run ${String(runId)} returned invalid JSON: ${error.message}`)
  }
  return approvedCiFromRun(run, runId)
}

function main() {
  try {
    const options = parseArguments(process.argv.slice(2))
    const root = process.cwd()
    const releaseManifestPath = repositoryPath(root, options.releaseManifest, 'evidence/v1/releases')
    const release = readContainedJson(root, releaseManifestPath)
    const packageJsonPath = repositoryPath(root, options.packageJson, '')
    const packageJson = readContainedJson(root, packageJsonPath)
    const records = readRecords(root, options.recordsDirectory)
    const tag = verifyStableTagCommit(root, options.tag, release.sourceCommit)
    const approvedCi = verifiedApprovedCi(release)
    const publishArtifact = generatedPublishArtifact(root, options.publishTarball)
    const errors = validateStableRelease(release, records, root, {
      tag: options.tag,
      tagCommit: tag.tagCommit,
      verifiedSourceCommit: tag.sourceCommit,
      package: { name: packageJson.name, version: packageJson.version },
      approvedCi,
      publishArtifact
    })
    if (errors.length > 0) {
      errors.forEach(error => console.error(`[validateStableRelease] ${error}`))
      process.exitCode = 1
      return
    }
    console.log(`Stable release evidence gate passed for ${release.packageName}@${release.version} (${release.tag}).`)
  } catch (error) {
    fail(error.message)
  }
}

if (require.main === module) main()

module.exports = {
  approvedCiFromRun,
  generatedPublishArtifact,
  parseArguments,
  readRecords,
  validateStableRelease,
  verifyStableTagCommit,
  verifiedApprovedCi
}
