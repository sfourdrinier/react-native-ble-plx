// scripts/release/generate-dependency-artifacts.js

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const repositoryRoot = path.resolve(__dirname, '..', '..')
const artifactNames = ['SBOM.cdx.json', 'THIRD_PARTY_LICENSES.json']
const allowedLicenses = new Set([
  '(AFL-2.1 OR BSD-3-Clause)',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BlueOak-1.0.0',
  'CC-BY-4.0',
  'ISC',
  'MIT',
  'Unlicense',
])

const reviewedLicenseOverrides = Object.freeze({
  'jsbi@2.0.5': Object.freeze({
    fileName: 'LICENSE',
    license: 'Apache-2.0',
    sha256: '9568a2b155e66ac3e0ba1fd80b52b827b9460e6cf6f233125e7cbca8e206ddc3',
  }),
  'map-stream@0.1.0': Object.freeze({
    fileName: 'LICENCE',
    license: 'MIT',
    sha256: '8937affb1fac84258c98aa2351eb161405999975b602140c43bcbac23b22f1e9',
  }),
})

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function parseArguments(argv) {
  let check = false
  let outputDirectory = repositoryRoot

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--check') {
      check = true
      continue
    }
    if (argument === '--output-directory') {
      const value = argv[index + 1]
      if (!value) throw new Error('--output-directory requires a path')
      outputDirectory = path.resolve(value)
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${argument}`)
  }

  if (check && outputDirectory !== repositoryRoot) {
    throw new Error('--check cannot be combined with --output-directory')
  }
  return { check, outputDirectory }
}

function productionLicenseReport() {
  const executable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const result = spawnSync(executable, ['licenses', 'list', '--json', '--prod'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${String(result.status)}`
    throw new Error(`pnpm production license inventory failed: ${detail}`)
  }
  return JSON.parse(result.stdout)
}

function normalizeLicense(license) {
  if (license === 'MIT/X11') return 'MIT'
  return license
}

function packageIdentity(packageDirectory) {
  const packageJsonPath = path.join(packageDirectory, 'package.json')
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`License inventory path has no package.json: ${packageDirectory}`)
  }
  const packageJson = readJson(packageJsonPath)
  if (typeof packageJson.name !== 'string' || typeof packageJson.version !== 'string') {
    throw new Error(`Invalid dependency package identity: ${packageJsonPath}`)
  }
  return { packageDirectory, packageJson }
}

function resolveReviewedLicense(identity, reportedLicense) {
  const key = `${identity.packageJson.name}@${identity.packageJson.version}`
  if (reportedLicense !== 'Unknown') {
    const normalized = normalizeLicense(reportedLicense)
    if (!allowedLicenses.has(normalized)) {
      throw new Error(`Unreviewed production license ${normalized} for ${key}`)
    }
    return { license: normalized, source: 'package-metadata' }
  }

  const override = reviewedLicenseOverrides[key]
  if (!override) throw new Error(`Unresolved production license for ${key}`)
  const licensePath = path.join(identity.packageDirectory, override.fileName)
  if (!fs.existsSync(licensePath)) throw new Error(`Reviewed license evidence is missing for ${key}: ${override.fileName}`)
  const actualSha256 = sha256(fs.readFileSync(licensePath))
  if (actualSha256 !== override.sha256) {
    throw new Error(`Reviewed license evidence changed for ${key}; audit the new file before updating the override`)
  }
  return {
    evidence: { fileName: override.fileName, sha256: override.sha256 },
    license: override.license,
    source: 'reviewed-installed-license-file',
  }
}

function purlFor(name, version) {
  const segments = name.startsWith('@') ? name.split('/') : [name]
  const encodedName = segments.map(segment => encodeURIComponent(segment)).join('/')
  return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`
}

function collectPackages(report) {
  const packagesByRef = new Map()
  for (const [reportedLicense, entries] of Object.entries(report)) {
    if (!Array.isArray(entries)) throw new Error(`Invalid pnpm license group: ${reportedLicense}`)
    for (const entry of entries) {
      if (!Array.isArray(entry.paths) || entry.paths.length === 0) {
        throw new Error(`Production dependency has no installed audit path: ${entry.name}`)
      }
      for (const packageDirectory of entry.paths) {
        const identity = packageIdentity(packageDirectory)
        const name = identity.packageJson.name
        const version = identity.packageJson.version
        const bomRef = purlFor(name, version)
        const resolvedLicense = resolveReviewedLicense(identity, reportedLicense)
        const existing = packagesByRef.get(bomRef)
        if (existing && existing.license !== resolvedLicense.license) {
          throw new Error(`Conflicting licenses for ${name}@${version}: ${existing.license} and ${resolvedLicense.license}`)
        }
        packagesByRef.set(bomRef, {
          bomRef,
          description: typeof identity.packageJson.description === 'string' ? identity.packageJson.description : undefined,
          evidence: resolvedLicense.evidence,
          homepage: typeof identity.packageJson.homepage === 'string' ? identity.packageJson.homepage : undefined,
          license: resolvedLicense.license,
          licenseSource: resolvedLicense.source,
          name,
          version,
        })
      }
    }
  }
  return [...packagesByRef.values()].sort((left, right) => left.bomRef.localeCompare(right.bomRef))
}

function componentName(name) {
  if (!name.startsWith('@')) return { name }
  const separator = name.indexOf('/')
  return { group: name.slice(0, separator), name: name.slice(separator + 1) }
}

function dependencyArtifacts() {
  const rootPackage = readJson(path.join(repositoryRoot, 'package.json'))
  const lockfileBytes = fs.readFileSync(path.join(repositoryRoot, 'pnpm-lock.yaml'))
  const packages = collectPackages(productionLicenseReport())
  const rootPurl = purlFor(rootPackage.name, rootPackage.version)

  const components = packages.map(dependency => {
    const component = {
      type: 'library',
      'bom-ref': dependency.bomRef,
      ...componentName(dependency.name),
      version: dependency.version,
      licenses: [{ expression: dependency.license }],
      purl: dependency.bomRef,
      properties: [
        { name: 'unified-ble-manager:license-source', value: dependency.licenseSource },
      ],
    }
    if (dependency.description) component.description = dependency.description
    if (dependency.homepage) {
      component.externalReferences = [{ type: 'website', url: dependency.homepage }]
    }
    return component
  })

  const sbom = {
    $schema: 'https://cyclonedx.org/schema/bom-1.6.schema.json',
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    version: 1,
    metadata: {
      component: {
        type: 'library',
        'bom-ref': rootPurl,
        name: rootPackage.name,
        version: rootPackage.version,
        licenses: [{ expression: rootPackage.license }],
        purl: rootPurl,
      },
      properties: [
        { name: 'unified-ble-manager:pnpm-lock-sha256', value: sha256(lockfileBytes) },
        { name: 'unified-ble-manager:dependency-scope', value: 'production-and-optional-runtime' },
      ],
    },
    components,
    dependencies: [
      { ref: rootPurl, dependsOn: packages.map(dependency => dependency.bomRef) },
      ...packages.map(dependency => ({ ref: dependency.bomRef, dependsOn: [] })),
    ],
  }

  const inventory = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    schema: 'unified-ble-manager/third-party-license-inventory',
    schemaVersion: '1.0.0',
    package: { name: rootPackage.name, version: rootPackage.version },
    source: {
      command: 'pnpm licenses list --json --prod',
      lockfile: 'pnpm-lock.yaml',
      lockfileSha256: sha256(lockfileBytes),
    },
    reviewedOverrides: Object.entries(reviewedLicenseOverrides).map(([dependency, override]) => ({
      dependency,
      fileName: override.fileName,
      license: override.license,
      sha256: override.sha256,
    })),
    unresolved: [],
    packages: packages.map(dependency => ({
      name: dependency.name,
      version: dependency.version,
      license: dependency.license,
      licenseSource: dependency.licenseSource,
      ...(dependency.evidence ? { evidence: dependency.evidence } : {}),
      purl: dependency.bomRef,
    })),
  }

  return new Map([
    ['SBOM.cdx.json', `${JSON.stringify(sbom, null, 2)}\n`],
    ['THIRD_PARTY_LICENSES.json', `${JSON.stringify(inventory, null, 2)}\n`],
  ])
}

function run() {
  const { check, outputDirectory } = parseArguments(process.argv.slice(2))
  const artifacts = dependencyArtifacts()
  fs.mkdirSync(outputDirectory, { recursive: true })

  for (const fileName of artifactNames) {
    const expected = artifacts.get(fileName)
    const outputPath = path.join(outputDirectory, fileName)
    if (check) {
      if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, 'utf8') !== expected) {
        throw new Error(`${fileName} is stale; run pnpm release:artifacts`)
      }
    } else {
      fs.writeFileSync(outputPath, expected)
    }
  }

  process.stdout.write(
    check
      ? `release dependency artifacts are current (${String(artifacts.size)} files)\n`
      : `generated ${String(artifacts.size)} release dependency artifacts in ${outputDirectory}\n`
  )
}

run()
