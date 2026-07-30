// scripts/ci/forbidden-runtime-dependencies.js

'use strict'

const forbiddenNoblePackageNames = Object.freeze([
  'noble',
  '@abandonware/noble',
  '@stoprocent/noble'
])

const runtimeDependencyFields = Object.freeze([
  'dependencies',
  'optionalDependencies',
  'peerDependencies'
])

function isRuntimePackageFile(filePath) {
  const normalizedPath = filePath.replace(/\\/g, '/')
  if (
    normalizedPath.endsWith('.d.ts') ||
    normalizedPath.includes('/__tests__/') ||
    normalizedPath.includes('/__fixtures__/')
  ) {
    return false
  }
  if (normalizedPath === 'app.plugin.js' || normalizedPath === 'package/app.plugin.js') {
    return true
  }
  return /^(?:package\/)?(?:bin|lib|src|plugin\/build|native)\/.+\.(?:[cm]?js|tsx?)$/.test(normalizedPath)
}

function assertNoForbiddenNobleManifestDependencies(packageJson, label) {
  for (const field of runtimeDependencyFields) {
    const dependencies = packageJson[field]
    if (dependencies === undefined) {
      continue
    }
    if (dependencies === null || typeof dependencies !== 'object' || Array.isArray(dependencies)) {
      throw new Error(`${label}.${field} must be an object when present`)
    }
    for (const packageName of forbiddenNoblePackageNames) {
      if (Object.hasOwn(dependencies, packageName)) {
        throw new Error(`${label}.${field} must not declare forbidden Noble runtime dependency ${packageName}`)
      }
    }
  }

  const bundledDependencies = packageJson.bundleDependencies ?? packageJson.bundledDependencies
  if (bundledDependencies === undefined) {
    return
  }
  if (!Array.isArray(bundledDependencies)) {
    throw new Error(`${label}.bundleDependencies must be an array when present`)
  }
  for (const packageName of forbiddenNoblePackageNames) {
    if (bundledDependencies.includes(packageName)) {
      throw new Error(`${label}.bundleDependencies must not bundle forbidden Noble runtime dependency ${packageName}`)
    }
  }
}

function assertNoForbiddenNobleRuntimeReferences(files, label) {
  for (const file of files) {
    if (!isRuntimePackageFile(file.path)) {
      continue
    }
    const contents = Buffer.isBuffer(file.contents) ? file.contents.toString('utf8') : file.contents
    if (typeof contents !== 'string') {
      throw new Error(`${label} contains non-text runtime file ${file.path}`)
    }
    for (const packageName of forbiddenNoblePackageNames) {
      const escapedPackageName = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const quotedSpecifier = new RegExp(`['\"]${escapedPackageName}['\"]`, 'u')
      if (quotedSpecifier.test(contents)) {
        throw new Error(`${label} must not reference forbidden Noble runtime package ${packageName}: ${file.path}`)
      }
    }
  }
}

module.exports = {
  assertNoForbiddenNobleManifestDependencies,
  assertNoForbiddenNobleRuntimeReferences,
  forbiddenNoblePackageNames,
  isRuntimePackageFile
}
