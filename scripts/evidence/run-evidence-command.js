// scripts/evidence/run-evidence-command.js

'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')
const {
  assertCertifiedCommandProfile,
  bindScenariosToCommandWindow,
  emitReceipt,
  resolveCertifiedExecutable
} = require('./evidence-command-receipt')

function git(root, args, encoding = 'utf8') {
  const result = spawnSync('git', args, { cwd: root, encoding, shell: false })
  if (result.error || result.status !== 0) throw result.error || new Error(`git ${args.join(' ')} failed with exit code ${String(result.status)}`)
  return result.stdout
}

function captureRepository(root) {
  const dirtyStatus = git(root, ['status', '--porcelain=v1', '-z'], null)
  return {
    remote: git(root, ['config', '--get', 'remote.origin.url']).trim(),
    commit: git(root, ['rev-parse', 'HEAD']).trim(),
    dirtyStatusSha256: crypto.createHash('sha256').update(dirtyStatus).digest('hex')
  }
}

function containedPath(root, relativePath, label) {
  const resolved = path.resolve(root, relativePath)
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error(`${label} must be contained beneath the repository root`)
  return resolved
}

function main() {
  const [profileId, receiptPath, commandPath, ...argv] = process.argv.slice(2)
  if (!profileId || !receiptPath || !commandPath || argv.length === 0) throw new Error('usage: run-evidence-command <profileId> <receiptPath> <commandPath> <argv...>')
  const root = process.cwd()
  const command = JSON.parse(fs.readFileSync(commandPath, 'utf8'))
  if (JSON.stringify(command.argv) !== JSON.stringify(argv)) throw new Error('command JSON argv must exactly equal the supplied non-shell argv')
  const repository = captureRepository(root)
  assertCertifiedCommandProfile(profileId, command, { claimId: command.claimId, remote: repository.remote })
  if (typeof command.cwd !== 'string' || typeof command.outputPath !== 'string' || typeof command.outputArtifactId !== 'string') throw new Error('command JSON must declare cwd, outputPath, and outputArtifactId strings')
  const cwd = containedPath(root, command.cwd, 'command cwd')
  const outputPath = containedPath(root, command.outputPath, 'command output path')
  const outputDirectory = path.dirname(outputPath)
  if (!fs.existsSync(outputDirectory) || !fs.statSync(outputDirectory).isDirectory()) throw new Error('command output path parent directory must already exist')
  const resolvedReceiptPath = containedPath(root, receiptPath, 'receipt path')
  const receiptDirectory = path.dirname(resolvedReceiptPath)
  if (!fs.existsSync(receiptDirectory) || !fs.statSync(receiptDirectory).isDirectory()) throw new Error('receipt path parent directory must already exist')
  const startedAt = new Date().toISOString()
  const result = spawnSync(resolveCertifiedExecutable(root, argv[0]), argv.slice(1), {
    cwd,
    encoding: 'utf8',
    shell: false,
    env: {}
  })
  if (result.error) throw result.error
  const output = Buffer.from(`${result.stdout ?? ''}${result.stderr ?? ''}`, 'utf8')
  fs.writeFileSync(outputPath, output)
  const endedAt = new Date().toISOString()
  const receipt = emitReceipt({
    root,
    profileId,
    command: { ...command, argv, startedAt, endedAt, exitCode: result.status ?? 1, profileId },
    scenarios: bindScenariosToCommandWindow(command.scenarios, startedAt, endedAt),
    outputArtifact: { artifactId: command.outputArtifactId, sha256: crypto.createHash('sha256').update(output).digest('hex') },
    repository: { claimId: command.claimId, ...repository },
    runtime: { node: process.version.replace(/^v/u, ''), nodeModuleAbi: Number(process.versions.modules) },
    environment: {}
  })
  fs.writeFileSync(resolvedReceiptPath, `${JSON.stringify(receipt, null, 2)}\n`)
  process.exitCode = result.status ?? 1
}

try {
  main()
} catch (error) {
  console.error(`[run-evidence-command] ${error.stack || error.message}`)
  process.exitCode = 1
}
