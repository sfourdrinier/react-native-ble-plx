#!/usr/bin/env node
// scripts/prepare-shim-pack.js
/**
 * Pack/publish helper for packages/react-native-ble-plx-shim without dirtying monorepo.
 *
 * Monorepo source keeps `dependencies.unified-ble-manager: "file:../.."`.
 * This tool copies the shim tree to a temp dir and rewrites that dep to the exact
 * root package version (semver) so Path B npm consumers resolve a real package.
 *
 * Usage:
 *   node scripts/prepare-shim-pack.js --print-dir
 *   node scripts/prepare-shim-pack.js --pack --output-dir <directory> [--dry-run]
 *   node scripts/prepare-shim-pack.js --assert-packed <package.json path>
 */
'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const SHIM_SRC = path.join(ROOT, 'packages', 'react-native-ble-plx-shim')

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

function isFileDependency(dep) {
  return typeof dep === 'string' && (dep.startsWith('file:') || dep.startsWith('..') || dep.includes('file:'))
}

function buildPublishableShimPackage() {
  const rootPkg = readJson(path.join(ROOT, 'package.json'))
  const shimPkg = readJson(path.join(SHIM_SRC, 'package.json'))
  const version = rootPkg.version
  return {
    ...shimPkg,
    version,
    dependencies: {
      ...(shimPkg.dependencies || {}),
      'unified-ble-manager': version
    }
  }
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function tarballName(packageJson) {
  return `${packageJson.name.replace(/^@/, '').replace('/', '-')}-${packageJson.version}.tgz`
}

function prepareDir() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ble-plx-shim-pack-'))
  try {
    for (const name of fs.readdirSync(SHIM_SRC)) {
      if (name === 'node_modules') continue
      fs.cpSync(path.join(SHIM_SRC, name), path.join(tmp, name), { recursive: true })
    }
    const publishable = buildPublishableShimPackage()
    if (isFileDependency(publishable.dependencies['unified-ble-manager'])) {
      throw new Error('prepare-shim-pack: refused file: dependency in publishable package.json')
    }
    fs.writeFileSync(path.join(tmp, 'package.json'), `${JSON.stringify(publishable, null, 2)}\n`)
    return tmp
  } catch (error) {
    try {
      removePreparedDirectory(tmp)
    } catch (cleanupError) {
      console.error('[prepare-shim-pack] Failed to remove incomplete temporary directory:', cleanupError)
    }
    throw error
  }
}

function removePreparedDirectory(directory) {
  const temporaryRoot = path.resolve(os.tmpdir())
  const resolvedDirectory = path.resolve(directory)
  const relative = path.relative(temporaryRoot, resolvedDirectory)
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    !path.basename(resolvedDirectory).startsWith('ble-plx-shim-pack-')
  ) {
    throw new Error(`Refusing to clean an unexpected prepared shim directory: ${resolvedDirectory}`)
  }
  fs.rmSync(resolvedDirectory, { recursive: true, force: true })
}

function validatePackedPackage(pkgPath) {
  const pkg = readJson(pkgPath)
  const dep = pkg.dependencies && pkg.dependencies['unified-ble-manager']
  const expectedVersion = buildPublishableShimPackage().version
  if (isFileDependency(dep) || typeof dep !== 'string' || dep !== expectedVersion) {
    throw new Error(
      `packed shim must depend on the exact unified-ble-manager version ${expectedVersion}, got: ${JSON.stringify(dep)}`
    )
  }
  if (pkg.version !== expectedVersion) {
    throw new Error(`packed shim version must equal canonical version ${expectedVersion}, got: ${JSON.stringify(pkg.version)}`)
  }
  return dep
}

function assertPacked(pkgPath) {
  const dependencyVersion = validatePackedPackage(pkgPath)
  console.log(`ok: unified-ble-manager@${dependencyVersion}`)
}

function assertPackDestinationEmpty(outputDirectory, packageJson) {
  const destination = path.resolve(outputDirectory)
  fs.mkdirSync(destination, { recursive: true })
  const tarballPath = path.join(destination, tarballName(packageJson))
  if (fs.existsSync(tarballPath)) {
    throw new Error(`Refusing to overwrite existing shim tarball: ${tarballPath}`)
  }
  return tarballPath
}

function packShimDirectory(directory, outputDirectory, dry) {
  const packageJson = readJson(path.join(directory, 'package.json'))
  const args = ['pack', '--loglevel=warn']
  let tarballPath = null
  if (dry) {
    args.push('--dry-run')
  } else {
    tarballPath = assertPackDestinationEmpty(outputDirectory, packageJson)
    args.push('--pack-destination', path.resolve(outputDirectory))
  }
  const result = spawnSync(npmCommand(), args, {
    cwd: directory,
    encoding: 'utf8',
    env: {
      ...process.env,
      NPM_CONFIG_CACHE: path.join(directory, '.npm-cache'),
      NPM_CONFIG_UPDATE_NOTIFIER: 'false'
    },
    shell: false
  })
  const output = `${result.stdout || ''}${result.stderr || ''}`
  if (result.error) {
    throw new Error(`npm pack could not start: ${result.error.message}`)
  }
  if (result.status !== 0) {
    throw new Error(`npm pack failed (${result.status}):\n${output}`)
  }
  if (/^(?:npm )?(?:WARN|warn)\b|^warning\b|^⚠/im.test(output)) {
    throw new Error(`npm pack produced a warning:\n${output}`)
  }
  process.stdout.write(output)
  if (!dry) {
    if (!tarballPath || !fs.existsSync(tarballPath)) {
      throw new Error(`npm pack did not create the expected shim tarball: ${String(tarballPath)}`)
    }
    return tarballPath
  }
  return null
}

function readOutputDirectory(argv) {
  const outputIndex = argv.indexOf('--output-dir')
  if (outputIndex === -1) return null
  const outputDirectory = argv[outputIndex + 1]
  if (!outputDirectory || outputDirectory.startsWith('--')) {
    throw new Error('usage: --output-dir <directory>')
  }
  return outputDirectory
}

function main(argv) {
  if (argv.includes('--assert-packed')) {
    const target = argv[argv.indexOf('--assert-packed') + 1]
    if (!target) {
      console.error('usage: --assert-packed <package.json>')
      process.exit(2)
    }
    assertPacked(target)
    return
  }

  if (argv.includes('--print-dir')) {
    process.stdout.write(`${prepareDir()}\n`)
    return
  }

  if (argv.includes('--pack')) {
    const dry = argv.includes('--dry-run')
    const outputDirectory = readOutputDirectory(argv)
    if (!dry && !outputDirectory) {
      throw new Error('prepare-shim-pack --pack requires --output-dir <directory> to avoid writing tarballs into the repository')
    }
    const dir = prepareDir()
    try {
      const tarballPath = packShimDirectory(dir, outputDirectory, dry)
      assertPacked(path.join(dir, 'package.json'))
      if (tarballPath) {
        console.log(`wrote ${tarballPath}`)
      }
    } finally {
      removePreparedDirectory(dir)
    }
    return
  }

  console.error(`usage:
  node scripts/prepare-shim-pack.js --print-dir
  node scripts/prepare-shim-pack.js --pack --output-dir <directory> [--dry-run]
  node scripts/prepare-shim-pack.js --assert-packed <package.json>`)
  process.exit(2)
}

if (require.main === module) {
  main(process.argv.slice(2))
}

module.exports = {
  buildPublishableShimPackage,
  isFileDependency,
  prepareDir,
  removePreparedDirectory,
  tarballName,
  validatePackedPackage,
  assertPacked,
  assertPackDestinationEmpty,
  packShimDirectory
}
