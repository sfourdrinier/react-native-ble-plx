// scripts/release/generate-dependency-artifacts.js

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { parse: parseYaml } = require('yaml')

const repositoryRoot = path.resolve(__dirname, '..', '..')
const artifactNames = ['SBOM.cdx.json', 'THIRD_PARTY_LICENSES.json']
const allowedLicenses = new Set([
  '(AFL-2.1 OR BSD-3-Clause)',
  '(Apache-2.0 OR MIT)',
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

function normalizeLicense(license) {
  if (license === 'MIT/X11') return 'MIT'
  if (license === 'Apache2') return 'Apache-2.0'
  return license
}

function declaredLicense(packageJson) {
  const declaration = packageJson.license
  if (typeof declaration === 'string') return normalizeLicense(declaration)
  if (
    declaration &&
    typeof declaration === 'object' &&
    !Array.isArray(declaration) &&
    typeof declaration.type === 'string'
  ) {
    return normalizeLicense(declaration.type)
  }
  if (Array.isArray(declaration) && declaration.length > 0 && declaration.every(value => typeof value === 'string')) {
    const alternatives = [...new Set(declaration.map(normalizeLicense))].sort()
    return alternatives.length === 1 ? alternatives[0] : `(${alternatives.join(' OR ')})`
  }
  return 'Unknown'
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

function virtualStorePackages() {
  const packagesByName = new Map()
  const virtualStore = path.join(repositoryRoot, 'node_modules', '.pnpm')
  if (!fs.existsSync(virtualStore)) throw new Error('pnpm virtual store is missing; run pnpm install')

  const addCandidate = candidate => {
    if (fs.lstatSync(candidate).isSymbolicLink() || !fs.existsSync(path.join(candidate, 'package.json'))) return
    const identity = packageIdentity(candidate)
    const candidates = packagesByName.get(identity.packageJson.name) || []
    if (!candidates.some(existing => existing.packageJson.version === identity.packageJson.version)) {
      candidates.push(identity)
      packagesByName.set(identity.packageJson.name, candidates)
    }
  }

  for (const entry of fs.readdirSync(virtualStore).sort()) {
    const modulesDirectory = path.join(virtualStore, entry, 'node_modules')
    if (!fs.existsSync(modulesDirectory)) continue
    for (const child of fs.readdirSync(modulesDirectory).sort()) {
      const candidate = path.join(modulesDirectory, child)
      if (child.startsWith('@') && !fs.lstatSync(candidate).isSymbolicLink()) {
        for (const scopedChild of fs.readdirSync(candidate).sort()) {
          addCandidate(path.join(candidate, scopedChild))
        }
      } else {
        addCandidate(candidate)
      }
    }
  }
  return packagesByName
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

function versionFromReference(name, reference) {
  if (typeof reference !== 'string') throw new Error(`Invalid lockfile reference for ${name}`)
  const peerSuffix = reference.indexOf('(')
  const version = peerSuffix === -1 ? reference : reference.slice(0, peerSuffix)
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Unsupported production lockfile reference ${name}@${reference}`)
  }
  return version
}

function collectProductionGraph(rootPackage, lockfile) {
  if (!lockfile || typeof lockfile !== 'object' || !lockfile.importers || !lockfile.snapshots) {
    throw new Error('pnpm-lock.yaml does not contain importers and snapshots')
  }
  const rootImporter = lockfile.importers['.']
  if (!rootImporter) throw new Error('pnpm-lock.yaml has no root importer')

  const packagesByRef = new Map()
  const rootRef = purlFor(rootPackage.name, rootPackage.version)
  const dependenciesByRef = new Map([[rootRef, new Set()]])
  const visitedSnapshots = new Set()
  const queue = []

  for (const field of ['dependencies', 'optionalDependencies']) {
    for (const [name, resolution] of Object.entries(rootImporter[field] || {})) {
      if (!resolution || typeof resolution !== 'object' || typeof resolution.version !== 'string') {
        throw new Error(`Invalid root production resolution for ${name}`)
      }
      queue.push({ name, parentRef: rootRef, reference: resolution.version })
    }
  }

  for (let index = 0; index < queue.length; index += 1) {
    const request = queue[index]
    const version = versionFromReference(request.name, request.reference)
    const snapshotKey = `${request.name}@${request.reference}`
    const snapshot = lockfile.snapshots[snapshotKey]
    if (!snapshot || typeof snapshot !== 'object') {
      throw new Error(`Production dependency snapshot is missing: ${snapshotKey}`)
    }
    const bomRef = purlFor(request.name, version)
    dependenciesByRef.get(request.parentRef).add(bomRef)
    if (!packagesByRef.has(bomRef)) {
      packagesByRef.set(bomRef, { bomRef, name: request.name, version })
      dependenciesByRef.set(bomRef, new Set())
    }
    if (visitedSnapshots.has(snapshotKey)) continue
    visitedSnapshots.add(snapshotKey)

    for (const field of ['dependencies', 'optionalDependencies']) {
      for (const [dependencyName, reference] of Object.entries(snapshot[field] || {})) {
        queue.push({ name: dependencyName, parentRef: bomRef, reference })
      }
    }
  }

  return {
    dependenciesByRef,
    packages: [...packagesByRef.values()].sort((left, right) => left.bomRef.localeCompare(right.bomRef)),
  }
}

function auditProductionLicenses(packages) {
  const inventoryPath = path.join(repositoryRoot, 'THIRD_PARTY_LICENSES.json')
  const existingInventory = fs.existsSync(inventoryPath) ? readJson(inventoryPath) : { packages: [] }
  if (!Array.isArray(existingInventory.packages)) throw new Error('Invalid committed license inventory')
  const existingByRef = new Map(existingInventory.packages.map(entry => [entry.purl, entry]))
  const installedByName = virtualStorePackages()
  const audited = []

  for (const dependency of packages) {
    const existing = existingByRef.get(dependency.bomRef)
    const installed = (installedByName.get(dependency.name) || []).find(
      identity => identity.packageJson.version === dependency.version
    )
    let resolved
    if (installed) {
      resolved = resolveReviewedLicense(installed, declaredLicense(installed.packageJson))
      if (existing && existing.license !== resolved.license) {
        throw new Error(
          `Committed license drift for ${dependency.name}@${dependency.version}: ` +
            `${existing.license} does not match installed metadata ${resolved.license}`
        )
      }
    } else {
      if (!existing) {
        throw new Error(`Production license audit is missing for ${dependency.name}@${dependency.version}`)
      }
      const license = normalizeLicense(existing.license)
      if (!allowedLicenses.has(license)) {
        throw new Error(`Unreviewed production license ${license} for ${dependency.name}@${dependency.version}`)
      }
      resolved = { evidence: existing.evidence, license, source: existing.licenseSource }
    }

    audited.push({ ...dependency, evidence: resolved.evidence, license: resolved.license, licenseSource: resolved.source })
    existingByRef.delete(dependency.bomRef)
  }

  if (existingByRef.size > 0) {
    throw new Error(`License inventory contains stale packages: ${[...existingByRef.keys()].sort().join(', ')}`)
  }
  return audited
}

function componentName(name) {
  if (!name.startsWith('@')) return { name }
  const separator = name.indexOf('/')
  return { group: name.slice(0, separator), name: name.slice(separator + 1) }
}

function dependencyArtifacts() {
  const rootPackage = readJson(path.join(repositoryRoot, 'package.json'))
  const lockfileBytes = fs.readFileSync(path.join(repositoryRoot, 'pnpm-lock.yaml'))
  const lockfile = parseYaml(lockfileBytes.toString('utf8'))
  const graph = collectProductionGraph(rootPackage, lockfile)
  const dependenciesByRef = graph.dependenciesByRef
  const packages = auditProductionLicenses(graph.packages)
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
    dependencies: [...dependenciesByRef.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([ref, dependencies]) => ({ ref, dependsOn: [...dependencies].sort() })),
  }

  const inventory = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    schema: 'unified-ble-manager/third-party-license-inventory',
    schemaVersion: '1.0.0',
    package: { name: rootPackage.name, version: rootPackage.version },
    source: {
      method: 'pnpm-lock production graph with installed-manifest license audit',
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
