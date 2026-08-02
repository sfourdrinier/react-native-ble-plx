// scripts/ci/verify-package-tarballs.js

'use strict'

const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const root = path.resolve(__dirname, '../..')
const sourceRoot = path.join(root, 'src')
const pluginSourceRoot = path.join(root, 'plugin', 'src')
const {
  assertNoForbiddenNobleManifestDependencies,
  assertNoForbiddenNobleRuntimeReferences
} = require('./forbidden-runtime-dependencies')

/** Exact declaration-only source emitted by the React Native Codegen/type build. */
const internalTypeOnlySourceFiles = Object.freeze([])

/** Exact private runtime modules required by the public React Native host entrypoint. */
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

/** Source inputs a consumer needs to build either packaged Electron Node-API addon. */
const requiredElectronNativeSourceEntries = Object.freeze([
  'package/native/electron/corebluetooth/binding.gyp',
  'package/native/electron/corebluetooth/index.js',
  'package/native/electron/corebluetooth/src/addon.mm',
  'package/native/electron/corebluetooth/src/addon_stub.cc',
  'package/native/electron/winrt/binding.gyp',
  'package/native/electron/winrt/index.js',
  'package/native/electron/winrt/src/addon.cpp',
  'package/native/electron/winrt/src/winrt-boundary.inc'
])

const publishedOptionalHostDependencies = Object.freeze({
  'node-addon-api': '8.9.0',
  'node-gyp': '12.4.0'
})

const publishedOptionalPeerHostDependencies = Object.freeze({
  'dbus-next': '^0.10.2',
  expo: '^57.0.0'
})

const excludedHistoricalDocumentationEntries = Object.freeze([
  'package/docs/README_V1.md',
  'package/docs/MIGRATION_V1.md'
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

function isCodegenSourceFile(sourceFile) {
  return (
    /\.(?:ts|tsx)$/.test(sourceFile) &&
    !sourceFile.includes(`${path.sep}__tests__${path.sep}`) &&
    !sourceFile.includes(`${path.sep}__fixtures__${path.sep}`) &&
    !sourceFile.includes(`${path.sep}__mocks__${path.sep}`)
  )
}

function codegenSourceArchivePath(sourceFile) {
  return `package/src/${path.relative(sourceRoot, sourceFile).split(path.sep).join('/')}`
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

function assertNoUndeclaredElectronNativeRuntimeLoaders(files) {
  const loaderSpecifications = Object.freeze([
    {
      entryPath: 'package/native/electron/corebluetooth/index.js',
      allowedRuntimeModules: new Set(['path', 'fs'])
    },
    {
      entryPath: 'package/native/electron/winrt/index.js',
      allowedRuntimeModules: new Set(['path'])
    }
  ])

  for (const loader of loaderSpecifications) {
    const contents = files.get(loader.entryPath)
    if (contents === undefined) {
      throw new Error(`Packed Electron native loader is missing: ${loader.entryPath}`)
    }
    const source = contents.toString('utf8')
    const staticRequire = /require\(\s*['\"]([^'\"]+)['\"]\s*\)/g
    for (const match of source.matchAll(staticRequire)) {
      const runtimeModule = match[1]
      if (!loader.allowedRuntimeModules.has(runtimeModule)) {
        throw new Error(
          `Packed Electron native loader ${loader.entryPath} has an undeclared runtime loader dependency: ${runtimeModule}`
        )
      }
    }
  }
}

function isRootArchiveEntryAllowed(
  entryPath,
  expectedArtifacts,
  expectedPluginArtifacts,
  expectedCodegenSourceEntries
) {
  if (excludedHistoricalDocumentationEntries.includes(entryPath)) {
    return false
  }
  if (
    expectedArtifacts.has(entryPath) ||
    expectedPluginArtifacts.has(entryPath) ||
    expectedCodegenSourceEntries.has(entryPath)
  ) {
    return true
  }
  const allowedFiles = new Set([
    'package/package.json',
    'package/README.md',
    'package/CHANGELOG.md',
    'package/CONTRIBUTING.md',
    'package/GOVERNANCE.md',
    'package/LICENSE',
    'package/MIGRATION_4.0.md',
    'package/ROADMAP.md',
    'package/ROADMAP.4.0.md',
    'package/RELEASE.md',
    'package/SBOM.cdx.json',
    'package/SECURITY.md',
    'package/SUPPORT.md',
    'package/THIRD_PARTY_LICENSES.json',
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
  assertNoForbiddenNobleManifestDependencies(packageJson, 'Packed canonical package manifest')
  assertExactObjectKeys(packageJson.bin, ['ubm'], 'Packed canonical bin')
  if (packageJson.bin.ubm !== 'bin/ubm.js') {
    throw new Error(`Packed canonical ubm entrypoint must equal bin/ubm.js, received ${String(packageJson.bin.ubm)}`)
  }
  if (!files.has('package/bin/ubm.js')) {
    throw new Error('Packed canonical package is missing CLI entrypoint bin/ubm.js')
  }
  assertExactObjectKeys(
    packageJson.optionalDependencies,
    Object.keys(publishedOptionalHostDependencies),
    'Packed canonical optionalDependencies'
  )
  for (const [dependency, requiredVersion] of Object.entries(publishedOptionalHostDependencies)) {
    if (packageJson.optionalDependencies?.[dependency] !== requiredVersion) {
      throw new Error(
        `Packed canonical optional host dependency ${dependency} must equal ${requiredVersion}, received ${String(packageJson.optionalDependencies?.[dependency])}`
      )
    }
    if (packageJson.dependencies?.[dependency] !== undefined) {
      throw new Error(`Packed canonical optional host dependency ${dependency} must not be required at the root`)
    }
    if (packageJson.devDependencies?.[dependency] !== undefined) {
      throw new Error(`Packed canonical optional host dependency ${dependency} must not remain development-only`)
    }
  }
  for (const [dependency, requiredVersion] of Object.entries(publishedOptionalPeerHostDependencies)) {
    if (packageJson.peerDependencies?.[dependency] !== requiredVersion) {
      throw new Error(
        `Packed canonical optional peer host dependency ${dependency} must equal ${requiredVersion}, received ${String(packageJson.peerDependencies?.[dependency])}`
      )
    }
    if (packageJson.peerDependenciesMeta?.[dependency]?.optional !== true) {
      throw new Error(`Packed canonical peerDependenciesMeta.${dependency}.optional must equal true`)
    }
    if (packageJson.dependencies?.[dependency] !== undefined || packageJson.optionalDependencies?.[dependency] !== undefined) {
      throw new Error(`Packed canonical optional peer host dependency ${dependency} must not install at the root`)
    }
  }
  if (packageJson.codegenConfig?.jsSrcsDir !== 'src') {
    throw new Error('Packed canonical React Native Codegen must resolve its shipped src directory')
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
  for (const requiredInput of requiredElectronNativeSourceEntries) {
    if (!files.has(requiredInput)) {
      throw new Error(`Packed canonical package is missing Electron native build input: ${requiredInput}`)
    }
  }
  assertNoUndeclaredElectronNativeRuntimeLoaders(files)

  const sourceFiles = listFiles(sourceRoot).filter(isPublishedSourceFile)
  if (sourceFiles.length === 0) {
    throw new Error('No TypeScript source files found while verifying packed canonical package')
  }
  const declarationSourceFiles = listFiles(sourceRoot)
    .filter(sourceFile => /\.ts$/.test(sourceFile) && !sourceFile.includes(`${path.sep}__tests__${path.sep}`))
    .sort((left, right) => left.localeCompare(right))
  const codegenSourceFiles = listFiles(sourceRoot)
    .filter(isCodegenSourceFile)
    .sort((left, right) => left.localeCompare(right))
  const expectedCodegenSourceEntries = new Set(codegenSourceFiles.map(codegenSourceArchivePath))
  for (const requiredCodegenInput of [
    'package/src/NativeUnifiedBleProtocolControl.ts'
  ]) {
    if (!expectedCodegenSourceEntries.has(requiredCodegenInput)) {
      throw new Error(`Required React Native Codegen source is missing from the package source tree: ${requiredCodegenInput}`)
    }
  }
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

  const packedCodegenSourceEntries = [...files.keys()].filter(entryPath => entryPath.startsWith('package/src/'))
  const missingCodegenSourceEntries = [...expectedCodegenSourceEntries]
    .filter(entryPath => !files.has(entryPath))
    .sort()
  const unexpectedCodegenSourceEntries = packedCodegenSourceEntries
    .filter(entryPath => !expectedCodegenSourceEntries.has(entryPath))
    .sort()
  if (missingCodegenSourceEntries.length > 0 || unexpectedCodegenSourceEntries.length > 0) {
    throw new Error(
      `Packed React Native Codegen source set differs from the declared src tree. Missing: ${missingCodegenSourceEntries.join(', ') || 'none'}. Unexpected: ${unexpectedCodegenSourceEntries.join(', ') || 'none'}.`
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
    if (
      !isRootArchiveEntryAllowed(
        entryPath,
        expectedArtifacts,
        expectedPluginArtifacts,
        expectedCodegenSourceEntries
      )
    ) {
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
    if (
      (entryPath.endsWith('.ts') || entryPath.endsWith('.tsx')) &&
      !entryPath.endsWith('.d.ts') &&
      !expectedCodegenSourceEntries.has(entryPath)
    ) {
      throw new Error(`Source-only TypeScript leaked into the packed artifact: ${entryPath}`)
    }
  }
  assertNoForbiddenNobleRuntimeReferences(
    [...files.entries()].map(([entryPath, contents]) => ({ path: entryPath, contents })),
    'Packed canonical runtime source/artifacts'
  )

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
    `canonical tarball verified: ${sourceFiles.length} published source files, ${codegenSourceFiles.length} exact React Native Codegen source files, ${internalRuntimeSourceFiles.length} exact internal runtime sources, ${internalTypeOnlySourceFiles.length} exact internal declaration-only sources, ${expectedArtifacts.size} required runtime/type artifacts, ${pluginSourceFiles.length} plugin source files, ${targets.length} current entrypoint targets`
  )
  return packageJson.version
}

function main(argv) {
  if (argv.length !== 1) {
    throw new Error('Usage: node scripts/ci/verify-package-tarballs.js <canonical.tgz>')
  }
  verifyRootTarball(path.resolve(argv[0]))
}

if (require.main === module) {
  main(process.argv.slice(2))
}

module.exports = {
  readTarball,
  verifyRootTarball
}
