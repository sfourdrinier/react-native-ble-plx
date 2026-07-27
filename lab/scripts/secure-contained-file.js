// lab/scripts/secure-contained-file.js

'use strict'

const fs = require('node:fs')
const path = require('node:path')

function isContainedPath(rootPath, candidatePath) {
  return candidatePath === rootPath || candidatePath.startsWith(`${rootPath}${path.sep}`)
}

function resolveContainedPath(rootPath, relativePath, label) {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || path.isAbsolute(relativePath)) throw new Error(`${label} path must be a non-empty relative path inside ${label}/`)
  const rootRealPath = fs.realpathSync.native(rootPath)
  const lexicalPath = path.resolve(rootRealPath, relativePath)
  if (!isContainedPath(rootRealPath, lexicalPath)) throw new Error(`${label} path escapes ${label}/`)
  const relativeSegments = path.relative(rootRealPath, lexicalPath).split(path.sep).filter((segment) => segment.length > 0)
  let component = rootRealPath
  let initialStat
  for (const segment of relativeSegments) {
    component = path.join(component, segment)
    const stat = fs.lstatSync(component)
    if (stat.isSymbolicLink()) throw new Error(`${label} path must not traverse a symbolic link`)
    initialStat = stat
  }
  if (!initialStat?.isFile()) throw new Error(`${label} path must resolve to a regular file`)
  const realPath = fs.realpathSync.native(lexicalPath)
  if (!isContainedPath(rootRealPath, realPath)) throw new Error(`${label} path escapes ${label}/ through a symbolic link`)
  return { rootRealPath, lexicalPath, realPath, initialStat }
}

function readContainedRegularFile(rootPath, relativePath, label) {
  const resolved = resolveContainedPath(rootPath, relativePath, label)
  const noFollow = fs.constants.O_NOFOLLOW
  if (typeof noFollow !== 'number') throw new Error(`${label} secure reads require fs.constants.O_NOFOLLOW on this platform`)
  const descriptor = fs.openSync(resolved.lexicalPath, fs.constants.O_RDONLY | noFollow)
  try {
    const descriptorStat = fs.fstatSync(descriptor)
    if (!descriptorStat.isFile() || descriptorStat.dev !== resolved.initialStat.dev || descriptorStat.ino !== resolved.initialStat.ino) throw new Error(`${label} path changed after containment validation`)
    return { bytes: fs.readFileSync(descriptor), realPath: resolved.realPath }
  } finally {
    fs.closeSync(descriptor)
  }
}

module.exports = { readContainedRegularFile, resolveContainedPath }
