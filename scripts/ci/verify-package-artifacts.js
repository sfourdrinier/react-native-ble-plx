// scripts/ci/verify-package-artifacts.js

'use strict'

const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '../..')
const sourceRoot = path.join(root, 'src')
const outputRoot = path.join(root, 'lib')
const pluginSourceRoot = path.join(root, 'plugin', 'src')
const pluginOutputRoot = path.join(root, 'plugin', 'build')
const packageJson = require(path.join(root, 'package.json'))
const {
  assertNoForbiddenNobleManifestDependencies,
  assertNoForbiddenNobleRuntimeReferences
} = require('./forbidden-runtime-dependencies')

/** Exact declaration-only source emitted by the React Native Codegen/type build. */
const internalTypeOnlySourceFiles = Object.freeze([])

/** Exact private runtime modules needed by the public React Native host entrypoint. */
const internalRuntimeSourceFiles = Object.freeze([
  'NativeUnifiedBleProtocolControl.ts',
  'native-protocol/generated/native-protocol-v1-schema.ts',
  'native-protocol/rn-apple-boundary.ts',
  'native-protocol/rn-android-boundary.ts',
  'native-protocol/rn-android-protocol-records.ts',
  'native-protocol/rn-jsi-binary-runtime.ts',
  'react-native-manager.ts',
  'native-protocol/v1-codec.ts'
])

const publicProfileSourceFiles = Object.freeze([
  'profiles/battery-service.ts',
  'profiles/blood-pressure.ts',
  'profiles/bytes.ts',
  'profiles/commands.ts',
  'profiles/date-time.ts',
  'profiles/device-information.ts',
  'profiles/errors.ts',
  'profiles/heart-rate.ts',
  'profiles/health-thermometer.ts',
  'profiles/identifiers.ts',
  'profiles/ieee-11073.ts',
  'profiles/standard-commands.ts'
])

function relativeToRoot(filePath) {
  return path.relative(root, filePath).split(path.sep).join('/')
}

function listFiles(directory) {
  if (!fs.existsSync(directory)) {
    throw new Error(`Expected directory is missing: ${relativeToRoot(directory)}`)
  }

  const files = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...listFiles(entryPath))
      continue
    }
    if (entry.isFile()) {
      files.push(entryPath)
      continue
    }
    throw new Error(`Unsupported non-file artifact: ${relativeToRoot(entryPath)}`)
  }
  return files
}

function assertInsideRoot(relativePath, label) {
  if (typeof relativePath !== 'string' || path.isAbsolute(relativePath)) {
    throw new Error(`${label} must be a non-absolute package-relative path: ${String(relativePath)}`)
  }
  const target = path.resolve(root, relativePath)
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${label} escapes the package root: ${relativePath}`)
  }
  return target
}

function assertExistingTarget(relativePath, label) {
  const target = assertInsideRoot(relativePath, label)
  if (!fs.existsSync(target)) {
    throw new Error(`${label} is missing: ${relativePath}`)
  }
}

function collectExportTargets(value, label, targets) {
  if (typeof value === 'string') {
    targets.push({ label, path: value })
    return
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must resolve to a package-relative string or conditional object`)
  }
  for (const [condition, target] of Object.entries(value)) {
    collectExportTargets(target, `${label}.${condition}`, targets)
  }
}

function sourceArtifactPaths(sourceFile) {
  const sourceRelative = path.relative(sourceRoot, sourceFile).split(path.sep).join('/')
  const basename = sourceRelative.replace(/\.(?:ts|tsx)$/, '')
  return [
    `commonjs/${basename}.js`,
    `commonjs/${basename}.js.map`,
    `module/${basename}.js`,
    `module/${basename}.js.map`,
    `typescript/commonjs/src/${basename}.d.ts`,
    `typescript/commonjs/src/${basename}.d.ts.map`,
    `typescript/module/src/${basename}.d.ts`,
    `typescript/module/src/${basename}.d.ts.map`
  ]
}

function declarationArtifactPaths(sourceFile) {
  const sourceRelative = path.relative(sourceRoot, sourceFile).split(path.sep).join('/')
  const basename = sourceRelative.replace(/\.(?:ts|tsx)$/, '')
  return [
    `typescript/commonjs/src/${basename}.d.ts`,
    `typescript/commonjs/src/${basename}.d.ts.map`,
    `typescript/module/src/${basename}.d.ts`,
    `typescript/module/src/${basename}.d.ts.map`
  ]
}

function internalTypeArtifactPaths(sourceRelative) {
  const basename = sourceRelative.replace(/\.ts$/, '')
  return [
    `typescript/commonjs/src/${basename}.d.ts`,
    `typescript/commonjs/src/${basename}.d.ts.map`,
    `typescript/module/src/${basename}.d.ts`,
    `typescript/module/src/${basename}.d.ts.map`
  ]
}

function isPublishedSourceFile(sourceFile) {
  const sourceRelative = path.relative(sourceRoot, sourceFile).split(path.sep).join('/')
  if (
    sourceRelative === 'index.ts' ||
    sourceRelative === 'implementation-version.ts' ||
    sourceRelative === 'backend-sdk.ts' ||
    sourceRelative === 'backend-sdk-authoring.ts' ||
    sourceRelative === 'cli.ts' ||
    sourceRelative === 'cli-json.ts' ||
    sourceRelative === 'codecs-primitives.ts' ||
    sourceRelative === 'codecs.ts' ||
    sourceRelative === 'testing.ts' ||
    sourceRelative === 'web.ts' ||
    sourceRelative === 'react-native.ts' ||
    sourceRelative === 'node-bluez.ts' ||
    sourceRelative === 'node-corebluetooth.ts' ||
    sourceRelative === 'node-winrt.ts' ||
    sourceRelative === 'electron-main.ts' ||
    sourceRelative === 'electron-renderer.ts'
  ) {
    return true
  }
  if (publicProfileSourceFiles.includes(sourceRelative)) {
    return true
  }
  return /^(backend-contract|backends\/(?:bluez|corebluetooth|reactnative|winrt)|core|diagnostics|electron|manager|tck|testing|web)\/.+\.(?:ts|tsx)$/.test(
    sourceRelative
  )
}

function pluginArtifactPaths(sourceFile) {
  const sourceRelative = path.relative(pluginSourceRoot, sourceFile).split(path.sep).join('/')
  const basename = sourceRelative.replace(/\.ts$/, '')
  return [`${basename}.js`, `${basename}.d.ts`]
}

function assertNoPrivatePath(filePath) {
  const contents = fs.readFileSync(filePath, 'utf8')
  const forbiddenPaths = ['/Users/', '/home/', 'C:\\Users\\']
  for (const forbiddenPath of forbiddenPaths) {
    if (contents.includes(forbiddenPath)) {
      throw new Error(`Private local path found in ${relativeToRoot(filePath)}: ${forbiddenPath}`)
    }
  }
}

function main() {
  assertCliEntrypoint()
  assertNoForbiddenNobleManifestDependencies(packageJson, 'package.json')
  const sourceFiles = listFiles(sourceRoot)
    .filter(isPublishedSourceFile)
    .sort((left, right) => left.localeCompare(right))
  if (sourceFiles.length === 0) {
    throw new Error('No package TypeScript source files were found; refusing a zero-source build.')
  }
  const declarationSourceFiles = listFiles(sourceRoot)
    .filter(sourceFile => /\.ts$/.test(sourceFile) && !sourceFile.includes(`${path.sep}__tests__${path.sep}`))
    .sort((left, right) => left.localeCompare(right))

  const expected = new Set([
    'commonjs/package.json',
    'module/package.json',
    'typescript/commonjs/package.json',
    'typescript/module/package.json'
  ])
  for (const sourceFile of sourceFiles) {
    for (const artifactPath of sourceArtifactPaths(sourceFile)) {
      expected.add(artifactPath)
      const absoluteArtifactPath = path.join(outputRoot, artifactPath)
      if (!fs.existsSync(absoluteArtifactPath)) {
        throw new Error(
          `Missing generated artifact ${relativeToRoot(absoluteArtifactPath)} for ${relativeToRoot(sourceFile)}`
        )
      }
      if (fs.statSync(absoluteArtifactPath).mtimeMs < fs.statSync(sourceFile).mtimeMs) {
        throw new Error(
          `Stale generated artifact ${relativeToRoot(absoluteArtifactPath)} is older than ${relativeToRoot(sourceFile)}`
        )
      }
    }
  }
  for (const sourceFile of declarationSourceFiles) {
    for (const artifactPath of declarationArtifactPaths(sourceFile)) {
      expected.add(artifactPath)
      const absoluteArtifactPath = path.join(outputRoot, artifactPath)
      if (!fs.existsSync(absoluteArtifactPath)) {
        throw new Error(
          `Missing generated declaration artifact ${relativeToRoot(absoluteArtifactPath)} for ${relativeToRoot(sourceFile)}`
        )
      }
      if (fs.statSync(absoluteArtifactPath).mtimeMs < fs.statSync(sourceFile).mtimeMs) {
        throw new Error(
          `Stale generated declaration artifact ${relativeToRoot(absoluteArtifactPath)} is older than ${relativeToRoot(sourceFile)}`
        )
      }
    }
  }
  for (const sourceRelative of internalTypeOnlySourceFiles) {
    const sourceFile = path.join(sourceRoot, sourceRelative)
    if (!fs.existsSync(sourceFile)) {
      throw new Error(`Internal type-only source is missing: ${relativeToRoot(sourceFile)}`)
    }
    for (const artifactPath of internalTypeArtifactPaths(sourceRelative)) {
      expected.add(artifactPath)
      const absoluteArtifactPath = path.join(outputRoot, artifactPath)
      if (!fs.existsSync(absoluteArtifactPath)) {
        throw new Error(
          `Missing generated internal declaration artifact ${relativeToRoot(absoluteArtifactPath)} for ${relativeToRoot(sourceFile)}`
        )
      }
      if (fs.statSync(absoluteArtifactPath).mtimeMs < fs.statSync(sourceFile).mtimeMs) {
        throw new Error(
          `Stale generated internal declaration artifact ${relativeToRoot(absoluteArtifactPath)} is older than ${relativeToRoot(sourceFile)}`
        )
      }
    }
  }
  for (const sourceRelative of internalRuntimeSourceFiles) {
    const sourceFile = path.join(sourceRoot, sourceRelative)
    if (!fs.existsSync(sourceFile)) {
      throw new Error(`Internal runtime source is missing: ${relativeToRoot(sourceFile)}`)
    }
    for (const artifactPath of sourceArtifactPaths(sourceFile)) {
      expected.add(artifactPath)
      const absoluteArtifactPath = path.join(outputRoot, artifactPath)
      if (!fs.existsSync(absoluteArtifactPath)) {
        throw new Error(
          `Missing generated internal runtime artifact ${relativeToRoot(absoluteArtifactPath)} for ${relativeToRoot(sourceFile)}`
        )
      }
      if (fs.statSync(absoluteArtifactPath).mtimeMs < fs.statSync(sourceFile).mtimeMs) {
        throw new Error(
          `Stale generated internal runtime artifact ${relativeToRoot(absoluteArtifactPath)} is older than ${relativeToRoot(sourceFile)}`
        )
      }
    }
  }

  const actual = new Set(
    listFiles(outputRoot).map(filePath => path.relative(outputRoot, filePath).split(path.sep).join('/'))
  )
  const unexpected = [...actual].filter(filePath => !expected.has(filePath)).sort()
  const missing = [...expected].filter(filePath => !actual.has(filePath)).sort()
  if (unexpected.length > 0 || missing.length > 0) {
    throw new Error(
      `Generated artifact set does not match source-derived expectations. Missing: ${missing.join(', ') || 'none'}. Unexpected: ${unexpected.join(', ') || 'none'}.`
    )
  }

  for (const artifactPath of actual) {
    if (artifactPath.endsWith('.map')) {
      assertNoPrivatePath(path.join(outputRoot, artifactPath))
    }
  }

  const pluginSourceFiles = listFiles(pluginSourceRoot)
    .filter(filePath => /\.ts$/.test(filePath) && !filePath.includes(`${path.sep}__tests__${path.sep}`))
    .sort((left, right) => left.localeCompare(right))
  if (pluginSourceFiles.length === 0) {
    throw new Error('No config-plugin TypeScript source files were found; refusing a zero-source plugin build.')
  }

  const expectedPluginArtifacts = new Set()
  for (const sourceFile of pluginSourceFiles) {
    for (const artifactPath of pluginArtifactPaths(sourceFile)) {
      expectedPluginArtifacts.add(artifactPath)
      const absoluteArtifactPath = path.join(pluginOutputRoot, artifactPath)
      if (!fs.existsSync(absoluteArtifactPath)) {
        throw new Error(
          `Missing generated config-plugin artifact ${relativeToRoot(absoluteArtifactPath)} for ${relativeToRoot(sourceFile)}`
        )
      }
      if (fs.statSync(absoluteArtifactPath).mtimeMs < fs.statSync(sourceFile).mtimeMs) {
        throw new Error(
          `Stale generated config-plugin artifact ${relativeToRoot(absoluteArtifactPath)} is older than ${relativeToRoot(sourceFile)}`
        )
      }
    }
  }
  const actualPluginArtifacts = new Set(
    listFiles(pluginOutputRoot).map(filePath => path.relative(pluginOutputRoot, filePath).split(path.sep).join('/'))
  )
  const unexpectedPluginArtifacts = [...actualPluginArtifacts]
    .filter(filePath => !expectedPluginArtifacts.has(filePath))
    .sort()
  const missingPluginArtifacts = [...expectedPluginArtifacts]
    .filter(filePath => !actualPluginArtifacts.has(filePath))
    .sort()
  if (unexpectedPluginArtifacts.length > 0 || missingPluginArtifacts.length > 0) {
    throw new Error(
      `Generated config-plugin artifact set does not match source-derived expectations. Missing: ${missingPluginArtifacts.join(', ') || 'none'}. Unexpected: ${unexpectedPluginArtifacts.join(', ') || 'none'}.`
    )
  }
  for (const artifactPath of actualPluginArtifacts) {
    assertNoPrivatePath(path.join(pluginOutputRoot, artifactPath))
  }

  const runtimeFiles = [
    ...listFiles(sourceRoot),
    ...listFiles(outputRoot),
    ...listFiles(pluginOutputRoot),
    ...listFiles(path.join(root, 'bin')),
    ...listFiles(path.join(root, 'native', 'electron')),
    path.join(root, 'app.plugin.js')
  ].map(filePath => ({
    path: relativeToRoot(filePath),
    contents: fs.readFileSync(filePath, 'utf8')
  }))
  assertNoForbiddenNobleRuntimeReferences(runtimeFiles, 'published package runtime source/artifacts')

  const entryTargets = [
    { label: 'main', path: packageJson.main },
    { label: 'module', path: packageJson.module },
    { label: 'types', path: packageJson.types }
  ]
  for (const [exportPath, exportTarget] of Object.entries(packageJson.exports ?? {})) {
    collectExportTargets(exportTarget, `exports[${JSON.stringify(exportPath)}]`, entryTargets)
  }
  for (const target of entryTargets) {
    assertExistingTarget(target.path, target.label)
    if (
      [...internalTypeOnlySourceFiles, ...internalRuntimeSourceFiles].some(sourceFile =>
        target.path.includes(sourceFile.replace(/\.ts$/, ''))
      )
    ) {
      throw new Error(`Internal native-protocol source must not become a public package entrypoint: ${target.label}`)
    }
  }

  console.log(
    `package artifacts verified: ${sourceFiles.length} published source files; ${internalRuntimeSourceFiles.length} exact internal runtime sources; ${internalTypeOnlySourceFiles.length} exact internal declaration-only sources; ${actual.size} source-derived runtime, map, and declaration artifacts; ${pluginSourceFiles.length} config-plugin source files; ${actualPluginArtifacts.size} config-plugin artifacts; ${entryTargets.length} current entrypoint targets`
  )
}

function assertCliEntrypoint() {
  if (packageJson.bin === null || typeof packageJson.bin !== 'object' || Array.isArray(packageJson.bin)) {
    throw new Error('package bin must be an object')
  }
  const binEntries = Object.entries(packageJson.bin)
  if (binEntries.length !== 1 || binEntries[0]?.[0] !== 'ubm' || binEntries[0]?.[1] !== 'bin/ubm.js') {
    throw new Error('package bin must expose exactly ubm -> bin/ubm.js')
  }
  const entrypoint = assertInsideRoot('bin/ubm.js', 'CLI entrypoint')
  if (!fs.existsSync(entrypoint) || !fs.statSync(entrypoint).isFile()) {
    throw new Error('CLI entrypoint is missing: bin/ubm.js')
  }
  const source = fs.readFileSync(entrypoint, 'utf8')
  if (!source.startsWith('#!/usr/bin/env node\n// bin/ubm.js\n')) {
    throw new Error('CLI entrypoint must retain its Node shebang and path header')
  }
}

main()
