// scripts/ci/verify-package-tarballs.js

'use strict'

const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const root = path.resolve(__dirname, '../..')
const sourceRoot = path.join(root, 'src')
const pluginSourceRoot = path.join(root, 'plugin', 'src')
const shimSourceRoot = path.join(root, 'packages', 'react-native-ble-plx-shim')

/** Exact declaration-only source emitted by the React Native Codegen/type build. */
const internalTypeOnlySourceFiles = Object.freeze(['NativeUnifiedBleProtocolControl.ts'])

/** Exact private runtime modules required by the public React Native host entrypoint. */
const internalRuntimeSourceFiles = Object.freeze([
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

function listFiles(directory) {
  const files = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...listFiles(entryPath))
    } else if (entry.isFile()) {
      files.push(entryPath)
    } else {
      throw new Error(`Unsupported non-file source entry: ${entryPath}`)
    }
  }
  return files
}

function readNullTerminated(buffer) {
  const terminator = buffer.indexOf(0)
  return buffer.subarray(0, terminator === -1 ? buffer.length : terminator).toString('utf8')
}

function readOctal(buffer) {
  const raw = readNullTerminated(buffer).trim()
  return raw === '' ? 0 : Number.parseInt(raw, 8)
}

function readTarball(tarballPath) {
  const archive = zlib.gunzipSync(fs.readFileSync(tarballPath))
  const files = new Map()
  let offset = 0

  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    const name = readNullTerminated(header.subarray(0, 100))
    const prefix = readNullTerminated(header.subarray(345, 500))
    const entryPath = prefix ? `${prefix}/${name}` : name
    const type = header[156]
    const size = readOctal(header.subarray(124, 136))
    const contentStart = offset + 512
    const contentEnd = contentStart + size
    if (!entryPath.startsWith('package/') || entryPath.includes('../')) {
      throw new Error(`Invalid tarball entry path: ${entryPath}`)
    }
    if (type !== 0 && type !== 48) {
      throw new Error(`Unsupported non-file tarball entry: ${entryPath}`)
    }
    if (contentEnd > archive.length) {
      throw new Error(`Truncated tarball entry: ${entryPath}`)
    }
    if (files.has(entryPath)) {
      throw new Error(`Duplicate tarball entry: ${entryPath}`)
    }
    files.set(entryPath, archive.subarray(contentStart, contentEnd))
    offset = contentStart + Math.ceil(size / 512) * 512
  }

  return files
}

function packagePath(target, label) {
  if (typeof target !== 'string' || path.isAbsolute(target)) {
    throw new Error(`${label} must be a non-absolute package-relative path`)
  }
  const normalized = path.posix.normalize(target).replace(/^\.\//, '')
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`${label} escapes the package: ${target}`)
  }
  return `package/${normalized}`
}

function collectTargets(value, label, targets) {
  if (typeof value === 'string') {
    targets.push({ label, target: value })
    return
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a package path or a conditional export object`)
  }
  for (const [condition, target] of Object.entries(value)) {
    collectTargets(target, `${label}.${condition}`, targets)
  }
}

function sourceArtifactPaths(sourceFile) {
  const sourceRelative = path.relative(sourceRoot, sourceFile).split(path.sep).join('/')
  const basename = sourceRelative.replace(/\.(?:ts|tsx)$/, '')
  return [
    `lib/commonjs/${basename}.js`,
    `lib/commonjs/${basename}.js.map`,
    `lib/module/${basename}.js`,
    `lib/module/${basename}.js.map`,
    `lib/typescript/commonjs/src/${basename}.d.ts`,
    `lib/typescript/commonjs/src/${basename}.d.ts.map`,
    `lib/typescript/module/src/${basename}.d.ts`,
    `lib/typescript/module/src/${basename}.d.ts.map`
  ]
}

function declarationArtifactPaths(sourceFile) {
  const sourceRelative = path.relative(sourceRoot, sourceFile).split(path.sep).join('/')
  const basename = sourceRelative.replace(/\.(?:ts|tsx)$/, '')
  return [
    `lib/typescript/commonjs/src/${basename}.d.ts`,
    `lib/typescript/commonjs/src/${basename}.d.ts.map`,
    `lib/typescript/module/src/${basename}.d.ts`,
    `lib/typescript/module/src/${basename}.d.ts.map`
  ]
}

function internalTypeArtifactPaths(sourceRelative) {
  const basename = sourceRelative.replace(/\.ts$/, '')
  return [
    `lib/typescript/commonjs/src/${basename}.d.ts`,
    `lib/typescript/commonjs/src/${basename}.d.ts.map`,
    `lib/typescript/module/src/${basename}.d.ts`,
    `lib/typescript/module/src/${basename}.d.ts.map`
  ]
}

function isPublishedSourceFile(sourceFile) {
  const sourceRelative = path.relative(sourceRoot, sourceFile).split(path.sep).join('/')
  if (
    sourceRelative === 'index.ts' ||
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
  return [`plugin/build/${basename}.js`, `plugin/build/${basename}.d.ts`]
}

function assertNoPrivatePath(entryPath, contents) {
  const text = contents.toString('utf8')
  for (const privatePath of ['/Users/', '/home/', 'C:\\Users\\']) {
    if (text.includes(privatePath)) {
      throw new Error(`Private local path found in packed artifact ${entryPath}: ${privatePath}`)
    }
  }
}

function assertExactObjectKeys(value, expectedKeys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  const actualKeys = Object.keys(value).sort()
  const sortedExpectedKeys = [...expectedKeys].sort()
  if (
    actualKeys.length !== sortedExpectedKeys.length ||
    actualKeys.some((key, index) => key !== sortedExpectedKeys[index])
  ) {
    throw new Error(
      `${label} must have exactly these keys: ${sortedExpectedKeys.join(', ')}; received: ${actualKeys.join(', ')}`
    )
  }
}

function assertExactShimManifest(packageJson, canonicalVersion) {
  if (packageJson.name !== '@sfourdrinier/react-native-ble-plx') {
    throw new Error(`Expected shim package name, received ${String(packageJson.name)}`)
  }
  if (packageJson.version !== canonicalVersion) {
    throw new Error(
      `Packed shim version must equal canonical version ${canonicalVersion}, received ${String(packageJson.version)}`
    )
  }
  const canonicalDependency = packageJson.dependencies?.['unified-ble-manager']
  if (typeof canonicalDependency !== 'string' || canonicalDependency !== canonicalVersion) {
    throw new Error(
      `Packed shim must depend on exact canonical version ${canonicalVersion}, received ${String(canonicalDependency)}`
    )
  }
  for (const [field, expected] of [
    ['main', 'index.js'],
    ['types', 'index.d.ts'],
    ['react-native', 'index.js']
  ]) {
    if (packageJson[field] !== expected) {
      throw new Error(`Packed shim ${field} must equal ${expected}, received ${String(packageJson[field])}`)
    }
  }
  assertExactObjectKeys(packageJson.exports, ['.', './app.plugin.js', './package.json'], 'Packed shim exports')
  const rootExport = packageJson.exports['.']
  assertExactObjectKeys(rootExport, ['types', 'react-native', 'default'], 'Packed shim root export')
  for (const [condition, expected] of [
    ['types', './index.d.ts'],
    ['react-native', './index.js'],
    ['default', './index.js']
  ]) {
    if (rootExport[condition] !== expected) {
      throw new Error(
        `Packed shim root export ${condition} must equal ${expected}, received ${String(rootExport[condition])}`
      )
    }
  }
  if (packageJson.exports['./app.plugin.js'] !== './app.plugin.js') {
    throw new Error('Packed shim app.plugin.js export must equal ./app.plugin.js')
  }
  if (packageJson.exports['./package.json'] !== './package.json') {
    throw new Error('Packed shim package.json export must equal ./package.json')
  }
}

function isRootArchiveEntryAllowed(entryPath, expectedArtifacts, expectedPluginArtifacts) {
  if (expectedArtifacts.has(entryPath) || expectedPluginArtifacts.has(entryPath)) {
    return true
  }
  const allowedFiles = new Set([
    'package/package.json',
    'package/README.md',
    'package/LICENSE',
    'package/MIGRATION_4.0.md',
    'package/ROADMAP.md',
    'package/ROADMAP.4.0.md',
    'package/app.plugin.js',
    'package/bin/ubm.js'
  ])
  if (allowedFiles.has(entryPath) || /^package\/[^/]+\.podspec$/.test(entryPath)) {
    return true
  }
  if (entryPath.startsWith('package/docs/')) {
    return !entryPath.startsWith('package/docs/evidence/g0/')
  }
  return (
    entryPath.startsWith('package/android/') ||
    entryPath.startsWith('package/ios/') ||
    entryPath.startsWith('package/native/')
  )
}

function verifyRootTarball(tarballPath) {
  const files = readTarball(tarballPath)
  const packageJsonBuffer = files.get('package/package.json')
  if (!packageJsonBuffer) {
    throw new Error('Packed canonical package is missing package.json')
  }
  const packageJson = JSON.parse(packageJsonBuffer.toString('utf8'))
  if (packageJson.name !== 'unified-ble-manager') {
    throw new Error(`Expected canonical package name unified-ble-manager, received ${String(packageJson.name)}`)
  }
  assertExactObjectKeys(packageJson.bin, ['ubm'], 'Packed canonical bin')
  if (packageJson.bin.ubm !== 'bin/ubm.js') {
    throw new Error(`Packed canonical ubm entrypoint must equal bin/ubm.js, received ${String(packageJson.bin.ubm)}`)
  }
  if (!files.has('package/bin/ubm.js')) {
    throw new Error('Packed canonical package is missing CLI entrypoint bin/ubm.js')
  }
  assertExactObjectKeys(packageJson.optionalDependencies, ['dbus-next'], 'Packed canonical optionalDependencies')
  if (packageJson.optionalDependencies['dbus-next'] !== '^0.10.2') {
    throw new Error(
      `Packed canonical dbus-next optional dependency must equal ^0.10.2, received ${String(packageJson.optionalDependencies['dbus-next'])}`
    )
  }
  if (packageJson.dependencies?.['dbus-next'] !== undefined) {
    throw new Error('Packed canonical dbus-next must remain an optional host dependency')
  }
  const requiredNativeInputs = [
    'package/native/protocol/CMakeLists.txt',
    'package/native/protocol/generated/NativeProtocolV1Schema.hpp',
    'package/native/protocol/include/NativeProtocolV1Codec.hpp',
    'package/native/protocol/include/NativeProtocolV1Registry.hpp',
    'package/native/protocol/include/OwnedBinaryPayloadStore.hpp',
    'package/native/protocol/include/OwnedJsiBinaryTransport.hpp',
    'package/native/protocol/schema/native-protocol-v1.json',
    'package/native/protocol/src/NativeProtocolV1Codec.cpp',
    'package/native/protocol/src/NativeProtocolV1Registry.cpp',
    'package/native/protocol/src/OwnedBinaryPayloadStore.cpp',
    'package/native/protocol/src/OwnedJsiBinaryTransport.cpp',
    'package/android/src/main/jni/CMakeLists.txt',
    'package/android/src/main/java/com/sfourdrinier/unifiedblemanager/protocol/generated/NativeProtocolV1Schema.kt',
    'package/ios/Generated/NativeProtocolV1Schema.swift'
  ]
  for (const requiredInput of requiredNativeInputs) {
    if (!files.has(requiredInput)) {
      throw new Error(`Packed canonical package is missing native protocol input: ${requiredInput}`)
    }
  }

  const sourceFiles = listFiles(sourceRoot).filter(isPublishedSourceFile)
  if (sourceFiles.length === 0) {
    throw new Error('No TypeScript source files found while verifying packed canonical package')
  }
  const declarationSourceFiles = listFiles(sourceRoot)
    .filter(sourceFile => /\.ts$/.test(sourceFile) && !sourceFile.includes(`${path.sep}__tests__${path.sep}`))
    .sort((left, right) => left.localeCompare(right))
  const expectedArtifacts = new Set([
    'package/lib/commonjs/package.json',
    'package/lib/module/package.json',
    'package/lib/typescript/commonjs/package.json',
    'package/lib/typescript/module/package.json'
  ])
  for (const sourceFile of sourceFiles) {
    for (const artifactPath of sourceArtifactPaths(sourceFile)) {
      expectedArtifacts.add(`package/${artifactPath}`)
    }
  }
  for (const sourceFile of declarationSourceFiles) {
    for (const artifactPath of declarationArtifactPaths(sourceFile)) {
      expectedArtifacts.add(`package/${artifactPath}`)
    }
  }
  for (const sourceRelative of internalTypeOnlySourceFiles) {
    const sourceFile = path.join(sourceRoot, sourceRelative)
    if (!fs.existsSync(sourceFile)) {
      throw new Error(
        `Internal type-only source is missing while verifying packed canonical package: ${sourceRelative}`
      )
    }
    for (const artifactPath of internalTypeArtifactPaths(sourceRelative)) {
      expectedArtifacts.add(`package/${artifactPath}`)
    }
  }
  for (const sourceRelative of internalRuntimeSourceFiles) {
    const sourceFile = path.join(sourceRoot, sourceRelative)
    if (!fs.existsSync(sourceFile)) {
      throw new Error(`Internal runtime source is missing while verifying packed canonical package: ${sourceRelative}`)
    }
    for (const artifactPath of sourceArtifactPaths(sourceFile)) {
      expectedArtifacts.add(`package/${artifactPath}`)
    }
  }
  const packedArtifacts = [...files.keys()].filter(entryPath => entryPath.startsWith('package/lib/'))
  const missingArtifacts = [...expectedArtifacts].filter(entryPath => !files.has(entryPath)).sort()
  const unexpectedArtifacts = packedArtifacts.filter(entryPath => !expectedArtifacts.has(entryPath)).sort()
  if (missingArtifacts.length > 0 || unexpectedArtifacts.length > 0) {
    throw new Error(
      `Packed lib artifact set differs from the source-derived build. Missing: ${missingArtifacts.join(', ') || 'none'}. Unexpected: ${unexpectedArtifacts.join(', ') || 'none'}.`
    )
  }

  const pluginSourceFiles = listFiles(pluginSourceRoot)
    .filter(sourceFile => /\.ts$/.test(sourceFile) && !sourceFile.includes(`${path.sep}__tests__${path.sep}`))
    .sort((left, right) => left.localeCompare(right))
  const expectedPluginArtifacts = new Set()
  for (const sourceFile of pluginSourceFiles) {
    for (const artifactPath of pluginArtifactPaths(sourceFile)) {
      expectedPluginArtifacts.add(`package/${artifactPath}`)
    }
  }
  const packedPluginArtifacts = [...files.keys()].filter(entryPath => entryPath.startsWith('package/plugin/build/'))
  const missingPluginArtifacts = [...expectedPluginArtifacts].filter(entryPath => !files.has(entryPath)).sort()
  const unexpectedPluginArtifacts = packedPluginArtifacts
    .filter(entryPath => !expectedPluginArtifacts.has(entryPath))
    .sort()
  if (missingPluginArtifacts.length > 0 || unexpectedPluginArtifacts.length > 0) {
    throw new Error(
      `Packed plugin artifact set differs from plugin source-derived expectations. Missing: ${missingPluginArtifacts.join(', ') || 'none'}. Unexpected: ${unexpectedPluginArtifacts.join(', ') || 'none'}.`
    )
  }

  for (const entryPath of files.keys()) {
    if (!isRootArchiveEntryAllowed(entryPath, expectedArtifacts, expectedPluginArtifacts)) {
      throw new Error(`Packed entry is outside the package archive allowlist: ${entryPath}`)
    }
  }

  for (const [entryPath, contents] of files) {
    if (
      entryPath.includes('/__tests__/') ||
      entryPath.includes('/__fixtures__/') ||
      entryPath.includes('/__mocks__/') ||
      entryPath.includes('/node_modules/') ||
      entryPath.includes('/.claude/') ||
      entryPath.includes('/.codex/') ||
      entryPath.includes('/docs/audits/') ||
      entryPath.includes('/docs/review/') ||
      entryPath.includes('/docs/evidence/g0/') ||
      entryPath.startsWith('package/src/') ||
      entryPath.includes('/spikes/') ||
      entryPath.includes('/benchmarks/') ||
      entryPath.includes('/lab/') ||
      entryPath.startsWith('package/native/protocol/tests/') ||
      entryPath.endsWith('.node') ||
      (entryPath.includes('/build/') && !entryPath.startsWith('package/plugin/build/')) ||
      entryPath.includes('/obj.target/')
    ) {
      throw new Error(`Unintended package artifact: ${entryPath}`)
    }
    if (/\.(?:js|d\.ts|map|json|ts|tsx)$/.test(entryPath)) {
      assertNoPrivatePath(entryPath, contents)
    }
    if ((entryPath.endsWith('.ts') || entryPath.endsWith('.tsx')) && !entryPath.endsWith('.d.ts')) {
      throw new Error(`Source-only TypeScript leaked into the packed artifact: ${entryPath}`)
    }
  }

  const targets = [
    { label: 'main', target: packageJson.main },
    { label: 'module', target: packageJson.module },
    { label: 'types', target: packageJson.types }
  ]
  for (const [exportPath, target] of Object.entries(packageJson.exports ?? {})) {
    collectTargets(target, `exports[${JSON.stringify(exportPath)}]`, targets)
  }
  for (const entry of targets) {
    const entryPath = packagePath(entry.target, entry.label)
    if (!files.has(entryPath)) {
      throw new Error(`Packed entrypoint ${entry.label} does not resolve: ${entry.target}`)
    }
    if (
      [...internalTypeOnlySourceFiles, ...internalRuntimeSourceFiles].some(sourceFile =>
        entry.target.includes(sourceFile.replace(/\.ts$/, ''))
      )
    ) {
      throw new Error(`Packed internal native-protocol source must not become a public entrypoint: ${entry.label}`)
    }
  }

  console.log(
    `canonical tarball verified: ${sourceFiles.length} published source files, ${internalRuntimeSourceFiles.length} exact internal runtime sources, ${internalTypeOnlySourceFiles.length} exact internal declaration-only sources, ${expectedArtifacts.size} required runtime/type artifacts, ${pluginSourceFiles.length} plugin source files, ${targets.length} current entrypoint targets`
  )
  return packageJson.version
}

function verifyShimTarball(tarballPath, canonicalVersion) {
  const files = readTarball(tarballPath)
  assertExactShimArchiveEntries(files)
  const packageJsonBuffer = files.get('package/package.json')
  if (!packageJsonBuffer) {
    throw new Error('Packed shim package is missing package.json')
  }
  const packageJson = JSON.parse(packageJsonBuffer.toString('utf8'))
  assertExactShimManifest(packageJson, canonicalVersion)

  const targets = [
    { label: 'main', target: packageJson.main },
    { label: 'types', target: packageJson.types }
  ]
  for (const [exportPath, target] of Object.entries(packageJson.exports ?? {})) {
    collectTargets(target, `exports[${JSON.stringify(exportPath)}]`, targets)
  }
  for (const entry of targets) {
    const entryPath = packagePath(entry.target, entry.label)
    if (!files.has(entryPath)) {
      throw new Error(`Packed shim entrypoint ${entry.label} does not resolve: ${entry.target}`)
    }
  }
  for (const [entryPath, contents] of files) {
    if (entryPath.includes('/node_modules/') || entryPath.includes('/.claude/') || entryPath.includes('/.codex/')) {
      throw new Error(`Unintended shim package artifact: ${entryPath}`)
    }
    if (/\.(?:js|d\.ts|map|json)$/.test(entryPath)) {
      assertNoPrivatePath(entryPath, contents)
    }
  }
  console.log(`shim tarball verified: ${targets.length} current entrypoint targets`)
}

function expectedShimArchiveEntries() {
  const expected = new Set(['package/package.json', 'package/index.js', 'package/index.d.ts', 'package/app.plugin.js'])
  for (const optionalFile of ['README.md', 'LICENSE']) {
    if (fs.existsSync(path.join(shimSourceRoot, optionalFile))) {
      expected.add(`package/${optionalFile}`)
    }
  }
  return expected
}

function assertExactShimArchiveEntries(files) {
  const expected = expectedShimArchiveEntries()
  const missing = [...expected].filter(entryPath => !files.has(entryPath)).sort()
  const unexpected = [...files.keys()].filter(entryPath => !expected.has(entryPath)).sort()
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `Packed shim archive differs from the exact allowlist. Missing: ${missing.join(', ') || 'none'}. Unexpected: ${unexpected.join(', ') || 'none'}.`
    )
  }
}

function main(argv) {
  if (argv.length !== 2) {
    throw new Error('Usage: node scripts/ci/verify-package-tarballs.js <canonical.tgz> <shim.tgz>')
  }
  const canonicalVersion = verifyRootTarball(path.resolve(argv[0]))
  verifyShimTarball(path.resolve(argv[1]), canonicalVersion)
}

if (require.main === module) {
  main(process.argv.slice(2))
}

module.exports = {
  assertExactShimArchiveEntries,
  assertExactShimManifest,
  expectedShimArchiveEntries,
  readTarball,
  verifyRootTarball,
  verifyShimTarball
}
