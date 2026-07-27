// scripts/evidence/evidence-secure-files.js

'use strict'

const fs = require('fs')
const path = require('path')

function readContainedJson(root, absolute) {
  const rootRealPath = fs.realpathSync(root)
  const manifestRealPath = fs.realpathSync(absolute)
  if (!manifestRealPath.startsWith(`${rootRealPath}${path.sep}`)) throw new Error('manifest path escapes repository root through a symbolic link')
  if (fs.lstatSync(absolute).isSymbolicLink()) throw new Error('manifest path must not be a symbolic link')
  const noFollow = fs.constants.O_NOFOLLOW ?? 0
  const descriptor = fs.openSync(absolute, fs.constants.O_RDONLY | noFollow)
  try {
    if (!fs.fstatSync(descriptor).isFile()) throw new Error('manifest path must be a regular file')
    return JSON.parse(fs.readFileSync(descriptor, 'utf8'))
  } finally {
    fs.closeSync(descriptor)
  }
}

module.exports = { readContainedJson }
