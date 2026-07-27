// scripts/evidence/evidence-package-artifact.js

'use strict'

const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

function readTarEntries(bytes) {
  const archive = zlib.gunzipSync(bytes)
  const entries = new Map()
  for (let offset = 0; offset + 512 <= archive.length;) {
    const header = archive.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/u, '')
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/u, '')
    const entry = prefix ? `${prefix}/${name}` : name
    const sizeText = header.subarray(124, 136).toString('utf8').replace(/\0.*$/u, '').trim()
    const size = Number.parseInt(sizeText || '0', 8)
    if (!entry.startsWith('package/') || entry.includes('../') || !Number.isSafeInteger(size) || size < 0 || offset + 512 + size > archive.length) throw new Error('invalid tar entry')
    if (entries.has(entry)) throw new Error(`duplicate tar entry: ${entry}`)
    entries.set(entry, archive.subarray(offset + 512, offset + 512 + size))
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return entries
}

function hasNativeMagic(bytes) {
  const machO = bytes.length >= 4 && [0xfeedface, 0xfeedfacf, 0xcafebabe, 0xcafebabf, 0xcefaedfe, 0xcffaedfe, 0xbebafeca, 0xbfbafeca].includes(bytes.readUInt32BE(0))
  const elf = bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
  const portableExecutable = bytes.length >= 2 && bytes.subarray(0, 2).equals(Buffer.from('MZ'))
  return machO || elf || portableExecutable
}

function validateBuildOutput(artifact, bytes, root, location, errors, problem) {
  const match = /^(.*\/lib\/)(commonjs|module)(\/.*\.(?:c?js|mjs))$/u.exec(artifact.path)
  const text = bytes.toString('utf8')
  if (!match || !/^(?:application|text)\/javascript$/u.test(artifact.mediaType) || bytes.length === 0 || !/\b(?:export|imports?|module\.exports|Object\.defineProperty)\b/u.test(text)) {
    problem(errors, location, 'build-output package artifacts must be a non-empty JavaScript module under lib/commonjs or lib/module with a matching media type')
    return
  }
  const siblingFlavor = match[2] === 'commonjs' ? 'module' : 'commonjs'
  const siblingRelative = `${match[1]}${siblingFlavor}${match[3]}`
  const sibling = path.resolve(root, ...siblingRelative.split('/'))
  try {
    const stat = fs.lstatSync(sibling)
    const siblingText = fs.readFileSync(sibling, 'utf8')
    if (!stat.isFile() || stat.isSymbolicLink() || siblingText.length === 0) throw new Error('missing or unsafe sibling output')
  } catch (error) {
    problem(errors, location, `build-output package artifact must retain matching commonjs and module entrypoints: ${error.message}`)
  }
}

function validatePackageArtifactContents(artifact, bytes, root, location, errors, problem) {
  if (artifact.packageType === 'tarball') {
    if (path.extname(artifact.path) !== '.tgz' || bytes.length < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
      problem(errors, location, 'tarball package artifacts must be gzip-compressed .tgz files')
      return
    }
    try {
      const entries = readTarEntries(bytes)
      const packageJson = entries.get('package/package.json')
      if (!packageJson || ![...entries.keys()].some(entry => /^package\/(?:lib\/|src\/)/u.test(entry))) throw new Error('missing package.json or package payload')
      const packageDescriptor = JSON.parse(packageJson.toString('utf8'))
      if (typeof packageDescriptor.name !== 'string' || packageDescriptor.name.length === 0 || typeof packageDescriptor.version !== 'string' || packageDescriptor.version.length === 0) throw new Error('package/package.json must declare package name and version')
    } catch (error) {
      problem(errors, location, `tarball package artifact must be a valid package archive: ${error.message}`)
    }
  }
  if (artifact.packageType === 'native-binary' && (path.extname(artifact.path) !== '.node' || !hasNativeMagic(bytes) || !Number.isInteger(artifact.nativeModuleAbi) || artifact.nativeModuleAbi < 1)) problem(errors, location, 'native-binary package artifacts must be a .node Mach-O, ELF, or PE binary with positive nativeModuleAbi metadata')
  if (artifact.packageType === 'build-output') validateBuildOutput(artifact, bytes, root, location, errors, problem)
}

module.exports = { validatePackageArtifactContents }
