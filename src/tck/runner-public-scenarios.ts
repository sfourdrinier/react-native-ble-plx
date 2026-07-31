// src/tck/runner-public-scenarios.ts

import type { BleCentralBackend } from '../backend-contract/backend'
import type { ConnectionLifecycleCause, ConnectionLifecycleEvent } from '../backend-contract/connection-lifecycle'
import { MINIMUM_ATT_MTU } from '../backend-contract/connection-controls'
import { BackendContractError } from '../backend-contract/errors'
import type { Characteristic } from '../backend-contract/gatt'
import type { BackendIdentity } from '../backend-contract/identity'
import {
  createAttachmentBoundIdFactory,
  deadline,
  version,
  versionRange,
  type BackendCompatibilityOffer
} from '../backend-contract/primitives'
import type { GenerationId } from '../backend-contract/primitives'
import type { StreamItem } from '../backend-contract/streams'
import {
  attachBleBackend,
  createBleManager,
  createManagerOwnershipAuthority,
  DEFAULT_BLE_MANAGER_OPTIONS
} from '../manager/ble-manager'
import {
  WEB_CHOOSER_TCK_SCENARIO_ID,
  WEB_UNSUPPORTED_CAPABILITIES_TCK_SCENARIO_ID,
  type BackendTckFactory,
  type BackendTckFixture,
  type TckFact,
  type TckScenarioDefinition
} from './contracts'
import { TckAssertionError } from './contracts'
import {
  assertCleanupReleased,
  connectAndDiscover,
  connectToDeterministicPeer,
  createBorrowingManager,
  emptyInput,
  fact,
  identitySeed,
  isValueItem,
  notificationInput,
  operationOptions,
  rejectsWithCode,
  scanOptions,
  subscriptionOptions
} from './runner-public-scenario-support'
import { executePublicVerticalSlice } from './runner-public-vertical-scenario'
import { executeSubscriptionOverflowScenario } from './runner-public-subscription-overflow-scenario'
import { executeDiagnosticsScenario, executeLifecycleScenario } from './runner-public-lifecycle-diagnostics-scenario'
import { executeDescriptorOperationsScenario } from './runner-public-descriptor-scenario'
import { executePublicWebChooserVerticalSlice } from './runner-public-web-chooser-vertical-scenario'
import { executePublicWebUnsupportedCapabilitiesScenario } from './runner-public-web-unsupported-capabilities-scenario'

const publicScenarioId = 'manager.scan-connect-discover-read-notify-destroy'
const publicScenarioFact = 'scan-connect-discover-read-notify-destroy-completes'
const publicScenarioDefinitionId = 'scenario.scan-connect-discover-read-notify-destroy'

/**
 * Executes the public manager vertical slice over the exact backend owned by
 * this runner fixture. Facts are emitted only after every public operation and
 * final manager cleanup settle successfully.
 */
export async function executePublicTckScenario<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(
  _factory: BackendTckFactory<Attachment, Identity, Backend>,
  fixture: BackendTckFixture<Attachment, Identity, Backend>,
  definition: TckScenarioDefinition
): Promise<readonly TckFact[]> {
  if (definition.id === 'adapter.atomic-snapshot-and-watch') {
    return executeAdapterWatchScenario(fixture, definition)
  }
  const attached = await attachBleBackend(fixture.backend, compatibility())
  const attachment = attached.attachment.attachment
  const ids = createAttachmentBoundIdFactory({
    attachmentId: attachment.attachmentId,
    backendInstanceId: attachment.backendInstanceId,
    backendGeneration: attachment.backendGeneration,
    adapterId: attachment.adapter.adapterId,
    adapterGeneration: attachment.adapter.adapterGeneration
  })
  const authority = createManagerOwnershipAuthority(attached)
  const restorationAdapter =
    definition.id === 'restoration.provider-journal-adoption-and-rejection'
      ? requireRestorationAdapter(fixture, definition)
      : null
  const manager = await createBleManager(
    {
      attachedBackend: attached,
      clientId: ids.clientId(`tck-${definition.id}-client`),
      managerId: ids.managerId(`tck-${definition.id}-manager`),
      ownerMode: 'owning',
      ...(restorationAdapter === null
        ? {}
        : { restoration: restorationAdapter.createCapability(ids.clientId(`tck-${definition.id}-client`)) })
    },
    authority,
    {
      ...DEFAULT_BLE_MANAGER_OPTIONS,
      now: () => fixture.controller.now()
    }
  )
  let primaryError: unknown = null
  let facts: readonly TckFact[] | null = null
  try {
    facts = await executeManagerScenario(manager, authority, fixture, definition)
  } catch (error) {
    primaryError = error
  }
  let cleanupError: TckAssertionError | null = null
  try {
    const cleanup = await fixture.controller.settle(manager.destroy())
    if (cleanup.state !== 'released' || cleanup.failures.length !== 0) {
      cleanupError = new TckAssertionError(
        definition.id,
        `public manager cleanup returned ${cleanup.state} with failures: ${
          cleanup.failures.map(failure => failure.error.code).join(', ') || 'none'
        }`
      )
    }
  } catch (error) {
    cleanupError = new TckAssertionError(definition.id, 'public manager cleanup rejected', { cause: error })
  }
  if (primaryError !== null && cleanupError !== null) {
    throw new AggregateError(
      [primaryError, cleanupError],
      `${definition.id}: public manager journey and cleanup both failed`
    )
  }
  if (primaryError !== null) {
    throw primaryError
  }
  if (cleanupError !== null) {
    throw cleanupError
  }
  if (facts === null) {
    throw new TckAssertionError(definition.id, 'public scenario produced no facts')
  }
  return Object.freeze(facts)
}

export type PublicManager<Attachment extends string, Identity extends BackendIdentity<Attachment>> = Awaited<
  ReturnType<typeof createBleManager<Attachment, Identity>>
>

export type PublicAuthority<Attachment extends string, Identity extends BackendIdentity<Attachment>> = ReturnType<
  typeof createManagerOwnershipAuthority<Attachment, Identity>
>

async function executeManagerScenario<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(
  manager: PublicManager<Attachment, Identity>,
  authority: PublicAuthority<Attachment, Identity>,
  fixture: BackendTckFixture<Attachment, Identity, Backend>,
  definition: TckScenarioDefinition
): Promise<readonly TckFact[]> {
  if (definition.id === 'scan.owner-join-authority-and-signature') {
    return executeScanOwnershipScenario(manager, fixture, definition)
  }
  if (definition.id === 'scan.fairness-abort-deadline-and-final-cleanup') {
    return executeScanCleanupScenario(manager, fixture, definition)
  }
  if (definition.id === 'connection.lease-joins-borrowing-transfer-and-revocation') {
    return executeManagerOwnershipScenario(manager, authority, fixture, definition)
  }
  if (definition.id === 'connection.two-client-arbitration') {
    return executeConnectionArbitrationScenario(manager, authority, fixture, definition)
  }
  if (definition.id === 'connection.rssi-and-att-mtu-capability-contract') {
    return executeConnectionControlsScenario(manager, fixture, definition)
  }
  if (definition.id === 'gatt.descriptor-discovery-read-write') {
    return executeDescriptorOperationsScenario(manager, fixture, definition)
  }
  if (definition.id === 'gatt.discovery-complete-paths-and-services-changed') {
    return executeGattDiscoveryScenario(manager, fixture, definition)
  }
  if (definition.id === 'gatt.reads-descriptors-write-policy-and-dispatched-cancellation') {
    return executeGattReadWriteScenario(manager, fixture, definition)
  }
  if (definition.id === 'gatt.maximum-write-length-boundaries') {
    return executeMaximumWriteLengthScenario(manager, fixture, definition)
  }
  if (definition.id === 'gatt.long-write-partial-failure') {
    return executeLongWritePartialFailureScenario(manager, fixture, definition)
  }
  if (definition.id === 'gatt.long-write-cancellation') {
    return executeLongWriteCancellationScenario(manager, fixture, definition)
  }
  if (definition.id === 'gatt.long-write-disconnect') {
    return executeLongWriteDisconnectScenario(manager, fixture, definition)
  }
  if (definition.id === 'restoration.provider-journal-adoption-and-rejection') {
    return executeRestorationScenario(manager, fixture, definition)
  }
  if (definition.id === 'subscription.enable-ready-shared-cccd-and-fanout') {
    return executeSubscriptionSharingScenario(manager, fixture, definition)
  }
  if (definition.id === 'subscription.pre-ready-overflow-controls-and-late-quarantine') {
    return executeSubscriptionOverflowScenario(manager, fixture, definition)
  }
  if (definition.id === 'lifecycle.destroy-idempotency-admission-and-exact-settlement') {
    return executeLifecycleScenario(manager, fixture, definition)
  }
  if (definition.id === 'diagnostics.trace-redaction-and-resource-counters') {
    return executeDiagnosticsScenario(manager, fixture, definition)
  }
  if (definition.id === WEB_CHOOSER_TCK_SCENARIO_ID) {
    const detail = await executePublicWebChooserVerticalSlice(manager, fixture, definition)
    return [fact('web-chooser-vertical-slice-preserves-selection-and-cleans-up', true, detail)]
  }
  if (definition.id === WEB_UNSUPPORTED_CAPABILITIES_TCK_SCENARIO_ID) {
    const detail = await executePublicWebUnsupportedCapabilitiesScenario(manager, fixture, definition)
    return [fact('web-unsupported-capabilities-reject-and-report-runtime-truth', true, detail)]
  }
  if (definition.id === publicScenarioDefinitionId) {
    await executePublicVerticalSlice(manager, fixture, definition)
    return [
      fact('vertical-slice-preserves-scan-and-cleans-up', true, {
        publicScenarioId,
        observedFact: publicScenarioFact
      })
    ]
  }
  return definition.requiredFacts.map(id =>
    fact(id, false, {
      unsupportedScenario: definition.id,
      reason: 'the public manager TCK has no scenario-specific observer for this feature scenario'
    })
  )
}

async function executeMaximumWriteLengthScenario<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(
  manager: PublicManager<Attachment, Identity>,
  fixture: BackendTckFixture<Attachment, Identity, Backend>,
  definition: TckScenarioDefinition
): Promise<readonly TckFact[]> {
  const connected = await connectAndDiscover(manager, fixture, definition)
  const characteristic = connected.snapshot.characteristics[0]
  if (characteristic === undefined) {
    throw new TckAssertionError(definition.id, 'maximum-write-length scenario requires one characteristic')
  }
  const first = await connected.database.maximumWriteLength(characteristic.path, 'with-response')
  const second = await connected.database.maximumWriteLength(characteristic.path, 'without-response')
  const registration = manager.capability('gatt:maximum-write-length')
  const bounded =
    manager.supports('gatt:maximum-write-length') &&
    registration !== null &&
    first.maximumWriteLength >= 1 &&
    second.maximumWriteLength >= 1 &&
    first.connectionId === connected.connection.connectionId &&
    second.connectionGeneration === connected.connection.connectionGeneration
  assertCleanupReleased(
    definition,
    await fixture.controller.settle(connected.connection.release()),
    'maximum-write-length connection'
  )
  return [
    fact('gatt-maximum-write-length-observation-is-current-and-bounded', bounded, {
      firstMaximumWriteLength: first.maximumWriteLength,
      secondMaximumWriteLength: second.maximumWriteLength,
      registrationState: registration?.state ?? 'absent'
    })
  ]
}

async function executeLongWritePartialFailureScenario<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(
  manager: PublicManager<Attachment, Identity>,
  fixture: BackendTckFixture<Attachment, Identity, Backend>,
  definition: TckScenarioDefinition
): Promise<readonly TckFact[]> {
  const connected = await connectAndDiscover(manager, fixture, definition)
  const characteristic = requireLongWriteCharacteristic(connected.snapshot.characteristics[0], definition)
  try {
    await fixture.controller.perform(
      'queue-operation-completion',
      Object.freeze({ stage: 'write', delayMilliseconds: 0 })
    )
    const write = connected.database.writeLong(characteristic.path, longWriteBytes(), {
      signal: null,
      deadline: null,
      mode: 'with-response'
    })
    await fixture.controller.flush()
    await fixture.controller.perform('advance-time', Object.freeze({ milliseconds: 0 }))
    await fixture.controller.flush()
    await fixture.controller.perform(
      'inject-att-error',
      Object.freeze({ operation: 'write', code: 'gatt.write-failed' })
    )
    const receipt = await fixture.controller.settle(write)
    const secondChunk = receipt.chunks[1]
    const holds =
      manager.supports('gatt:long-write') &&
      receipt.terminal.outcome === 'failed' &&
      receipt.terminal.cause === 'gatt.write-failed' &&
      receipt.commitState === 'unknown' &&
      receipt.completedChunks === 1 &&
      receipt.committedBytes > 0 &&
      receipt.failedChunkIndex === 1 &&
      secondChunk !== undefined &&
      (secondChunk.state === 'uncertain' || secondChunk.state === 'not-started') &&
      chunksAfter(receipt.chunks, secondChunk.index).every(chunk => chunk.state === 'not-started')
    return [
      fact('gatt-long-write-receipt-reports-partial-failure', holds, {
        completedChunks: receipt.completedChunks,
        committedBytes: receipt.committedBytes,
        failedChunkIndex: receipt.failedChunkIndex,
        terminalCause: receipt.terminal.cause,
        terminalOutcome: receipt.terminal.outcome
      })
    ]
  } finally {
    assertCleanupReleased(
      definition,
      await fixture.controller.settle(connected.connection.release()),
      'long-write connection'
    )
  }
}

async function executeLongWriteCancellationScenario<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(
  manager: PublicManager<Attachment, Identity>,
  fixture: BackendTckFixture<Attachment, Identity, Backend>,
  definition: TckScenarioDefinition
): Promise<readonly TckFact[]> {
  const connected = await connectAndDiscover(manager, fixture, definition)
  const characteristic = requireLongWriteCharacteristic(connected.snapshot.characteristics[0], definition)
  try {
    await fixture.controller.perform(
      'queue-operation-completion',
      Object.freeze({ stage: 'write', delayMilliseconds: 10 })
    )
    const cancellation = new AbortController()
    const write = connected.database.writeLong(characteristic.path, longWriteBytes(), {
      signal: cancellation.signal,
      deadline: null,
      mode: 'with-response'
    })
    await fixture.controller.flush()
    await fixture.controller.perform('advance-time', Object.freeze({ milliseconds: 0 }))
    await fixture.controller.flush()
    cancellation.abort()
    const receipt = await fixture.controller.settle(write)
    const firstChunk = receipt.chunks[0]
    const holds =
      manager.supports('gatt:long-write') &&
      receipt.terminal.outcome === 'aborted' &&
      receipt.terminal.cause === 'operation.aborted' &&
      receipt.commitState === 'unknown' &&
      receipt.completedChunks === 0 &&
      receipt.committedBytes === 0 &&
      receipt.failedChunkIndex === 0 &&
      firstChunk !== undefined &&
      firstChunk.state === 'uncertain' &&
      chunksAfter(receipt.chunks, firstChunk.index).every(chunk => chunk.state === 'not-started')
    return [
      fact('gatt-long-write-cancellation-stops-following-chunks', holds, {
        completedChunks: receipt.completedChunks,
        failedChunkIndex: receipt.failedChunkIndex,
        terminalCause: receipt.terminal.cause,
        terminalOutcome: receipt.terminal.outcome
      })
    ]
  } finally {
    assertCleanupReleased(
      definition,
      await fixture.controller.settle(connected.connection.release()),
      'long-write connection'
    )
  }
}

async function executeLongWriteDisconnectScenario<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(
  manager: PublicManager<Attachment, Identity>,
  fixture: BackendTckFixture<Attachment, Identity, Backend>,
  definition: TckScenarioDefinition
): Promise<readonly TckFact[]> {
  const connected = await connectAndDiscover(manager, fixture, definition)
  const characteristic = requireLongWriteCharacteristic(connected.snapshot.characteristics[0], definition)
  try {
    await fixture.controller.perform(
      'queue-operation-completion',
      Object.freeze({ stage: 'write', delayMilliseconds: 10 })
    )
    const write = connected.database.writeLong(characteristic.path, longWriteBytes(), {
      signal: null,
      deadline: null,
      mode: 'with-response'
    })
    await fixture.controller.flush()
    await fixture.controller.perform('advance-time', Object.freeze({ milliseconds: 0 }))
    await fixture.controller.flush()
    await fixture.controller.perform('force-disconnect', Object.freeze({ peerId: String(connected.connection.peerId) }))
    const receipt = await fixture.controller.settle(write)
    const firstChunk = receipt.chunks[0]
    const holds =
      manager.supports('gatt:long-write') &&
      receipt.terminal.outcome === 'disconnected' &&
      receipt.terminal.cause === 'operation.disconnected' &&
      receipt.commitState === 'unknown' &&
      receipt.completedChunks === 0 &&
      receipt.committedBytes === 0 &&
      receipt.failedChunkIndex === 0 &&
      firstChunk !== undefined &&
      firstChunk.state === 'uncertain' &&
      chunksAfter(receipt.chunks, firstChunk.index).every(chunk => chunk.state === 'not-started')
    return [
      fact('gatt-long-write-disconnect-stops-following-chunks', holds, {
        completedChunks: receipt.completedChunks,
        failedChunkIndex: receipt.failedChunkIndex,
        terminalCause: receipt.terminal.cause,
        terminalOutcome: receipt.terminal.outcome
      })
    ]
  } finally {
    assertCleanupReleased(
      definition,
      await fixture.controller.settle(connected.connection.release()),
      'long-write connection'
    )
  }
}

function requireLongWriteCharacteristic<Attachment extends string>(
  characteristic: Characteristic<Attachment, string, string, string, string> | undefined,
  definition: TckScenarioDefinition
) {
  if (characteristic === undefined) {
    throw new TckAssertionError(definition.id, 'long-write scenario requires one characteristic')
  }
  return characteristic
}

function longWriteBytes(): Uint8Array {
  return new Uint8Array(41)
}

function chunksAfter<Chunk extends { readonly index: number }>(
  chunks: readonly Chunk[],
  index: number
): readonly Chunk[] {
  return chunks.filter(chunk => chunk.index > index)
}

async function executeAdapterWatchScenario<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(
  fixture: BackendTckFixture<Attachment, Identity, Backend>,
  definition: TckScenarioDefinition
): Promise<readonly TckFact[]> {
  const watch = await fixture.backend.adapter.watchState()
  const transitionPromise = watch.transitions[Symbol.asyncIterator]().next()
  await fixture.controller.perform(
    'set-adapter-state',
    Object.freeze({
      availability: 'available',
      authorization: 'granted',
      power: 'off',
      safeReason: 'TCK adapter transition'
    })
  )
  const transition = await fixture.controller.settle(transitionPromise)
  const cleanup = await watch.transitions.close()
  assertCleanupReleased(definition, cleanup, 'adapter watch')
  const transitionPowerOff =
    !transition.done && transition.value.kind === 'value' && transition.value.value.power === 'off'
  return [
    fact('adapter-watch-is-atomic-with-initial-snapshot', watch.initial.power === 'on' && transitionPowerOff, {
      initialPower: watch.initial.power,
      transitionPowerOff
    }),
    fact('adapter-watch-orders-snapshot-before-transition', transitionPowerOff, { transitionPowerOff })
  ]
}

async function executeScanOwnershipScenario<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(
  manager: PublicManager<Attachment, Identity>,
  fixture: BackendTckFixture<Attachment, Identity, Backend>,
  definition: TckScenarioDefinition
): Promise<readonly TckFact[]> {
  const credentialOwner = await fixture.controller.settle(manager.scan(scanOptions(true)))
  const staleToken = credentialOwner.shareToken
  if (staleToken === null) {
    throw new TckAssertionError(definition.id, 'credential owner did not issue a share token')
  }
  assertCleanupReleased(definition, await fixture.controller.settle(credentialOwner.stop()), 'credential scan')
  const owner = await fixture.controller.settle(manager.scan(scanOptions(true)))
  const token = owner.shareToken
  if (token === null) {
    throw new TckAssertionError(definition.id, 'sharing owner did not issue a share token')
  }
  const invalidJoinRejected = await rejectsWithCode(
    manager.scan({
      ...scanOptions(false),
      sharing: { mode: 'join', sharedLeaseId: owner.leaseId, token: staleToken }
    }),
    'ownership.denied'
  )
  const joined = await fixture.controller.settle(
    manager.scan({ ...scanOptions(false), sharing: { mode: 'join', sharedLeaseId: owner.leaseId, token } })
  )
  const ordinaryRejected = await rejectsWithCode(manager.scan(scanOptions(false)), 'scan.already-active')
  const ownerObservation = owner.observations[Symbol.asyncIterator]().next()
  const joinedObservation = joined.observations[Symbol.asyncIterator]().next()
  await fixture.controller.perform('queue-advertisement', emptyInput)
  await fixture.controller.flush()
  const ownerReceived = isValueItem(await fixture.controller.settle(ownerObservation))
  const joinedReceived = isValueItem(await fixture.controller.settle(joinedObservation))
  assertCleanupReleased(definition, await fixture.controller.settle(joined.stop()), 'joined scan')
  assertCleanupReleased(definition, await fixture.controller.settle(owner.stop()), 'owner scan')
  return [
    fact('scan-owner-remains-physical-authority', ordinaryRejected && ownerReceived && joinedReceived, {
      ordinaryRejected,
      ownerReceived,
      joinedReceived
    }),
    fact('scan-join-requires-authorized-identical-semantics', invalidJoinRejected, { invalidJoinRejected })
  ]
}

async function executeScanCleanupScenario<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(
  manager: PublicManager<Attachment, Identity>,
  fixture: BackendTckFixture<Attachment, Identity, Backend>,
  definition: TckScenarioDefinition
): Promise<readonly TckFact[]> {
  const owner = await fixture.controller.settle(manager.scan(scanOptions(true)))
  const token = owner.shareToken
  if (token === null) {
    throw new TckAssertionError(definition.id, 'sharing owner did not issue a share token')
  }
  const joined = await fixture.controller.settle(
    manager.scan({ ...scanOptions(false), sharing: { mode: 'join', sharedLeaseId: owner.leaseId, token } })
  )
  assertCleanupReleased(definition, await fixture.controller.settle(joined.stop()), 'joined scan')
  const nextOwner = owner.observations[Symbol.asyncIterator]().next()
  await fixture.controller.perform('queue-advertisement', emptyInput)
  await fixture.controller.flush()
  const ownerStillReceives = isValueItem(await nextOwner)
  assertCleanupReleased(definition, await fixture.controller.settle(owner.stop()), 'owner scan')
  await fixture.controller.perform('queue-advertisement', emptyInput)
  await fixture.controller.flush()
  const noLateObservation = !isValueItem(
    await fixture.controller.settle(owner.observations[Symbol.asyncIterator]().next())
  )
  const controllerReleased = Number(manager.localResourceCounters().activeScanControllers) === 0
  const aborted = new AbortController()
  aborted.abort()
  const abortRejected = await rejectsWithCode(
    manager.scan({ ...scanOptions(false), signal: aborted.signal }),
    'operation.aborted'
  )
  const timeoutRejected = await rejectsWithCode(
    manager.scan({ ...scanOptions(false), deadline: deadline(fixture.controller.now()) }),
    'operation.timed-out'
  )
  return [
    fact('scan-consumer-release-is-fair-and-isolated', ownerStillReceives, { ownerStillReceives }),
    fact('scan-abort-and-deadline-close-ingress', abortRejected && timeoutRejected, {
      abortRejected,
      timeoutRejected
    }),
    fact('scan-stop-resolves-before-final-physical-release', controllerReleased, { controllerReleased }),
    fact('scan-no-late-observation-after-stop', noLateObservation, { noLateObservation })
  ]
}

async function executeManagerOwnershipScenario<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(
  owner: PublicManager<Attachment, Identity>,
  authority: PublicAuthority<Attachment, Identity>,
  fixture: BackendTckFixture<Attachment, Identity, Backend>,
  definition: TckScenarioDefinition
): Promise<readonly TckFact[]> {
  const borrower = await createBorrowingManager(owner, authority, fixture, definition, 'borrower')
  const connection = await connectToDeterministicPeer(owner, fixture, definition)
  const borrowerDenied = await rejectsWithCode(
    borrower.connect(connection.peerId, operationOptions),
    'connection.already-owned'
  )
  const borrowerCleanup = await fixture.controller.settle(borrower.destroy())
  assertCleanupReleased(definition, borrowerCleanup, 'borrowing manager')
  const database = await fixture.controller.settle(connection.discover(operationOptions))
  const ownerOperationRetained = (await database.snapshot()).characteristics.length > 0
  const ownerConnectionRetained = Number(owner.localResourceCounters().connectionLeases) === 1
  const lifecycle = connection.events[Symbol.asyncIterator]()
  const connectedLifecycle = await fixture.controller.settle(lifecycle.next())
  await fixture.controller.perform('force-disconnect', Object.freeze({ peerId: String(connection.peerId) }))
  const peerLossLifecycle = await fixture.controller.settle(lifecycle.next())
  const peerLossTerminal = await fixture.controller.settle(lifecycle.next())
  assertCleanupReleased(definition, await fixture.controller.settle(connection.release()), 'owner connection')
  const requested = await connectToDeterministicPeer(owner, fixture, definition)
  const requestedLifecycle = requested.events[Symbol.asyncIterator]()
  const requestedConnected = await fixture.controller.settle(requestedLifecycle.next())
  assertCleanupReleased(definition, await fixture.controller.settle(requested.disconnect()), 'requested disconnect')
  const requestedDisconnected = await fixture.controller.settle(requestedLifecycle.next())
  const requestedTerminal = await fixture.controller.settle(requestedLifecycle.next())
  const peerLossObserved =
    isConnectionLifecycleValue(connectedLifecycle, 'connected', connection.connectionGeneration) &&
    isConnectionLifecycleValue(peerLossLifecycle, 'peer-link-loss', connection.connectionGeneration) &&
    !peerLossTerminal.done &&
    peerLossTerminal.value.kind === 'terminal' &&
    peerLossTerminal.value.reason === 'connection-lost'
  const requestedDisconnectObserved =
    isConnectionLifecycleValue(requestedConnected, 'connected', requested.connectionGeneration) &&
    isConnectionLifecycleValue(requestedDisconnected, 'requested-disconnect', requested.connectionGeneration) &&
    !requestedTerminal.done &&
    requestedTerminal.value.kind === 'terminal' &&
    requestedTerminal.value.reason === 'owner-released'
  const lifecycleStreamsComplete =
    (await fixture.controller.settle(lifecycle.next())).done === true &&
    (await fixture.controller.settle(requestedLifecycle.next())).done === true &&
    Number(owner.localResourceCounters().connectionLeases) === 0
  const ownerContinued = owner.state === 'ready'
  const destination = await createBorrowingManager(owner, authority, fixture, definition, 'destination')
  let borrowerTransferDenied = false
  let replayRejected = false
  let transferred = false
  let revocationSettled = false
  let transferError: unknown = null
  let destinationReleased = false
  let revocable: PublicManager<Attachment, Identity> | null = null
  try {
    const transferGrant = authority.issueTransferGrant(owner.managerId, destination.managerId)
    borrowerTransferDenied = await rejectsWithCode(destination.transferOwnership(transferGrant), 'ownership.denied')
    assertCleanupReleased(
      definition,
      await fixture.controller.settle(owner.transferOwnership(transferGrant)),
      'ownership transfer'
    )
    replayRejected = await rejectsWithCode(owner.transferOwnership(transferGrant), 'ownership.denied')
    transferred = destination.ownerMode === 'owning'
    revocable = await createBorrowingManager(destination, authority, fixture, definition, 'revocable')
    assertCleanupReleased(definition, await fixture.controller.settle(destination.destroy()), 'destination manager')
    destinationReleased = true
    revocationSettled = revocable.state === 'destroyed'
  } catch (error) {
    transferError = error
  }
  const transferCleanupErrors: unknown[] = []
  if (!destinationReleased) {
    try {
      assertCleanupReleased(
        definition,
        await fixture.controller.settle(destination.destroy()),
        'destination manager cleanup'
      )
    } catch (error) {
      transferCleanupErrors.push(error)
    }
  }
  if (revocable !== null) {
    try {
      assertCleanupReleased(
        definition,
        await fixture.controller.settle(revocable.destroy()),
        'revoked borrower cleanup'
      )
    } catch (error) {
      transferCleanupErrors.push(error)
    }
  }
  if (transferError !== null && transferCleanupErrors.length > 0) {
    throw new AggregateError(
      [transferError, ...transferCleanupErrors],
      `${definition.id}: ownership observation and cleanup failed`
    )
  }
  if (transferError !== null) {
    throw transferError
  }
  if (transferCleanupErrors.length === 1) {
    throw transferCleanupErrors[0]
  }
  if (transferCleanupErrors.length > 1) {
    throw new AggregateError(transferCleanupErrors, `${definition.id}: ownership cleanup failed`)
  }
  return [
    fact('connection-leases-are-owner-scoped', borrowerDenied && ownerConnectionRetained, {
      borrowerDenied,
      ownerConnectionRetained
    }),
    fact(
      'connection-borrowing-cannot-destroy-or-cancel-owner-work',
      ownerOperationRetained && ownerContinued && borrowerCleanup.state === 'released',
      { ownerOperationRetained, ownerContinued, borrowerReleased: borrowerCleanup.state === 'released' }
    ),
    fact(
      'connection-transfer-and-revocation-are-authenticated',
      borrowerTransferDenied && replayRejected && transferred && revocationSettled,
      {
        borrowerTransferDenied,
        replayRejected,
        transferred,
        revocationSettled
      }
    ),
    fact('connection-lifecycle-peer-loss-is-generation-bound', peerLossObserved, { peerLossObserved }),
    fact('connection-lifecycle-requested-disconnect-is-distinct', requestedDisconnectObserved, {
      requestedDisconnectObserved
    }),
    fact('connection-lifecycle-stream-cleans-up', lifecycleStreamsComplete, {
      lifecycleStreamsComplete
    })
  ]
}

async function executeConnectionArbitrationScenario<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(
  owner: PublicManager<Attachment, Identity>,
  authority: PublicAuthority<Attachment, Identity>,
  fixture: BackendTckFixture<Attachment, Identity, Backend>,
  definition: TckScenarioDefinition
): Promise<readonly TckFact[]> {
  const ids = createAttachmentBoundIdFactory(identitySeed(owner))
  const second = await createBleManager(
    {
      attachedBackend: owner.attachedBackend,
      clientId: ids.clientId(`tck-${definition.id}-second-client`),
      managerId: ids.managerId(`tck-${definition.id}-second-manager`),
      ownerMode: 'borrowing'
    },
    authority,
    { ...DEFAULT_BLE_MANAGER_OPTIONS, now: () => fixture.controller.now() }
  )
  const connection = await connectToDeterministicPeer(owner, fixture, definition)
  const secondRejected = await rejectsWithCode(
    second.connect(connection.peerId, operationOptions),
    'connection.already-owned'
  )
  assertCleanupReleased(definition, await fixture.controller.settle(second.destroy()), 'second manager')
  assertCleanupReleased(definition, await fixture.controller.settle(connection.release()), 'owner connection')
  return [
    fact('connection-second-client-arbitrates-without-stealing-link', secondRejected && owner.state === 'ready', {
      secondRejected,
      ownerReady: owner.state === 'ready'
    })
  ]
}

async function executeGattDiscoveryScenario<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(
  manager: PublicManager<Attachment, Identity>,
  fixture: BackendTckFixture<Attachment, Identity, Backend>,
  definition: TckScenarioDefinition
): Promise<readonly TckFact[]> {
  const connected = await connectAndDiscover(manager, fixture, definition)
  const characteristic = connected.snapshot.characteristics[0]
  if (characteristic === undefined) {
    throw new TckAssertionError(definition.id, 'discovery returned no characteristic')
  }
  const serviceOccurrenceKeys = connected.snapshot.services.map(candidate => String(candidate.path.serviceOccurrence))
  const serviceParentKeys = new Set(
    connected.snapshot.services.map(candidate =>
      JSON.stringify([String(candidate.path.serviceOccurrence), String(candidate.path.serviceUuid)])
    )
  )
  const characteristicOccurrenceKeys = connected.snapshot.characteristics.map(candidate =>
    JSON.stringify([String(candidate.path.serviceOccurrence), String(candidate.path.characteristicOccurrence)])
  )
  const characteristicParents = new Set(
    connected.snapshot.characteristics.map(candidate =>
      JSON.stringify([
        String(candidate.path.serviceOccurrence),
        String(candidate.path.serviceUuid),
        String(candidate.path.characteristicOccurrence),
        String(candidate.path.characteristicUuid)
      ])
    )
  )
  const descriptorOccurrenceKeys = connected.snapshot.descriptors.map(candidate =>
    JSON.stringify([
      String(candidate.path.serviceOccurrence),
      String(candidate.path.characteristicOccurrence),
      String(candidate.path.descriptorOccurrence)
    ])
  )
  const completePaths =
    connected.snapshot.services.length > 0 &&
    connected.snapshot.characteristics.length > 0 &&
    connected.snapshot.services.every(
      candidate =>
        String(candidate.path.databaseGeneration) === String(connected.snapshot.path.databaseGeneration) &&
        String(candidate.path.serviceOccurrence).length > 0
    ) &&
    new Set(serviceOccurrenceKeys).size === serviceOccurrenceKeys.length &&
    connected.snapshot.characteristics.every(
      candidate =>
        candidate.path.validity === 'current' &&
        String(candidate.path.databaseGeneration) === String(connected.snapshot.path.databaseGeneration) &&
        String(candidate.path.characteristicOccurrence).length > 0 &&
        serviceParentKeys.has(
          JSON.stringify([String(candidate.path.serviceOccurrence), String(candidate.path.serviceUuid)])
        )
    ) &&
    new Set(characteristicOccurrenceKeys).size === characteristicOccurrenceKeys.length &&
    connected.snapshot.descriptors.every(
      candidate =>
        candidate.path.validity === 'current' &&
        String(candidate.path.databaseGeneration) === String(connected.snapshot.path.databaseGeneration) &&
        String(candidate.path.descriptorOccurrence).length > 0 &&
        characteristicParents.has(
          JSON.stringify([
            String(candidate.path.serviceOccurrence),
            String(candidate.path.serviceUuid),
            String(candidate.path.characteristicOccurrence),
            String(candidate.path.characteristicUuid)
          ])
        )
    ) &&
    new Set(descriptorOccurrenceKeys).size === descriptorOccurrenceKeys.length
  await fixture.controller.perform(
    'trigger-services-changed',
    Object.freeze({ peerId: String(connected.connection.peerId) })
  )
  const snapshotInvalidated = await rejectsWithCode(connected.database.snapshot(), 'gatt.stale-handle')
  const dispatchedTraceCountBeforeStaleRead = manager
    .traces()
    .filter(entry => entry.resource === 'operation' && entry.transition === 'dispatched').length
  const staleReadRejected = await rejectsWithCode(
    connected.database.read(characteristic.path, operationOptions),
    'gatt.stale-handle'
  )
  const dispatchedTraceCountAfterStaleRead = manager
    .traces()
    .filter(entry => entry.resource === 'operation' && entry.transition === 'dispatched').length
  const staleReadDidNotDispatch = dispatchedTraceCountAfterStaleRead === dispatchedTraceCountBeforeStaleRead
  assertCleanupReleased(definition, await fixture.controller.settle(connected.connection.release()), 'connection')
  return [
    fact('gatt-discovery-returns-complete-occurrence-safe-paths', completePaths, {
      serviceCount: connected.snapshot.services.length,
      characteristicCount: connected.snapshot.characteristics.length,
      descriptorCount: connected.snapshot.descriptors.length
    }),
    fact('gatt-services-changed-invalidates-database-generation', snapshotInvalidated, { snapshotInvalidated }),
    fact('gatt-stale-path-rejects-before-dispatch', staleReadRejected && staleReadDidNotDispatch, {
      staleReadRejected,
      staleReadDidNotDispatch
    })
  ]
}

async function executeGattReadWriteScenario<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(
  manager: PublicManager<Attachment, Identity>,
  fixture: BackendTckFixture<Attachment, Identity, Backend>,
  definition: TckScenarioDefinition
): Promise<readonly TckFact[]> {
  const connected = await connectAndDiscover(manager, fixture, definition)
  const characteristic = connected.snapshot.characteristics[0]
  const policyCharacteristic = connected.snapshot.characteristics[1]
  const descriptor = connected.snapshot.descriptors[0]
  if (characteristic === undefined || policyCharacteristic === undefined || descriptor === undefined) {
    throw new TckAssertionError(definition.id, 'discovery lacks read, policy, or descriptor paths')
  }
  const firstValue = await fixture.controller.settle(connected.database.read(characteristic.path, operationOptions))
  const firstByte = firstValue[0]
  if (firstByte === undefined) {
    throw new TckAssertionError(definition.id, 'characteristic read returned no bytes')
  }
  firstValue[0] = firstByte + 1
  const secondValue = await fixture.controller.settle(connected.database.read(characteristic.path, operationOptions))
  const descriptorValue = await fixture.controller.settle(
    connected.database.readDescriptor(descriptor.path, operationOptions)
  )
  const descriptorFirstByte = descriptorValue[0]
  if (descriptorFirstByte === undefined) {
    throw new TckAssertionError(definition.id, 'descriptor read returned no bytes')
  }
  descriptorValue[0] = descriptorFirstByte + 1
  const descriptorReread = await fixture.controller.settle(
    connected.database.readDescriptor(descriptor.path, operationOptions)
  )
  const ownedBytes = secondValue[0] === firstByte && descriptorReread[0] === descriptorFirstByte
  const policyRejected = await fixture.controller.settle(
    rejectsWithCode(
      connected.database.write(policyCharacteristic.path, new Uint8Array([3]), {
        ...operationOptions,
        mode: 'without-response'
      }),
      'gatt.property-not-supported'
    )
  )
  await fixture.controller.perform(
    'queue-operation-completion',
    Object.freeze({ stage: 'write', delayMilliseconds: 10 })
  )
  const cancellation = new AbortController()
  const write = connected.database.write(characteristic.path, new Uint8Array([91]), {
    signal: cancellation.signal,
    deadline: null,
    mode: 'with-response'
  })
  await fixture.controller.perform('advance-time', Object.freeze({ milliseconds: 0 }))
  let callerCancellationObserved = false
  const callerCancellation = rejectsWithCode(write, 'operation.aborted').then(observed => {
    callerCancellationObserved = observed
    return observed
  })
  cancellation.abort()
  await fixture.controller.flush()
  const callerSettledBeforeAcknowledgement = callerCancellationObserved
  await fixture.controller.perform('advance-time', Object.freeze({ milliseconds: 10 }))
  const callerCancelled = await fixture.controller.settle(callerCancellation)
  const persistedValue = await fixture.controller.settle(connected.database.read(characteristic.path, operationOptions))
  assertCleanupReleased(definition, await fixture.controller.settle(connected.connection.release()), 'connection')
  return [
    fact('gatt-read-and-descriptor-return-owned-bytes', ownedBytes, {
      ownedBytes,
      firstByte,
      descriptorBytes: descriptorValue.byteLength,
      descriptorFirstByte
    }),
    fact(
      'gatt-write-policy-and-uncertain-dispatched-commit-are-exact',
      policyRejected && callerCancelled && callerSettledBeforeAcknowledgement && persistedValue[0] === 91,
      {
        policyRejected,
        callerCancelled,
        callerSettledBeforeAcknowledgement,
        persisted: persistedValue[0] === 91
      }
    )
  ]
}

async function executeSubscriptionSharingScenario<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(
  manager: PublicManager<Attachment, Identity>,
  fixture: BackendTckFixture<Attachment, Identity, Backend>,
  definition: TckScenarioDefinition
): Promise<readonly TckFact[]> {
  const connected = await connectAndDiscover(manager, fixture, definition)
  const characteristic = connected.snapshot.characteristics[0]
  if (characteristic === undefined) {
    throw new TckAssertionError(definition.id, 'discovery returned no subscribable characteristic')
  }
  await fixture.controller.perform(
    'queue-operation-completion',
    Object.freeze({ stage: 'subscribe', delayMilliseconds: 10 })
  )
  const firstPromise = connected.database.subscribe(characteristic.path, subscriptionOptions('drop-oldest', 4, 32))
  await fixture.controller.perform('emit-notification', notificationInput(characteristic.path, new Uint8Array([1])))
  await fixture.controller.perform('advance-time', Object.freeze({ milliseconds: 10 }))
  const first = await fixture.controller.settle(firstPromise)
  await fixture.controller.perform('emit-notification', notificationInput(characteristic.path, new Uint8Array([2])))
  const ready = await fixture.controller.settle(first.values[Symbol.asyncIterator]().next())
  const noValueBeforeReady = !ready.done && ready.value.kind === 'value' && ready.value.value.value[0] === 2
  const second = await fixture.controller.settle(
    connected.database.subscribe(characteristic.path, subscriptionOptions('drop-oldest', 4, 32))
  )
  const sharedCccd =
    Number(manager.localResourceCounters().physicalCccdEnablements) === 1 &&
    Number(manager.localResourceCounters().subscriptionConsumers) === 2
  const firstNext = first.values[Symbol.asyncIterator]().next()
  const secondNext = second.values[Symbol.asyncIterator]().next()
  await fixture.controller.perform('emit-notification', notificationInput(characteristic.path, new Uint8Array([3])))
  const firstItem = await fixture.controller.settle(firstNext)
  const secondItem = await fixture.controller.settle(secondNext)
  if (!firstItem.done && firstItem.value.kind === 'value') {
    firstItem.value.value.value[0] = 99
  }
  const fanoutIsolated = !secondItem.done && secondItem.value.kind === 'value' && secondItem.value.value.value[0] === 3
  assertCleanupReleased(definition, await fixture.controller.settle(first.remove()), 'first subscription')
  const firstTeardownIterator = first.values[Symbol.asyncIterator]()
  const firstTeardownTerminal = await fixture.controller.settle(firstTeardownIterator.next())
  const firstTeardownComplete = await fixture.controller.settle(firstTeardownIterator.next())
  const firstTeardownHasOneTerminal =
    !firstTeardownTerminal.done &&
    firstTeardownTerminal.value.kind === 'terminal' &&
    firstTeardownTerminal.value.reason === 'owner-released' &&
    firstTeardownComplete.done === true
  const remainsEnabled = Number(manager.localResourceCounters().physicalCccdEnablements) === 1
  assertCleanupReleased(definition, await fixture.controller.settle(second.remove()), 'second subscription')
  const secondTeardownIterator = second.values[Symbol.asyncIterator]()
  const secondTeardownTerminal = await fixture.controller.settle(secondTeardownIterator.next())
  const secondTeardownComplete = await fixture.controller.settle(secondTeardownIterator.next())
  const secondTeardownHasOneTerminal =
    !secondTeardownTerminal.done &&
    secondTeardownTerminal.value.kind === 'terminal' &&
    secondTeardownTerminal.value.reason === 'owner-released' &&
    secondTeardownComplete.done === true
  assertCleanupReleased(definition, await fixture.controller.settle(connected.connection.release()), 'connection')
  return [
    fact('subscription-no-value-before-ready', noValueBeforeReady, { noValueBeforeReady }),
    fact('subscription-shares-physical-cccd-with-consumer-refcount', sharedCccd && remainsEnabled, {
      sharedCccd,
      remainsEnabled
    }),
    fact(
      'subscription-fanout-is-consumer-isolated',
      fanoutIsolated && firstTeardownHasOneTerminal && secondTeardownHasOneTerminal,
      {
        fanoutIsolated,
        firstTeardownHasOneTerminal,
        secondTeardownHasOneTerminal
      }
    )
  ]
}

async function executeConnectionControlsScenario<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(
  manager: PublicManager<Attachment, Identity>,
  fixture: BackendTckFixture<Attachment, Identity, Backend>,
  definition: TckScenarioDefinition
): Promise<readonly TckFact[]> {
  const adapter = fixture.featureScenarioAdapters?.connectionControls
  if (adapter === undefined) {
    throw new TckAssertionError(definition.id, 'fixture lacks a connection-controls scenario adapter')
  }
  if (!Number.isSafeInteger(adapter.requestedMtu) || adapter.requestedMtu < MINIMUM_ATT_MTU) {
    throw new TckAssertionError(definition.id, 'connection-controls adapter has an invalid requested ATT MTU')
  }
  const connection = await connectToDeterministicPeer(manager, fixture, definition)
  let rssiMeasured = false
  let rssiExplicitlyUnavailable = false
  let mtuObserved = false
  let mtuExplicitlyUnavailable = false
  try {
    const rssiState = featureState(fixture.backend, 'connection:rssi-measurement')
    if (rssiState === 'supported' || rssiState === 'limited') {
      const rssi = await fixture.controller.settle(connection.readRssi(operationOptions))
      rssiMeasured = Number.isSafeInteger(rssi.rssi)
    } else {
      rssiExplicitlyUnavailable = await rejectsWithCapabilityCode(
        fixture.controller.settle(connection.readRssi(operationOptions)),
        'capability.unsupported'
      )
    }
    const mtuState = featureState(fixture.backend, 'connection:request-att-mtu')
    if (mtuState === 'supported' || mtuState === 'limited') {
      const negotiation = await fixture.controller.settle(connection.requestMtu(adapter.requestedMtu, operationOptions))
      mtuObserved =
        negotiation.requestedMtu === adapter.requestedMtu &&
        Number.isSafeInteger(negotiation.negotiatedMtu) &&
        negotiation.negotiatedMtu >= MINIMUM_ATT_MTU &&
        negotiation.negotiatedMtu <= adapter.requestedMtu
    } else {
      mtuExplicitlyUnavailable = await rejectsWithCapabilityCode(
        fixture.controller.settle(connection.requestMtu(adapter.requestedMtu, operationOptions)),
        'capability.unsupported'
      )
    }
  } finally {
    assertCleanupReleased(
      definition,
      await fixture.controller.settle(connection.release()),
      'connection-controls connection'
    )
  }
  return [
    fact('connection-rssi-is-measured-or-explicitly-unavailable', rssiMeasured || rssiExplicitlyUnavailable, {
      rssiExplicitlyUnavailable,
      rssiMeasured
    }),
    fact('connection-att-mtu-is-negotiated-or-explicitly-unavailable', mtuObserved || mtuExplicitlyUnavailable, {
      mtuExplicitlyUnavailable,
      mtuObserved,
      requestedMtu: adapter.requestedMtu
    })
  ]
}

async function executeRestorationScenario<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(
  manager: PublicManager<Attachment, Identity>,
  fixture: BackendTckFixture<Attachment, Identity, Backend>,
  definition: TckScenarioDefinition
): Promise<readonly TckFact[]> {
  const adapter = requireRestorationAdapter(fixture, definition)
  await adapter.seedJournal(fixture.controller)
  const request = adapter.createRequest(manager.identity)
  const rejected = await fixture.controller.settle(
    manager.adoptRestoration(Object.freeze({ ...request, namespace: `${request.namespace}.rejected` }))
  )
  const adopted = await fixture.controller.settle(manager.adoptRestoration(request))
  const repeated = await fixture.controller.settle(manager.adoptRestoration(request))
  const bounded = restorationRecordCountIsBounded(fixture.backend, adopted.replayedRecords.length)
  return [
    fact('restoration-journal-is-provider-owned-and-bounded', adopted.outcome === 'adopted' && bounded, {
      adoptedOutcome: adopted.outcome,
      replayedRecordCount: adopted.replayedRecords.length,
      bounded
    }),
    fact(
      'restoration-adoption-is-verified-and-exactly-once',
      adopted.outcome === 'adopted' && repeated.outcome === 'already-consumed',
      { adoptedOutcome: adopted.outcome, repeatedOutcome: repeated.outcome }
    ),
    fact(
      'restoration-rejection-is-non-consuming',
      rejected.outcome === 'namespace-mismatch' && adopted.outcome === 'adopted',
      { rejectedOutcome: rejected.outcome, adoptedOutcome: adopted.outcome }
    )
  ]
}

function requireRestorationAdapter<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(fixture: BackendTckFixture<Attachment, Identity, Backend>, definition: TckScenarioDefinition) {
  const adapter = fixture.featureScenarioAdapters?.restoration
  if (adapter === undefined) {
    throw new TckAssertionError(definition.id, 'fixture lacks a restoration scenario adapter')
  }
  return adapter
}

function featureState<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  backend: BleCentralBackend<Attachment, Identity>,
  featureId: string
) {
  const registration = backend.features.registrations.find(candidate => candidate.id === featureId)
  if (registration === undefined) {
    throw new TckAssertionError(
      'connection.rssi-and-att-mtu-capability-contract',
      `backend does not register ${featureId}`
    )
  }
  return registration.state
}

function restorationRecordCountIsBounded<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  backend: BleCentralBackend<Attachment, Identity>,
  count: number
): boolean {
  const registration = backend.features.registrations.find(candidate => candidate.id === 'state:restoration-adoption')
  const maximum = registration?.limits.restorationRecords?.maximum
  return typeof maximum === 'number' && Number.isSafeInteger(maximum) && maximum >= 0 && count <= maximum
}

function isConnectionLifecycleValue<Attachment extends string>(
  result: IteratorResult<StreamItem<ConnectionLifecycleEvent<Attachment>>>,
  cause: ConnectionLifecycleCause,
  generation: GenerationId<'connection-generation', string>
): boolean {
  return (
    !result.done &&
    result.value.kind === 'value' &&
    result.value.value.cause === cause &&
    result.value.value.connectionGeneration === generation
  )
}

async function rejectsWithCapabilityCode<Value>(promise: Promise<Value>, code: string): Promise<boolean> {
  return promise.then(
    () => false,
    error => error instanceof BackendContractError && error.normalized.code === code
  )
}

function compatibility(): BackendCompatibilityOffer {
  return {
    backendContract: versionRange(version('backend-contract', 1), version('backend-contract', 1)),
    capabilitySchema: versionRange(version('capability-schema', 1), version('capability-schema', 1)),
    eventSchema: versionRange(version('event-schema', 1), version('event-schema', 1)),
    traceFormat: versionRange(version('trace-format', 1), version('trace-format', 1))
  }
}
