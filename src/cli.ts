// src/cli.ts

import { readFile, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { BleCentralBackend } from './backend-contract/backend'
import type { BackendIdentity, HostKind } from './backend-contract/identity'
import type { SerializableRecord, SerializableValue } from './backend-contract/primitives'
import {
  createBackendAuthorDefinition,
  inspectBackendCapabilities,
  runBackendAuthorTck,
  type BackendAuthoringDefinition,
  type BackendCapabilityReport
} from './backend-sdk-authoring'
import { parseCliJson } from './cli-json'
import {
  redactTraceDocument,
  validateTraceDocument,
  type DiagnosticTraceDocument,
  type TraceValidationResult
} from './diagnostics/trace-format'
import { baseTckScenarios } from './tck/scenarios'

const maximumTraceFileBytes = 1024 * 1024
const requireFromCliWorkingDirectory = createRequire(
  pathToFileURL(resolve(process.cwd(), 'unified-ble-manager-cli-loader.cjs')).href
)

export type UnifiedBleCliCommand = 'doctor' | 'capabilities' | 'trace' | 'tck' | 'scenario'

export interface UnifiedBleCliFailure {
  readonly code:
    | 'cli.argument-invalid'
    | 'cli.backend-load-failed'
    | 'cli.backend-invalid'
    | 'cli.host-unsupported'
    | 'cli.trace-invalid'
    | 'cli.execution-failed'
  readonly message: string
}

export interface UnifiedBleCliResult {
  readonly ok: boolean
  readonly command: UnifiedBleCliCommand | null
  readonly data: SerializableRecord | null
  readonly failures: readonly UnifiedBleCliFailure[]
}

export type CliBackendDefinition = BackendAuthoringDefinition<
  string,
  BackendIdentity<string>,
  BleCentralBackend<string, BackendIdentity<string>>
>

export interface UnifiedBleCliRuntime {
  readTextFile(path: string): Promise<string>
  loadBackendModule(moduleSpecifier: string): Promise<CliBackendDefinition>
}

/**
 * Runs non-interactive, Node-only diagnostics. A backend must be selected
 * explicitly; this command never selects or simulates a browser/RN radio.
 */
export async function runUnifiedBleCli(
  argumentsValue: readonly string[],
  runtime: UnifiedBleCliRuntime = defaultCliRuntime
): Promise<UnifiedBleCliResult> {
  const invocation = parseInvocation(argumentsValue)
  if (invocation instanceof UnifiedBleCliFailureError) {
    return failure(invocation.command, invocation.code, invocation.message)
  }
  try {
    if (invocation.command === 'trace') {
      return runTraceCommand(invocation, runtime)
    }
    const definition = await loadNodeBackendDefinition(invocation.backendModule, runtime)
    if (invocation.command === 'doctor') {
      return runDoctorCommand(definition)
    }
    if (invocation.command === 'capabilities') {
      return runCapabilitiesCommand(definition)
    }
    if (invocation.command === 'tck') {
      return runTckCommand(definition)
    }
    return runScenarioCommand(definition, invocation.scenarioId)
  } catch (error) {
    if (error instanceof UnifiedBleCliFailureError) {
      return failure(invocation.command, error.code, error.message)
    }
    const message = error instanceof Error ? error.message : 'operation threw a non-Error value'
    return failure(invocation.command, 'cli.execution-failed', message)
  }
}

interface ParsedTraceInvocation {
  readonly command: 'trace'
  readonly action: 'validate' | 'redact'
  readonly tracePath: string
}

interface ParsedBackendInvocation {
  readonly command: Exclude<UnifiedBleCliCommand, 'trace'>
  readonly backendModule: string
  readonly scenarioId: string | null
}

type ParsedInvocation = ParsedTraceInvocation | ParsedBackendInvocation

function parseInvocation(argumentsValue: readonly string[]): ParsedInvocation | UnifiedBleCliFailureError {
  const command = argumentsValue[0]
  if (!isCliCommand(command)) {
    return new UnifiedBleCliFailureError(
      'cli.argument-invalid',
      'expected doctor, capabilities, trace, tck, or scenario'
    )
  }
  if (command === 'trace') {
    const action = argumentsValue[1]
    const tracePath = argumentsValue[2]
    if ((action !== 'validate' && action !== 'redact') || tracePath === undefined || argumentsValue.length !== 3) {
      return new UnifiedBleCliFailureError('cli.argument-invalid', 'trace requires validate|redact <file>')
    }
    return { command, action, tracePath }
  }
  const options = parseOptions(argumentsValue.slice(1), command)
  if (options instanceof UnifiedBleCliFailureError) {
    return options
  }
  const backendModule = options.get('backend')
  if (backendModule === undefined) {
    return new UnifiedBleCliFailureError('cli.argument-invalid', `${command} requires --backend <module>`, command)
  }
  const scenarioId = options.get('scenario')
  if (command === 'scenario' && scenarioId === undefined) {
    return new UnifiedBleCliFailureError('cli.argument-invalid', 'scenario requires --scenario <id>', command)
  }
  if (command !== 'scenario' && scenarioId !== undefined) {
    return new UnifiedBleCliFailureError('cli.argument-invalid', `${command} does not accept --scenario`, command)
  }
  return { command, backendModule, scenarioId: scenarioId ?? null }
}

function parseOptions(
  argumentsValue: readonly string[],
  command: Exclude<UnifiedBleCliCommand, 'trace'>
): ReadonlyMap<string, string> | UnifiedBleCliFailureError {
  const allowed = command === 'scenario' ? new Set(['backend', 'scenario']) : new Set(['backend'])
  const options = new Map<string, string>()
  for (let index = 0; index < argumentsValue.length; index += 1) {
    const token = argumentsValue[index]
    if (token === undefined || !token.startsWith('--')) {
      return new UnifiedBleCliFailureError('cli.argument-invalid', `${command} accepts named options only`)
    }
    const name = token.slice(2)
    if (!allowed.has(name)) {
      return new UnifiedBleCliFailureError('cli.argument-invalid', `${command} does not accept --${name}`)
    }
    if (options.has(name)) {
      return new UnifiedBleCliFailureError('cli.argument-invalid', `--${name} may be provided once`)
    }
    const value = argumentsValue[index + 1]
    if (value === undefined || value.startsWith('--') || value.length === 0) {
      return new UnifiedBleCliFailureError('cli.argument-invalid', `--${name} requires a value`)
    }
    options.set(name, value)
    index += 1
  }
  return options
}

async function loadNodeBackendDefinition(
  moduleSpecifier: string,
  runtime: UnifiedBleCliRuntime
): Promise<CliBackendDefinition> {
  let definition: CliBackendDefinition
  try {
    definition = await runtime.loadBackendModule(moduleSpecifier)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'backend module loader threw a non-Error value'
    throw new UnifiedBleCliFailureError('cli.backend-load-failed', `unable to load ${moduleSpecifier}: ${message}`)
  }
  try {
    const verified = createBackendAuthorDefinition(definition)
    assertNodeCapableHost(verified.factory.provider.descriptor.hostKind)
    return verified
  } catch (error) {
    if (error instanceof UnifiedBleCliFailureError) {
      throw error
    }
    const message = error instanceof Error ? error.message : 'backend definition validation threw a non-Error value'
    throw new UnifiedBleCliFailureError(
      'cli.backend-invalid',
      `invalid backend definition from ${moduleSpecifier}: ${message}`
    )
  }
}

function assertNodeCapableHost(hostKind: HostKind): void {
  if (hostKind !== 'node' && hostKind !== 'electron-main' && hostKind !== 'test') {
    throw new UnifiedBleCliFailureError(
      'cli.host-unsupported',
      `CLI cannot drive ${hostKind}; select an explicit Node-capable backend`
    )
  }
}

async function runDoctorCommand(definition: CliBackendDefinition): Promise<UnifiedBleCliResult> {
  const adapters = await definition.factory.provider.listAdapters()
  return success('doctor', {
    backendId: definition.metadata.backendId,
    platformId: definition.metadata.platformId,
    providerId: definition.factory.provider.descriptor.providerId,
    hostKind: definition.factory.provider.descriptor.hostKind,
    loadability: definition.factory.provider.descriptor.loadability,
    selectedAdapterId: String(definition.factory.selection.selectedAdapterId),
    adapters: adapters.map(adapter => ({
      adapterId: String(adapter.adapterId),
      displayName: adapter.displayName,
      availability: adapter.state.availability,
      authorization: adapter.state.authorization,
      power: adapter.state.power,
      safeReason: adapter.state.safeReason,
      limitations: [...adapter.limitations]
    }))
  })
}

async function runCapabilitiesCommand(definition: CliBackendDefinition): Promise<UnifiedBleCliResult> {
  const fixture = await definition.factory.create()
  try {
    return success('capabilities', capabilityReportData(inspectBackendCapabilities(fixture.backend)))
  } finally {
    await fixture.dispose()
  }
}

async function runTckCommand(definition: CliBackendDefinition): Promise<UnifiedBleCliResult> {
  const report = await runBackendAuthorTck(definition)
  return success('tck', tckReportData(report))
}

async function runScenarioCommand(
  definition: CliBackendDefinition,
  scenarioId: string | null
): Promise<UnifiedBleCliResult> {
  if (scenarioId === null) {
    throw new UnifiedBleCliFailureError('cli.argument-invalid', 'scenario requires --scenario <id>')
  }
  const requestedScenario = baseTckScenarios.find(candidate => candidate.id === scenarioId)
  if (requestedScenario === undefined) {
    throw new UnifiedBleCliFailureError('cli.argument-invalid', `TCK scenario is not registered: ${scenarioId}`)
  }
  const report = await runBackendAuthorTck(definition)
  const receipt = report.receipts.find(candidate => candidate.scenarioId === requestedScenario.id)
  if (receipt === undefined) {
    throw new UnifiedBleCliFailureError(
      'cli.execution-failed',
      `selected backend did not execute applicable scenario ${requestedScenario.id}`
    )
  }
  return success('scenario', {
    scenarioId: requestedScenario.id,
    receipt: tckReceiptData(receipt),
    verification: report.verification,
    proofScope: report.proofScope
  })
}

async function runTraceCommand(
  invocation: ParsedTraceInvocation,
  runtime: UnifiedBleCliRuntime
): Promise<UnifiedBleCliResult> {
  let input: SerializableValue
  try {
    input = parseCliJson(await runtime.readTextFile(invocation.tracePath))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'trace input failed without an Error value'
    return failure('trace', 'cli.trace-invalid', message)
  }
  if (invocation.action === 'redact') {
    try {
      const trace = redactTraceDocument(input)
      return success('trace', { action: 'redact', trace })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'trace redaction failed without an Error value'
      return failure('trace', 'cli.trace-invalid', message)
    }
  }
  const validation = validateTraceDocument(input)
  return traceValidationResult(validation)
}

function traceValidationResult(validation: TraceValidationResult): UnifiedBleCliResult {
  const data = {
    valid: validation.valid,
    failures: validation.failures.map(item => ({ path: item.path, reason: item.reason }))
  }
  if (validation.valid) {
    return success('trace', data)
  }
  return {
    ok: false,
    command: 'trace',
    data,
    failures: [
      {
        code: 'cli.trace-invalid',
        message: `trace format validation failed with ${validation.failures.length} violation(s)`
      }
    ]
  }
}

function capabilityReportData(report: BackendCapabilityReport): SerializableRecord {
  return {
    backendId: report.backendId,
    platformId: report.platformId,
    capabilities: report.capabilities.map(capability => ({
      id: capability.id,
      state: capability.state,
      implementationOrigin: capability.implementationOrigin,
      tck: {
        suiteId: capability.tck.suiteId,
        requiredScenarioIds: [...capability.tck.requiredScenarioIds],
        contractMinimum: capability.tck.contractMinimum,
        contractMaximum: capability.tck.contractMaximum
      },
      evidence: {
        verification: capability.evidence.verification,
        receiptId: capability.evidence.receiptId,
        evidenceLevel: capability.evidence.evidenceLevel,
        implementationVersion: capability.evidence.implementationVersion,
        sourceDigest: capability.evidence.sourceDigest,
        scenarioIds: [...capability.evidence.scenarioIds]
      },
      limitations: capability.limitations.map(limitation => ({
        code: limitation.code,
        explanation: limitation.explanation,
        affectedGuarantee: limitation.affectedGuarantee
      })),
      limits: capability.limits
    }))
  }
}

function tckReportData(report: Awaited<ReturnType<typeof runBackendAuthorTck>>): SerializableRecord {
  return {
    backendId: report.backendId,
    verification: report.verification,
    proofScope: report.proofScope,
    identity: {
      registeredBackendId: report.identity.registeredBackendId,
      registeredPlatformId: report.identity.registeredPlatformId,
      providerId: report.identity.providerId,
      hostKind: report.identity.hostKind,
      implementationVersion: report.identity.implementationVersion,
      selectedAdapterId: report.identity.selectedAdapterId
    },
    baseScenarioIds: [...report.baseScenarioIds],
    featureSuiteIds: [...report.featureSuiteIds],
    featureBindings: report.featureBindings.map(binding => ({
      featureId: binding.featureId,
      state: binding.state,
      implementationOrigin: binding.implementationOrigin,
      suiteId: binding.suiteId,
      requiredScenarioIds: [...binding.requiredScenarioIds],
      contractMinimum: binding.contractMinimum,
      contractMaximum: binding.contractMaximum,
      evidenceVerification: binding.evidenceVerification,
      receiptId: binding.receiptId,
      evidenceLevel: binding.evidenceLevel,
      implementationVersion: binding.implementationVersion,
      sourceDigest: binding.sourceDigest,
      evidenceScenarioIds: [...binding.evidenceScenarioIds],
      limitations: binding.limitations.map(limitation => ({
        code: limitation.code,
        explanation: limitation.explanation,
        affectedGuarantee: limitation.affectedGuarantee
      })),
      limits: binding.limits
    })),
    receipts: report.receipts.map(tckReceiptData)
  }
}

function tckReceiptData(
  receipt: Awaited<ReturnType<typeof runBackendAuthorTck>>['receipts'][number]
): SerializableRecord {
  return {
    scenarioId: receipt.scenarioId,
    proof: {
      scope: receipt.proof.scope,
      claim: receipt.proof.claim,
      receiptId: receipt.proof.receiptId
    },
    facts: receipt.facts.map(fact => ({ id: fact.id, holds: fact.holds, detail: fact.detail })),
    error:
      receipt.error === null
        ? null
        : {
            code: receipt.error.code,
            domain: receipt.error.domain,
            operation: receipt.error.operation
          }
  }
}

function success(command: UnifiedBleCliCommand, data: SerializableRecord): UnifiedBleCliResult {
  return { ok: true, command, data, failures: [] }
}

function failure(
  command: UnifiedBleCliCommand | null,
  code: UnifiedBleCliFailure['code'],
  message: string
): UnifiedBleCliResult {
  return { ok: false, command, data: null, failures: [{ code, message }] }
}

function isCliCommand(value: string | undefined): value is UnifiedBleCliCommand {
  return value === 'doctor' || value === 'capabilities' || value === 'trace' || value === 'tck' || value === 'scenario'
}

class UnifiedBleCliFailureError extends Error {
  constructor(
    readonly code: UnifiedBleCliFailure['code'],
    message: string,
    readonly command: UnifiedBleCliCommand | null = null
  ) {
    super(message)
    this.name = 'UnifiedBleCliFailureError'
  }
}

const defaultCliRuntime: UnifiedBleCliRuntime = {
  readTextFile: async path => {
    const metadata = await stat(path)
    if (!metadata.isFile()) {
      throw new Error(`trace input is not a regular file: ${path}`)
    }
    if (metadata.size > maximumTraceFileBytes) {
      throw new Error(`trace input exceeds ${maximumTraceFileBytes} bytes: ${path}`)
    }
    return readFile(path, 'utf8')
  },
  loadBackendModule: async moduleSpecifier => {
    const filePath = filePathFromModuleSpecifier(moduleSpecifier)
    const requireSpecifier = filePath ?? moduleSpecifier
    if (!isExplicitEsModuleFile(requireSpecifier)) {
      try {
        const required: { readonly unifiedBleBackend?: CliBackendDefinition } =
          requireFromCliWorkingDirectory(requireSpecifier)
        return requiredBackendDefinition(required)
      } catch (error) {
        if (!isEsModuleRequireError(error)) {
          throw error
        }
      }
    }
    const importSpecifier = dynamicImportSpecifier(moduleSpecifier, filePath)
    try {
      const imported = await importBackendModule(importSpecifier)
      return requiredBackendDefinition(imported)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`ES module import failed for ${importSpecifier}: ${detail}`, { cause: error })
    }
  }
}

function isRelativeOrAbsolutePath(moduleSpecifier: string): boolean {
  return moduleSpecifier.startsWith('.') || isAbsolute(moduleSpecifier)
}

function filePathFromModuleSpecifier(moduleSpecifier: string): string | null {
  if (!moduleSpecifier.startsWith('file:')) {
    return null
  }
  const url = new URL(moduleSpecifier)
  if (url.protocol !== 'file:') {
    throw new Error(`backend module URL must use the file protocol: ${moduleSpecifier}`)
  }
  return fileURLToPath(moduleSpecifier)
}

function dynamicImportSpecifier(moduleSpecifier: string, filePath: string | null): string {
  if (filePath !== null) {
    return pathToFileURL(filePath).href
  }
  if (isRelativeOrAbsolutePath(moduleSpecifier)) {
    return pathToFileURL(resolve(process.cwd(), moduleSpecifier)).href
  }
  return moduleSpecifier
}

function isExplicitEsModuleFile(moduleSpecifier: string): boolean {
  return moduleSpecifier.toLowerCase().endsWith('.mjs')
}

/**
 * Keeps Node's native `import()` available when a CommonJS test runner has
 * transformed this source file. The function body is static and never embeds a
 * backend-supplied specifier; the specifier remains a dynamic-import argument.
 */
async function importBackendModule(
  importSpecifier: string
): Promise<{ readonly unifiedBleBackend?: CliBackendDefinition }> {
  // eslint-disable-next-line no-new-func -- The static expression preserves Node import() under transformed CommonJS tests.
  const nativeDynamicImport = Function('specifier', 'return import(specifier)')
  const imported: unknown = nativeDynamicImport(importSpecifier)
  if (!isPromiseLike(imported)) {
    throw new Error('native dynamic import did not return a promise')
  }
  let namespace: unknown
  try {
    namespace = await imported
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`native dynamic import failed: ${detail}`, { cause: error })
  }
  if (!isBackendModuleNamespace(namespace)) {
    throw new Error('dynamic import did not return a module namespace')
  }
  return namespace
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    'then' in value &&
    typeof value.then === 'function'
  )
}

function isBackendModuleNamespace(value: unknown): value is { readonly unifiedBleBackend?: CliBackendDefinition } {
  return value !== null && typeof value === 'object'
}

function isEsModuleRequireError(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === 'ERR_REQUIRE_ESM'
}

function requiredBackendDefinition(moduleNamespace: {
  readonly unifiedBleBackend?: CliBackendDefinition
}): CliBackendDefinition {
  const definition = moduleNamespace.unifiedBleBackend
  if (definition === undefined) {
    throw new Error('module must export unifiedBleBackend')
  }
  return definition
}

export function formatUnifiedBleCliResult(result: UnifiedBleCliResult): string {
  return `${JSON.stringify(result)}\n`
}

export { redactTraceDocument, validateTraceDocument }
export type { DiagnosticTraceDocument, TraceValidationResult }

export function extractRedactedTrace(result: UnifiedBleCliResult): DiagnosticTraceDocument | null {
  if (result.command !== 'trace' || result.data === null || result.data.action !== 'redact') {
    return null
  }
  const trace = result.data.trace
  if (trace === undefined || typeof trace !== 'object' || trace === null || Array.isArray(trace)) {
    return null
  }
  return validateTraceDocument(trace).valid ? redactTraceDocument(trace) : null
}
