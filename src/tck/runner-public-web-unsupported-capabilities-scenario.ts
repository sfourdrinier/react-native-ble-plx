// src/tck/runner-public-web-unsupported-capabilities-scenario.ts

import type { BleCentralBackend } from '../backend-contract/backend'
import { BackendContractError, type CleanupRecord } from '../backend-contract/errors'
import type { BackendIdentity } from '../backend-contract/identity'
import { createAttachmentBoundIdFactory, type SerializableRecord } from '../backend-contract/primitives'
import type { BackendTckFixture, TckScenarioDefinition } from './contracts'
import { TckAssertionError, WEB_UNSUPPORTED_CAPABILITIES_TCK_SCENARIO_ID } from './contracts'
import { identitySeed, scanOptions } from './runner-public-scenario-support'
import type { PublicManager } from './runner-public-scenarios'

type WebUnsupportedFeatureId = 'web:background-operation' | 'web:continuous-scan' | 'web:state-restoration'

interface WebUnsupportedFeatureExpectation {
  readonly featureId: WebUnsupportedFeatureId
  readonly limitName: string
  readonly limitUnit: string
}

const unsupportedFeatureExpectations: readonly WebUnsupportedFeatureExpectation[] = Object.freeze([
  Object.freeze({
    featureId: 'web:background-operation',
    limitName: 'backgroundDuration',
    limitUnit: 'milliseconds'
  }),
  Object.freeze({
    featureId: 'web:continuous-scan',
    limitName: 'concurrentScanSessions',
    limitUnit: 'sessions'
  }),
  Object.freeze({
    featureId: 'web:state-restoration',
    limitName: 'restorationRecords',
    limitUnit: 'items'
  })
])

/** Proves unsupported Web features through runner-owned operations and registry truth. */
export async function executePublicWebUnsupportedCapabilitiesScenario<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(
  manager: PublicManager<Attachment, Identity>,
  fixture: BackendTckFixture<Attachment, Identity, Backend>,
  definition: TckScenarioDefinition
): Promise<SerializableRecord> {
  let scanRejected = false
  try {
    const unexpectedScan = await fixture.controller.settle(manager.scan(scanOptions(false)))
    let cleanup: CleanupRecord
    try {
      cleanup = await fixture.controller.settle(unexpectedScan.stop())
    } catch (error) {
      throw new TckAssertionError(definition.id, 'unexpected Web scan succeeded and its cleanup rejected', {
        cause: error
      })
    }
    if (cleanup.state !== 'released' || cleanup.failures.length !== 0) {
      throw new TckAssertionError(definition.id, 'unexpected Web scan failed cleanup')
    }
  } catch (error) {
    if (error instanceof TckAssertionError) {
      throw error
    }
    if (error instanceof BackendContractError && error.normalized.code === 'capability.unsupported') {
      scanRejected = true
    } else {
      throw new TckAssertionError(definition.id, 'Web continuous scan rejected with the wrong error', { cause: error })
    }
  }
  if (!scanRejected) {
    throw new TckAssertionError(definition.id, 'Web continuous scan did not reject with capability.unsupported')
  }

  const ids = createAttachmentBoundIdFactory(identitySeed(manager))
  let scanJoinRejected = false
  try {
    const unexpectedJoin = await fixture.controller.settle(
      fixture.backend.scanner.join(
        ids.leaseId('web-unsupported-join-lease'),
        ids.scanShareToken('web-unsupported-join-token'),
        ids.clientId('web-unsupported-join-client')
      )
    )
    let cleanup: CleanupRecord
    try {
      cleanup = await fixture.controller.settle(unexpectedJoin.stop())
    } catch (error) {
      throw new TckAssertionError(definition.id, 'unexpected Web scan join succeeded and its cleanup rejected', {
        cause: error
      })
    }
    if (cleanup.state !== 'released' || cleanup.failures.length !== 0) {
      throw new TckAssertionError(definition.id, 'unexpected Web scan join failed cleanup')
    }
  } catch (error) {
    if (error instanceof TckAssertionError) {
      throw error
    }
    if (error instanceof BackendContractError && error.normalized.code === 'capability.unsupported') {
      scanJoinRejected = true
    } else {
      throw new TckAssertionError(definition.id, 'Web scan sharing rejected with the wrong error', { cause: error })
    }
  }
  if (!scanJoinRejected) {
    throw new TckAssertionError(definition.id, 'Web scan sharing did not reject with capability.unsupported')
  }

  for (const expectation of unsupportedFeatureExpectations) {
    await assertUnsupportedFeatureTruth(manager, fixture.backend, definition, expectation)
  }

  const resourcesReleased = resourceCountersAreZero(fixture.backend)
  if (!resourcesReleased) {
    throw new TckAssertionError(definition.id, 'Web unsupported-capability probes retained backend resources')
  }

  return Object.freeze({
    resourcesReleased,
    scanJoinRejected,
    scanRejected,
    unsupportedFeatureIds: Object.freeze(unsupportedFeatureExpectations.map(expectation => expectation.featureId))
  })
}

async function assertUnsupportedFeatureTruth<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  manager: PublicManager<Attachment, Identity>,
  backend: BleCentralBackend<Attachment, Identity>,
  definition: TckScenarioDefinition,
  expectation: WebUnsupportedFeatureExpectation
): Promise<void> {
  const descriptor = manager.capability(expectation.featureId)
  const registration = backend.features.registrations.find(candidate => candidate.id === expectation.featureId)
  if (descriptor === null || registration === undefined) {
    throw new TckAssertionError(definition.id, `Web feature registry lacks ${expectation.featureId}`)
  }
  const limit = descriptor.limits[expectation.limitName]
  const limitationTruth =
    descriptor.limitations.length > 0 &&
    descriptor.evidence.limitations.length > 0 &&
    descriptor.limitations.every(limitation =>
      descriptor.evidence.limitations.some(evidenceLimitation => evidenceLimitation.code === limitation.code)
    )
  const bindingTruth =
    hasExactScenario(descriptor.tck.requiredScenarioIds) && hasExactScenario(descriptor.evidence.scenarioIds)
  if (
    manager.supports(expectation.featureId) ||
    descriptor.state !== 'unsupported' ||
    descriptor.evidence.evidenceLevel !== 'blocked' ||
    descriptor.implementationOrigin !== 'backend-native' ||
    limit === undefined ||
    limit.maximum !== 0 ||
    limit.minimum !== null ||
    limit.unit !== expectation.limitUnit ||
    !limitationTruth ||
    !bindingTruth
  ) {
    throw new TckAssertionError(
      definition.id,
      `Web feature ${expectation.featureId} does not report exact unsupported truth`
    )
  }
  const invocation = await registration.implementation.invoke(Object.freeze({}))
  if (invocation.supported !== false) {
    throw new TckAssertionError(
      definition.id,
      `Web feature ${expectation.featureId} implementation did not reject support`
    )
  }
}

function hasExactScenario(scenarioIds: readonly string[]): boolean {
  return scenarioIds.length === 1 && scenarioIds[0] === WEB_UNSUPPORTED_CAPABILITIES_TCK_SCENARIO_ID
}

function resourceCountersAreZero<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  backend: BleCentralBackend<Attachment, Identity>
): boolean {
  return Object.values(backend.resourceCounters()).every(value => Number(value) === 0)
}
