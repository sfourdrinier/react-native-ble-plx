// scripts/evidence/evidence-command-receipt.js

'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const receiptSchema = 'unified-ble-manager/evidence-command-receipt'
const receiptVersion = 1
const shellExecutables = new Set(['sh', 'bash', 'zsh', 'fish', 'cmd', 'cmd.exe', 'powershell', 'pwsh'])

const certifiedProfiles = {
  'package-typecheck': {
    argv: ['pnpm', 'typecheck'],
    toolIdentity: null,
    scenarioKinds: ['compile-package'],
    environmentKeys: []
  },
  'package-prepack': {
    argv: ['pnpm', 'prepack'],
    toolIdentity: null,
    scenarioKinds: ['compile-package'],
    environmentKeys: []
  },
  'legacy-package-regression': {
    argv: ['pnpm', 'test:package', '--runInBand'],
    toolIdentity: 'legacy-package-regression',
    scenarioKinds: ['legacy-regression'],
    environmentKeys: []
  },
  'corebluetooth-live-vertical-slice': {
    argv: ['node', 'scripts/evidence/corebluetooth-live.js'],
    toolIdentity: 'unified-ble-live-corebluetooth',
    scenarioKinds: ['vertical-slice'],
    environmentKeys: [],
    claimIds: ['macos-corebluetooth-live'],
    repositories: ['https://github.com/sfourdrinier/react-native-ble-plx.git']
  },
  'fixture-compile': {
    argv: ['pnpm', 'typecheck'],
    toolIdentity: null,
    scenarioKinds: ['compile-package'],
    environmentKeys: [],
    fixtureOnly: true
  },
  'fixture-tck': {
    argv: ['pnpm', 'test'],
    toolIdentity: 'unified-ble-tck',
    scenarioKinds: ['tck'],
    environmentKeys: [],
    fixtureOnly: true
  },
  'fixture-system': {
    argv: ['node', 'smoke.js'],
    toolIdentity: null,
    scenarioKinds: ['native-abi', 'protocol-handshake'],
    environmentKeys: [],
    fixtureOnly: true
  },
  'fixture-live-suite': {
    argv: ['node', 'live.js'],
    toolIdentity: 'unified-ble-tck',
    scenarioKinds: ['compile-package', 'tck', 'native-abi', 'vertical-slice', 'background', 'reconnect', 'soak'],
    environmentKeys: [],
    fixtureOnly: true
  },
  'fixture-reliability-suite': {
    argv: ['node', 'reliability.js'],
    toolIdentity: 'unified-ble-tck',
    scenarioKinds: ['compile-package', 'tck', 'native-abi', 'vertical-slice', 'background', 'reconnect', 'soak'],
    environmentKeys: [],
    fixtureOnly: true
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (isObject(value)) {
    const normalized = {}
    Object.keys(value).sort().forEach(key => {
      normalized[key] = canonicalize(value[key])
    })
    return normalized
  }
  return value
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value))
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function receiptDigest(receipt) {
  if (!isObject(receipt)) return null
  const payload = { ...receipt }
  delete payload.receiptSha256
  return sha256(canonicalJson(payload))
}

function sameJson(left, right) {
  return canonicalJson(left) === canonicalJson(right)
}

function isSafeArgv(argv) {
  return Array.isArray(argv) && argv.length > 0 && argv.every(argument => typeof argument === 'string' && argument.length > 0 && !/[`$\n\r]/u.test(argument)) && !shellExecutables.has(argv[0])
}

function profileFor(profileId, claimId, repository) {
  const profile = certifiedProfiles[profileId]
  if (!profile) return null
  if (profile.fixtureOnly === true && (typeof claimId !== 'string' || !claimId.startsWith('fixture-') || repository !== 'fixture-repository')) return null
  if (Array.isArray(profile.claimIds) && !profile.claimIds.includes(claimId)) return null
  if (Array.isArray(profile.repositories) && !profile.repositories.includes(repository)) return null
  return profile
}

function bindScenariosToCommandWindow(scenarios, startedAt, endedAt) {
  if (!Array.isArray(scenarios) || scenarios.length === 0) throw new Error('certified command must declare at least one scenario')
  const started = Date.parse(startedAt)
  const ended = Date.parse(endedAt)
  if (!Number.isFinite(started) || !Number.isFinite(ended) || started > ended) {
    throw new Error('certified command execution window must contain ordered ISO timestamps')
  }
  return scenarios.map(scenario => {
    if (!isObject(scenario)) throw new Error('certified command scenario must be an object')
    if (Object.hasOwn(scenario, 'startedAt') || Object.hasOwn(scenario, 'endedAt')) {
      throw new Error('certified command scenario templates must not declare execution timestamps')
    }
    return { ...scenario, startedAt, endedAt }
  })
}

function assertCertifiedCommandProfile(profileId, command, repository) {
  const profile = profileFor(profileId, repository.claimId, repository.remote)
  if (!profile || !sameJson(command.argv, profile.argv) || !isSafeArgv(command.argv) || (command.toolIdentity ?? null) !== profile.toolIdentity) throw new Error('refusing to run an unregistered, shell-interpreted, or misidentified certified command profile')
  return profile
}

function parseReceipt(bytes, location, errors, problem) {
  try {
    const receipt = JSON.parse(bytes.toString('utf8'))
    if (!isObject(receipt)) {
      problem(errors, location, 'must contain a JSON object command receipt')
      return null
    }
    if (receipt.schema !== receiptSchema || receipt.version !== receiptVersion) {
      problem(errors, location, 'must use the current evidence command receipt schema and version')
      return null
    }
    if (typeof receipt.receiptSha256 !== 'string' || receipt.receiptSha256 !== receiptDigest(receipt)) {
      problem(errors, location, 'has an invalid canonical receipt digest')
      return null
    }
    return receipt
  } catch (error) {
    problem(errors, location, `cannot parse command receipt JSON: ${error.message}`)
    return null
  }
}

function validateReceipt(receipt, command, scenarios, manifest, receiptArtifact, outputArtifact, errors, problem) {
  const location = `artifacts.${receiptArtifact.id}`
  const profile = profileFor(command.profileId, manifest.claim?.id, manifest.source?.repository)
  if (!profile) {
    problem(errors, `execution.commands.${command.id}.profileId`, 'must name a registered certified command profile')
    return
  }
  if (!isSafeArgv(command.argv) || !sameJson(command.argv, profile.argv)) {
    problem(errors, `execution.commands.${command.id}.argv`, 'must exactly match its registered non-shell certified command profile')
  }
  if ((command.toolIdentity ?? null) !== profile.toolIdentity) {
    problem(errors, `execution.commands.${command.id}.toolIdentity`, 'must match its registered certified command profile')
  }
  const required = ['command', 'scenarios', 'environment', 'executable', 'output', 'runtime', 'repository']
  if (!required.every(key => isObject(receipt[key]) || Array.isArray(receipt[key]))) {
    problem(errors, location, 'is missing a required typed command-receipt section')
    return
  }
  const receiptCommand = receipt.command
  const commandProjection = {
    id: command.id,
    argv: command.argv,
    cwd: command.cwd,
    startedAt: command.startedAt,
    endedAt: command.endedAt,
    exitCode: command.exitCode,
    toolIdentity: command.toolIdentity ?? null,
    profileId: command.profileId
  }
  if (!sameJson(receiptCommand, commandProjection)) problem(errors, location, 'command projection must exactly bind the manifest command')
  if (!isObject(receipt.environment) || Object.keys(receipt.environment).some(key => !profile.environmentKeys.includes(key))) problem(errors, location, 'contains an environment key outside the certified profile allowlist')
  if (!isObject(receipt.executable) || typeof receipt.executable.path !== 'string' || !/^[a-f0-9]{64}$/u.test(receipt.executable.sha256) || typeof receipt.executable.version !== 'string') problem(errors, location, 'must bind executable path, SHA-256, and version')
  if (!isObject(receipt.output) || receipt.output.artifactId !== command.resultArtifactId || receipt.output.sha256 !== outputArtifact?.sha256) problem(errors, location, 'must bind the command result artifact id and SHA-256')
  if (!isObject(receipt.runtime) || receipt.runtime.node !== manifest.subject?.runtime?.node || !Number.isInteger(receipt.runtime.nodeModuleAbi) || receipt.runtime.nodeModuleAbi < 1) problem(errors, location, 'must bind the declared Node runtime and a positive Node module ABI')
  const nativeAbi = /^node-abi-(\d+)$/u.exec(manifest.boundary?.abiOrProtocol ?? '')
  if (nativeAbi && Number(nativeAbi[1]) !== receipt.runtime?.nodeModuleAbi) problem(errors, location, 'must bind the Node module ABI declared by the native boundary')
  const sourceDigest = manifest.source?.dirtyPathsSha256 ?? sha256(Buffer.alloc(0))
  if (!isObject(receipt.repository) || receipt.repository.remote !== manifest.source?.repository || receipt.repository.commit !== manifest.source?.commit || receipt.repository.dirtyStatusSha256 !== sourceDigest) problem(errors, location, 'must bind the manifest repository, commit, and recomputed dirty-status digest')
  if (!Array.isArray(receipt.scenarios)) {
    problem(errors, location, 'must bind the command scenarios')
    return
  }
  scenarios.filter(entry => entry.scenario.commandIds.includes(command.id)).forEach(({ scenario, index }) => {
    const receiptScenario = receipt.scenarios.find(entry => entry?.id === scenario.id)
    if (!receiptScenario || !sameJson(receiptScenario, {
      id: scenario.id,
      kind: scenario.kind,
      result: scenario.result,
      provenance: scenario.provenance,
      level: scenario.level,
      startedAt: scenario.startedAt,
      endedAt: scenario.endedAt
    })) {
      problem(errors, `proof.scenarios[${String(index)}]`, `must be exactly bound by command receipt ${receiptArtifact.id}`)
    }
    if (!profile.scenarioKinds.includes(scenario.kind)) problem(errors, `proof.scenarios[${String(index)}].kind`, `is not permitted by certified command profile ${command.profileId}`)
  })
}

function localRepositoryContainsCommit(root, repository, commit) {
  try {
    const remote = spawnSync('git', ['config', '--get', 'remote.origin.url'], { cwd: root, encoding: 'utf8', shell: false })
    if (remote.status !== 0) return !fs.existsSync(path.join(root, '.git'))
    if (remote.stdout.trim() !== repository) return true
    return spawnSync('git', ['cat-file', '-e', `${commit}^{commit}`], { cwd: root, stdio: 'ignore', shell: false }).status === 0
  } catch (error) {
    return false
  }
}

function resolveCertifiedExecutable(root, command) {
  if (command === 'node') return process.execPath
  if (command.includes(path.sep)) return path.resolve(root, command)
  const candidate = (process.env.PATH || '').split(path.delimiter).map(directory => path.join(directory, command)).find(file => fs.existsSync(file))
  if (!candidate) throw new Error(`cannot resolve certified executable: ${command}`)
  return candidate
}

function emitReceipt({ root, profileId, command, scenarios, outputArtifact, repository, runtime, environment = {} }) {
  assertCertifiedCommandProfile(profileId, command, repository)
  const executablePath = resolveCertifiedExecutable(root, command.argv[0])
  const executableBytes = fs.readFileSync(executablePath)
  const versionResult = spawnSync(executablePath, ['--version'], { encoding: 'utf8', shell: false })
  const executableVersion = versionResult.status === 0 ? (versionResult.stdout || versionResult.stderr).trim() : process.version
  const receipt = {
    schema: receiptSchema,
    version: receiptVersion,
    command: {
      id: command.id,
      argv: command.argv,
      cwd: command.cwd,
      startedAt: command.startedAt,
      endedAt: command.endedAt,
      exitCode: command.exitCode,
      toolIdentity: command.toolIdentity ?? null,
      profileId
    },
    scenarios,
    environment,
    executable: { path: path.basename(executablePath), sha256: sha256(executableBytes), version: executableVersion },
    output: outputArtifact,
    runtime,
    repository: { remote: repository.remote, commit: repository.commit, dirtyStatusSha256: repository.dirtyStatusSha256 }
  }
  receipt.receiptSha256 = receiptDigest(receipt)
  return receipt
}

module.exports = { assertCertifiedCommandProfile, bindScenariosToCommandWindow, canonicalJson, emitReceipt, localRepositoryContainsCommit, parseReceipt, receiptDigest, receiptSchema, receiptVersion, resolveCertifiedExecutable, validateReceipt }
