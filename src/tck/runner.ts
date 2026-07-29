// src/tck/runner.ts

import { validateFeatureRegistration, type FeatureState } from '../backend-contract/capabilities'
import type { BleCentralBackend } from '../backend-contract/backend'
import type { BackendIdentity } from '../backend-contract/identity'
import type { SerializableRecord, SerializableValue } from '../backend-contract/primitives'
import { snapshotSerializableRecord } from '../backend-contract/serializable'
import type {
  BackendTckFactory,
  BackendTckFixture,
  RegisteredFeature,
  TckFeatureBinding,
  TckFeatureSuite,
  TckFact,
  TckRuntimeIdentity,
  TckRunOptions,
  TckRunReport,
  TckScenarioDefinition,
  TckScenarioId,
  TckScenarioReceipt
} from './contracts'
import { TckAssertionError } from './contracts'
import {
  claimRunnerOwnedBackend,
  executeProviderOnlyTckScenario,
  executeRunnerOwnedTckScenario,
  isProviderOnlyTckScenario
} from './runner-observers'
import { baseTckScenarios, findTckScenario } from './scenarios'

/**
 * Executes every required TCK scenario through an isolated fixture. Feature
 * suites are declarative bindings only: they cannot manufacture a receipt or
 * claim that a backend scenario passed without fixture execution.
 */
export async function runBackendTck<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(
  factory: BackendTckFactory<Attachment, Identity, Backend>,
  featureSuites: readonly TckFeatureSuite[],
  options: TckRunOptions = Object.freeze({ proofScope: 'deterministic' })
): Promise<TckRunReport> {
  const selectedBaseScenarios = snapshotRunOptions(options)
  const identity = await verifyFactoryRuntimeIdentity(factory)
  const receipts = await runBaseSuites(factory, identity, selectedBaseScenarios, options.proofScope)
  const featureRun = await runRegisteredFeatureSuites(factory, identity, featureSuites, receipts, options.proofScope)
  return Object.freeze({
    backendId: identity.registeredBackendId,
    identity,
    verification: 'runner-controlled',
    proofScope: options.proofScope,
    baseScenarioIds: Object.freeze(selectedBaseScenarios.map(definition => definition.id)),
    featureSuiteIds: featureRun.suiteIds,
    featureBindings: featureRun.bindings,
    receipts: Object.freeze(receipts)
  })
}

function snapshotRunOptions(options: TckRunOptions): readonly TckScenarioDefinition[] {
  if (options.proofScope !== 'deterministic') {
    throw new TckAssertionError('identity.provider-loadability-and-adapter-availability', 'unsupported TCK proof scope')
  }
  if (options.baseScenarioIds === undefined) {
    return baseTckScenarios.filter(definition => definition.execution === 'base')
  }
  if (options.baseScenarioIds.length === 0) {
    throw new TckAssertionError(
      'identity.provider-loadability-and-adapter-availability',
      'base scenario selection is empty'
    )
  }
  const selected = new Set<TckScenarioId>()
  const definitions: TckScenarioDefinition[] = []
  for (const scenarioId of options.baseScenarioIds) {
    const definition = findTckScenario(scenarioId)
    if (definition.execution !== 'base') {
      throw new TckAssertionError(scenarioId, 'base scenario selection includes a feature scenario')
    }
    if (selected.has(scenarioId)) {
      throw new TckAssertionError(scenarioId, 'base scenario selection repeats a scenario')
    }
    selected.add(scenarioId)
    definitions.push(definition)
  }
  return Object.freeze(definitions)
}

interface FeatureRunSelection {
  readonly suiteIds: readonly string[]
  readonly bindings: readonly TckFeatureBinding[]
}

interface FeatureScenarioExecution {
  readonly binding: TckFeatureBinding
  readonly definition: TckScenarioDefinition
}

async function runBaseSuites<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(
  factory: BackendTckFactory<Attachment, Identity, Backend>,
  identity: TckRuntimeIdentity,
  definitions: readonly TckScenarioDefinition[],
  proofScope: 'deterministic'
): Promise<TckScenarioReceipt[]> {
  const receipts: TckScenarioReceipt[] = []
  const deferredCleanupErrors: TckFixtureCleanupError[] = []
  for (const definition of definitions) {
    try {
      receipts.push(await executeDefinition(factory, identity, definition, proofScope))
    } catch (error) {
      if (error instanceof TckFixtureCleanupError) {
        deferredCleanupErrors.push(error)
        continue
      }
      if (deferredCleanupErrors.length > 0) {
        throw new AggregateError(
          [...deferredCleanupErrors, error],
          `${definition.id}: prior fixture cleanup and scenario execution failed`
        )
      }
      throw error
    }
  }
  if (deferredCleanupErrors.length === 1) {
    throw deferredCleanupErrors[0]
  }
  if (deferredCleanupErrors.length > 1) {
    throw new AggregateError(deferredCleanupErrors, 'multiple base TCK fixture cleanups failed')
  }
  return receipts
}

async function runRegisteredFeatureSuites<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(
  factory: BackendTckFactory<Attachment, Identity, Backend>,
  identity: TckRuntimeIdentity,
  featureSuites: readonly TckFeatureSuite[],
  receipts: TckScenarioReceipt[],
  proofScope: 'deterministic'
): Promise<FeatureRunSelection> {
  const suitesById = indexFeatureSuites(featureSuites)
  const bindings = await runtimeValidateFeatureRegistrations(factory, identity)
  const selectedSuiteIds = new Set<string>()
  const executions: FeatureScenarioExecution[] = []

  for (const binding of bindings) {
    if (!assertFeatureRegistration(binding)) {
      continue
    }
    const suite = suitesById.get(binding.suiteId)
    if (suite === undefined) {
      throw new TckAssertionError(
        'capability.truth-limits-evidence-and-binding',
        `feature ${binding.featureId} requires unavailable TCK suite ${binding.suiteId}`
      )
    }
    const definitions = requiredFeatureScenarioDefinitions(binding, suite)
    selectedSuiteIds.add(suite.suiteId)
    for (const definition of definitions) {
      executions.push({ binding, definition })
    }
  }

  for (const execution of executions) {
    receipts.push(
      await executeFeatureDefinition(factory, identity, execution.binding, execution.definition, proofScope)
    )
  }
  return {
    suiteIds: Object.freeze([...selectedSuiteIds]),
    bindings: Object.freeze(bindings.filter(binding => requiresFeatureSuite(binding.state)))
  }
}

function indexFeatureSuites(featureSuites: readonly TckFeatureSuite[]): ReadonlyMap<string, TckFeatureSuite> {
  const suitesById = new Map<string, TckFeatureSuite>()
  for (const suite of featureSuites) {
    if (suite.suiteId.length === 0) {
      throw new TckAssertionError('capability.truth-limits-evidence-and-binding', 'feature suite has an empty ID')
    }
    if (suitesById.has(suite.suiteId)) {
      throw new TckAssertionError(
        'capability.truth-limits-evidence-and-binding',
        `duplicate feature suite ${suite.suiteId}`
      )
    }
    const seenScenarioIds = new Set<TckScenarioId>()
    for (const scenarioId of suite.scenarioIds) {
      const definition = findTckScenario(scenarioId)
      if (definition.execution !== 'feature') {
        throw new TckAssertionError(
          'capability.truth-limits-evidence-and-binding',
          `feature suite ${suite.suiteId} includes non-feature scenario ${scenarioId}`
        )
      }
      if (seenScenarioIds.has(scenarioId)) {
        throw new TckAssertionError(
          'capability.truth-limits-evidence-and-binding',
          `feature suite ${suite.suiteId} repeats scenario ${scenarioId}`
        )
      }
      seenScenarioIds.add(scenarioId)
    }
    suitesById.set(suite.suiteId, suite)
  }
  return suitesById
}

async function runtimeValidateFeatureRegistrations<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(
  factory: BackendTckFactory<Attachment, Identity, Backend>,
  identity: TckRuntimeIdentity
): Promise<readonly TckFeatureBinding[]> {
  return withFixture(factory, identity, 'capability.truth-limits-evidence-and-binding', async fixture => {
    const registrations = fixture.backend.features.registrations
    const bindings: TckFeatureBinding[] = []
    for (const registration of registrations) {
      try {
        validateFeatureRegistration(registration)
      } catch (error) {
        const validationDetail = error instanceof Error ? error.message : 'validator threw a non-Error value'
        throw new TckAssertionError(
          'capability.truth-limits-evidence-and-binding',
          `feature ${registration.id} fails runtime registration validation: ${validationDetail}`
        )
      }
      // Unsupported and unavailable capabilities remain validated runtime truth,
      // but have no executable standard TCK suite to bind to this runner.
      if (requiresFeatureSuite(registration.state)) {
        bindings.push(snapshotFeatureBinding(registration))
      }
    }
    return Object.freeze(bindings)
  })
}

function requiredFeatureScenarioDefinitions(
  binding: TckFeatureBinding,
  suite: TckFeatureSuite
): readonly TckScenarioDefinition[] {
  const allowedScenarioIds = new Set<TckScenarioId>(suite.scenarioIds)
  const definitions: TckScenarioDefinition[] = []
  const seenScenarioIds = new Set<TckScenarioId>()
  for (const scenarioId of binding.requiredScenarioIds) {
    const definition = findTckScenario(scenarioId)
    if (definition.execution !== 'feature') {
      throw new TckAssertionError(
        'capability.truth-limits-evidence-and-binding',
        `feature ${binding.featureId} requires non-feature scenario ${scenarioId}`
      )
    }
    if (!allowedScenarioIds.has(scenarioId)) {
      throw new TckAssertionError(
        'capability.truth-limits-evidence-and-binding',
        `feature ${binding.featureId} requires scenario ${scenarioId} outside suite ${suite.suiteId}`
      )
    }
    if (seenScenarioIds.has(scenarioId)) {
      throw new TckAssertionError(
        'capability.truth-limits-evidence-and-binding',
        `feature ${binding.featureId} repeats required scenario ${scenarioId}`
      )
    }
    seenScenarioIds.add(scenarioId)
    definitions.push(definition)
  }
  return definitions
}

function assertFeatureRegistration(binding: TckFeatureBinding): boolean {
  const state = binding.state
  if ((state === 'supported' || state === 'limited') && binding.requiredScenarioIds.length === 0) {
    throw new TckAssertionError(
      'capability.truth-limits-evidence-and-binding',
      `feature ${binding.featureId} has no required TCK scenarios`
    )
  }
  if (
    state === 'supported' &&
    binding.evidenceLevel !== 'supported' &&
    binding.evidenceLevel !== 'reliability-qualified'
  ) {
    throw new TckAssertionError(
      'capability.truth-limits-evidence-and-binding',
      `feature ${binding.featureId} is supported without live or reliability-qualified evidence`
    )
  }
  if ((state === 'limited' || state === 'unsupported' || state === 'unavailable') && binding.limitations.length === 0) {
    throw new TckAssertionError(
      'capability.truth-limits-evidence-and-binding',
      `feature ${binding.featureId} lacks a required structured limitation for ${state}`
    )
  }
  return requiresFeatureSuite(state)
}

function requiresFeatureSuite(state: FeatureState): boolean {
  return state === 'supported' || state === 'limited'
}

function isTckScenarioId(value: string): value is TckScenarioId {
  for (const definition of baseTckScenarios) {
    if (definition.id === value) {
      return true
    }
  }
  return false
}

async function executeDefinition<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(
  factory: BackendTckFactory<Attachment, Identity, Backend>,
  identity: TckRuntimeIdentity,
  definition: TckScenarioDefinition,
  proofScope: 'deterministic'
): Promise<TckScenarioReceipt> {
  if (factory.providerOnlyIdentityScenarios === true && isProviderOnlyTckScenario(definition)) {
    const facts = await executeProviderOnlyTckScenario(factory, definition)
    return receiptFromFacts(definition, facts, proofScope)
  }
  return withFixture(factory, identity, definition.id, async fixture => {
    assertRequiredControllerActions(fixture, definition)
    return executeRunnerControlledDefinition(factory, fixture, definition, proofScope)
  })
}

async function executeFeatureDefinition<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(
  factory: BackendTckFactory<Attachment, Identity, Backend>,
  identity: TckRuntimeIdentity,
  binding: TckFeatureBinding,
  definition: TckScenarioDefinition,
  proofScope: 'deterministic'
): Promise<TckScenarioReceipt> {
  return withFixture(factory, identity, definition.id, async fixture => {
    assertRequiredControllerActions(fixture, definition)
    assertFeatureAuthority(fixture.backend.features.registrations, binding, definition.id, 'before')
    const receipt = await executeRunnerControlledDefinition(factory, fixture, definition, proofScope)
    assertFeatureAuthority(fixture.backend.features.registrations, binding, definition.id, 'after')
    return receipt
  })
}

function assertRequiredControllerActions<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(fixture: BackendTckFixture<Attachment, Identity, Backend>, definition: TckScenarioDefinition): void {
  const declaredActions = new Set(fixture.controller.availableActions)
  for (const action of definition.requiredControllerActions) {
    if (!declaredActions.has(action)) {
      throw new TckAssertionError(definition.id, `fixture controller lacks required action ${action}`)
    }
  }
}

function snapshotFeatureBinding(registration: RegisteredFeature): TckFeatureBinding {
  const requiredScenarioIds: TckScenarioId[] = []
  for (const scenarioId of registration.tck.requiredScenarioIds) {
    if (!isTckScenarioId(scenarioId)) {
      throw new TckAssertionError(
        'capability.truth-limits-evidence-and-binding',
        `feature ${registration.id} requires unregistered scenario ${scenarioId}`
      )
    }
    requiredScenarioIds.push(scenarioId)
  }
  const limitations = Object.freeze(
    registration.limitations.map(limitation =>
      Object.freeze({
        code: limitation.code,
        explanation: limitation.explanation,
        affectedGuarantee: limitation.affectedGuarantee
      })
    )
  )
  return Object.freeze({
    featureId: registration.id,
    state: registration.state,
    implementationOrigin: registration.implementationOrigin,
    suiteId: registration.tck.suiteId,
    requiredScenarioIds: Object.freeze(requiredScenarioIds),
    contractMinimum: registration.tck.contractRange.minimum.value,
    contractMaximum: registration.tck.contractRange.maximum.value,
    evidenceVerification: 'author-declared',
    receiptId: registration.evidence.receiptId,
    evidenceLevel: registration.evidence.evidenceLevel,
    implementationVersion: registration.evidence.implementationVersion,
    sourceDigest: registration.evidence.sourceDigest,
    evidenceScenarioIds: Object.freeze([...registration.evidence.scenarioIds]),
    limitations,
    limits: snapshotSerializableRecord(registration.limits).value
  })
}

function assertFeatureAuthority(
  registrations: readonly RegisteredFeature[],
  expected: TckFeatureBinding,
  scenarioId: TckScenarioId,
  phase: 'before' | 'after'
): void {
  const matches = registrations.filter(registration => registration.id === expected.featureId)
  if (matches.length !== 1) {
    throw new TckAssertionError(
      scenarioId,
      `feature ${expected.featureId} registration count changed to ${matches.length} ${phase} feature execution`
    )
  }
  const registration = matches[0]
  if (registration === undefined) {
    throw new TckAssertionError(scenarioId, `feature ${expected.featureId} registration is unavailable`)
  }
  try {
    validateFeatureRegistration(registration)
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'validator threw a non-Error value'
    throw new TckAssertionError(
      scenarioId,
      `feature ${expected.featureId} registration became invalid ${phase} feature execution: ${detail}`
    )
  }
  const observed = snapshotFeatureBinding(registration)
  if (!featureBindingsEqual(observed, expected)) {
    throw new TckAssertionError(
      scenarioId,
      `feature ${expected.featureId} registration/evidence authority changed ${phase} feature execution`
    )
  }
}

function featureBindingsEqual(left: TckFeatureBinding, right: TckFeatureBinding): boolean {
  return (
    left.featureId === right.featureId &&
    left.state === right.state &&
    left.implementationOrigin === right.implementationOrigin &&
    left.suiteId === right.suiteId &&
    stringArraysEqual(left.requiredScenarioIds, right.requiredScenarioIds) &&
    left.contractMinimum === right.contractMinimum &&
    left.contractMaximum === right.contractMaximum &&
    left.evidenceVerification === right.evidenceVerification &&
    left.receiptId === right.receiptId &&
    left.evidenceLevel === right.evidenceLevel &&
    left.implementationVersion === right.implementationVersion &&
    left.sourceDigest === right.sourceDigest &&
    stringArraysEqual(left.evidenceScenarioIds, right.evidenceScenarioIds) &&
    limitationsEqual(left.limitations, right.limitations) &&
    serializableRecordsEqual(left.limits, right.limits)
  )
}

function stringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function limitationsEqual(left: TckFeatureBinding['limitations'], right: TckFeatureBinding['limitations']): boolean {
  return (
    left.length === right.length &&
    left.every(
      (limitation, index) =>
        limitation.code === right[index]?.code &&
        limitation.explanation === right[index]?.explanation &&
        limitation.affectedGuarantee === right[index]?.affectedGuarantee
    )
  )
}

function serializableRecordsEqual(left: SerializableRecord, right: SerializableRecord): boolean {
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  return (
    stringArraysEqual(leftKeys, rightKeys) &&
    leftKeys.every(key => serializableValuesEqual(left[key] ?? null, right[key] ?? null))
  )
}

function serializableValuesEqual(left: SerializableValue, right: SerializableValue): boolean {
  if (left instanceof Uint8Array || right instanceof Uint8Array) {
    return (
      left instanceof Uint8Array &&
      right instanceof Uint8Array &&
      left.byteLength === right.byteLength &&
      left.every((byte, index) => byte === right[index])
    )
  }
  if (isSerializableArray(left) || isSerializableArray(right)) {
    return (
      isSerializableArray(left) &&
      isSerializableArray(right) &&
      left.length === right.length &&
      left.every((value, index) => {
        const rightValue = right[index]
        return rightValue !== undefined && serializableValuesEqual(value, rightValue)
      })
    )
  }
  if (left !== null && right !== null && typeof left === 'object' && typeof right === 'object') {
    return serializableRecordsEqual(left, right)
  }
  return left === right
}

function isSerializableArray(value: SerializableValue): value is readonly SerializableValue[] {
  return Array.isArray(value)
}

/** Creates one fixture per scenario and always releases it once created. */
async function withFixture<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>,
  Value
>(
  factory: BackendTckFactory<Attachment, Identity, Backend>,
  identity: TckRuntimeIdentity,
  scenarioId: TckScenarioId,
  operation: (fixture: BackendTckFixture<Attachment, Identity, Backend>) => Promise<Value>
): Promise<Value> {
  const fixture = await factory.create(Object.freeze({ scenarioId }))
  const operationOutcome = await executeFixtureOperation(factory, fixture, identity, scenarioId, operation)
  const cleanupOutcome = await disposeFixture(fixture, scenarioId)
  if (operationOutcome.status === 'rejected' && cleanupOutcome.status === 'rejected') {
    throw new AggregateError(
      [operationOutcome.error, cleanupOutcome.error],
      `${scenarioId}: scenario execution and fixture cleanup both failed`
    )
  }
  if (operationOutcome.status === 'rejected') {
    throw operationOutcome.error
  }
  if (cleanupOutcome.status === 'rejected') {
    throw cleanupOutcome.error
  }
  return operationOutcome.value
}

interface TckOperationFulfilled<Value> {
  readonly status: 'fulfilled'
  readonly value: Value
}

interface TckOperationRejected {
  readonly status: 'rejected'
  readonly error: unknown
}

type TckOperationOutcome<Value> = TckOperationFulfilled<Value> | TckOperationRejected

class TckFixtureCleanupError extends TckAssertionError {}

async function executeFixtureOperation<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>,
  Value
>(
  factory: BackendTckFactory<Attachment, Identity, Backend>,
  fixture: BackendTckFixture<Attachment, Identity, Backend>,
  identity: TckRuntimeIdentity,
  scenarioId: TckScenarioId,
  operation: (fixture: BackendTckFixture<Attachment, Identity, Backend>) => Promise<Value>
): Promise<TckOperationOutcome<Value>> {
  try {
    claimRunnerOwnedBackend(fixture.backend, scenarioId)
    assertProviderDescriptorBinding(factory, identity)
    assertBackendIdentityBinding(fixture.backend, identity, 'fixture')
    const value = await operation(fixture)
    assertProviderDescriptorBinding(factory, identity)
    assertBackendIdentityBinding(fixture.backend, identity, 'fixture')
    return fulfilled(value)
  } catch (error) {
    return rejected(error)
  }
}

async function disposeFixture<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(
  fixture: BackendTckFixture<Attachment, Identity, Backend>,
  scenarioId: TckScenarioId
): Promise<TckOperationOutcome<void>> {
  let cleanupPromise: Promise<import('../backend-contract/errors').CleanupRecord>
  try {
    cleanupPromise = fixture.dispose()
  } catch (error) {
    return rejected(new TckFixtureCleanupError(scenarioId, 'fixture cleanup threw synchronously', { cause: error }))
  }
  return cleanupPromise.then(
    cleanup => {
      if (cleanup.state !== 'released' || cleanup.failures.length !== 0) {
        return rejected(
          new TckFixtureCleanupError(
            scenarioId,
            `fixture cleanup returned ${cleanup.state} with failures: ${
              cleanup.failures.map(failure => failure.error.code).join(', ') || 'none'
            }`
          )
        )
      }
      return fulfilled(undefined)
    },
    error => rejected(new TckFixtureCleanupError(scenarioId, 'fixture cleanup rejected', { cause: error }))
  )
}

function fulfilled<Value>(value: Value): TckOperationFulfilled<Value> {
  return { status: 'fulfilled', value }
}

function rejected(error: unknown): TckOperationRejected {
  return { status: 'rejected', error }
}

async function verifyFactoryRuntimeIdentity<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(factory: BackendTckFactory<Attachment, Identity, Backend>): Promise<TckRuntimeIdentity> {
  const descriptor = factory.provider.descriptor
  if (descriptor.providerId.length === 0) {
    throw identityAssertion('provider descriptor has an empty providerId')
  }
  if (descriptor.loadability !== 'loadable') {
    throw identityAssertion(`provider ${descriptor.providerId} is not loadable`)
  }
  const adapters = await factory.provider.listAdapters()
  const selection = factory.selection
  if (selection === undefined || selection.selectedAdapterId === undefined) {
    throw identityAssertion(`provider ${descriptor.providerId} requires an explicit factory adapter selection`)
  }
  const staleSelection = factory.staleSelection
  if (staleSelection === undefined || staleSelection.selectedAdapterId === undefined) {
    throw identityAssertion(`provider ${descriptor.providerId} requires an explicit stale adapter selection`)
  }
  if (String(staleSelection.selectedAdapterId) === String(selection.selectedAdapterId)) {
    throw identityAssertion(`provider ${descriptor.providerId} stale adapter selection matches its selected adapter`)
  }
  if (adapters.some(adapter => String(adapter.adapterId) === String(staleSelection.selectedAdapterId))) {
    throw identityAssertion(`provider ${descriptor.providerId} stale adapter selection resolves to a listed adapter`)
  }
  const matchingAdapters = adapters.filter(adapter => String(adapter.adapterId) === String(selection.selectedAdapterId))
  if (matchingAdapters.length !== 1) {
    throw identityAssertion(
      `provider ${descriptor.providerId} selection ${String(selection.selectedAdapterId)} matched ${matchingAdapters.length} adapters`
    )
  }
  const adapter = matchingAdapters[0]
  if (adapter === undefined) {
    throw identityAssertion(`provider ${descriptor.providerId} did not resolve its explicit adapter selection`)
  }
  const backend = await factory.provider.create(selection)
  let identity: TckRuntimeIdentity
  try {
    const backendIdentity = backend.identity
    assertRuntimeIdentityFields(backendIdentity, 'provider-created')
    if (backendIdentity.registeredBackendId !== factory.backendId) {
      throw identityAssertion(
        `factory claims backend ${factory.backendId} but provider created ${backendIdentity.registeredBackendId}`
      )
    }
    if (backendIdentity.runtime.hostKind !== descriptor.hostKind) {
      throw identityAssertion(
        `provider ${descriptor.providerId} declares host ${descriptor.hostKind} but created backend reports ${backendIdentity.runtime.hostKind}`
      )
    }
    if (String(backendIdentity.attachment.adapter.adapterId) !== String(adapter.adapterId)) {
      throw identityAssertion(`provider ${descriptor.providerId} created a backend for an unselected adapter`)
    }
    identity = {
      registeredBackendId: backendIdentity.registeredBackendId,
      registeredPlatformId: backendIdentity.registeredPlatformId,
      providerId: descriptor.providerId,
      hostKind: backendIdentity.runtime.hostKind,
      implementationVersion: backendIdentity.runtime.implementationVersion,
      selectedAdapterId: String(adapter.adapterId)
    }
  } catch (primaryError) {
    try {
      await releaseProviderVerificationBackend(backend)
    } catch (cleanupError) {
      throw new AggregateError(
        [primaryError, cleanupError],
        'provider runtime identity verification and cleanup both failed'
      )
    }
    throw primaryError
  }
  await releaseProviderVerificationBackend(backend)
  return identity
}

async function releaseProviderVerificationBackend<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>
>(backend: BleCentralBackend<Attachment, Identity>): Promise<void> {
  let cleanup
  try {
    cleanup = await backend.destroy()
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'destroy rejected with a non-Error value'
    throw identityAssertion(`provider verification backend cleanup rejected: ${detail}`, error)
  }
  if (cleanup.state !== 'released' || cleanup.failures.length !== 0) {
    const failureCodes = cleanup.failures.map(failure => failure.error.code)
    throw identityAssertion(
      `provider verification backend cleanup returned ${cleanup.state} with failures: ${failureCodes.join(', ') || 'none'}`
    )
  }
}

function assertProviderDescriptorBinding<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(factory: BackendTckFactory<Attachment, Identity, Backend>, identity: TckRuntimeIdentity): void {
  const descriptor = factory.provider.descriptor
  if (descriptor.providerId !== identity.providerId || descriptor.hostKind !== identity.hostKind) {
    throw identityAssertion(
      `provider descriptor ${descriptor.providerId}/${descriptor.hostKind} does not match verified provider ${identity.providerId}/${identity.hostKind}`
    )
  }
}

function assertBackendIdentityBinding<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  backend: BleCentralBackend<Attachment, Identity>,
  identity: TckRuntimeIdentity,
  source: 'fixture' | 'provider-created'
): void {
  const backendIdentity = backend.identity
  assertRuntimeIdentityFields(backendIdentity, source)
  if (backendIdentity.registeredBackendId !== identity.registeredBackendId) {
    throw identityAssertion(
      `${source} backend ${backendIdentity.registeredBackendId} does not match verified backend ${identity.registeredBackendId}`
    )
  }
  if (backendIdentity.registeredPlatformId !== identity.registeredPlatformId) {
    throw identityAssertion(
      `${source} platform ${backendIdentity.registeredPlatformId} does not match verified platform ${identity.registeredPlatformId}`
    )
  }
  if (backendIdentity.runtime.hostKind !== identity.hostKind) {
    throw identityAssertion(
      `${source} host ${backendIdentity.runtime.hostKind} does not match verified host ${identity.hostKind}`
    )
  }
  if (backendIdentity.runtime.implementationVersion !== identity.implementationVersion) {
    throw identityAssertion(
      `${source} implementation version ${backendIdentity.runtime.implementationVersion} does not match verified version ${identity.implementationVersion}`
    )
  }
  if (String(backendIdentity.attachment.adapter.adapterId) !== identity.selectedAdapterId) {
    throw identityAssertion(
      `${source} adapter ${String(backendIdentity.attachment.adapter.adapterId)} does not match verified adapter ${identity.selectedAdapterId}`
    )
  }
}

function assertRuntimeIdentityFields<Attachment extends string>(
  identity: BackendIdentity<Attachment> | undefined,
  source: 'fixture' | 'provider-created'
): asserts identity is BackendIdentity<Attachment> {
  if (
    identity === undefined ||
    typeof identity.registeredBackendId !== 'string' ||
    identity.registeredBackendId.length === 0
  ) {
    throw identityAssertion(`${source} backend lacks identity.registeredBackendId`)
  }
  if (typeof identity.registeredPlatformId !== 'string' || identity.registeredPlatformId.length === 0) {
    throw identityAssertion(`${source} backend lacks identity.registeredPlatformId`)
  }
  if (
    identity.runtime === undefined ||
    typeof identity.runtime.hostKind !== 'string' ||
    identity.runtime.hostKind.length === 0
  ) {
    throw identityAssertion(`${source} backend lacks identity.runtime.hostKind`)
  }
  if (
    typeof identity.runtime.implementationVersion !== 'string' ||
    identity.runtime.implementationVersion.length === 0
  ) {
    throw identityAssertion(`${source} backend lacks identity.runtime.implementationVersion`)
  }
  if (
    identity.attachment === undefined ||
    identity.attachment.adapter === undefined ||
    identity.attachment.adapter.adapterId === undefined
  ) {
    throw identityAssertion(`${source} backend lacks identity.attachment.adapter.adapterId`)
  }
}

function identityAssertion(message: string, cause?: unknown): TckAssertionError {
  return cause === undefined
    ? new TckAssertionError('identity.provider-loadability-and-adapter-availability', message)
    : new TckAssertionError('identity.provider-loadability-and-adapter-availability', message, { cause })
}

async function executeRunnerControlledDefinition<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(
  factory: BackendTckFactory<Attachment, Identity, Backend>,
  fixture: BackendTckFixture<Attachment, Identity, Backend>,
  definition: TckScenarioDefinition,
  proofScope: 'deterministic'
): Promise<TckScenarioReceipt> {
  const facts = await executeRunnerOwnedTckScenario(factory, fixture, definition)
  return receiptFromFacts(definition, facts, proofScope)
}

function receiptFromFacts(
  definition: TckScenarioDefinition,
  facts: readonly TckFact[],
  proofScope: 'deterministic'
): TckScenarioReceipt {
  assertScenarioEvidence(definition, facts)
  return Object.freeze({
    scenarioId: definition.id,
    proof: Object.freeze({
      scope: proofScope,
      claim: 'deterministic-conformance',
      receiptId: `runner-controlled:${proofScope}:${definition.id}`
    }),
    facts: Object.freeze(facts.map(snapshotFact)),
    error: null
  })
}

function assertScenarioEvidence(definition: TckScenarioDefinition, facts: readonly TckFact[]): void {
  for (const factId of definition.requiredFacts) {
    assertFact(definition.id, factId, facts)
  }
}

function snapshotFact(fact: TckFact): TckFact {
  return Object.freeze({
    id: fact.id,
    holds: fact.holds,
    detail: snapshotSerializableRecord(fact.detail).value
  })
}

function assertFact(
  scenarioId: TckScenarioId,
  factId: TckScenarioDefinition['requiredFacts'][number],
  facts: readonly TckFact[]
): void {
  const matchingFacts = facts.filter(fact => fact.id === factId)
  if (matchingFacts.length !== 1) {
    throw new TckAssertionError(scenarioId, `expected exactly one fact ${factId}, got ${matchingFacts.length}`)
  }
  const fact = matchingFacts[0]
  if (fact === undefined || !fact.holds) {
    throw new TckAssertionError(scenarioId, `required fact ${factId} did not hold`)
  }
}
