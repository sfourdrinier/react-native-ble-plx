// src/tck/deterministic/deterministic-tck-scenarios.ts
import type { AdvertisementObservation, OwnerScanOptions } from '../../backend-contract/advertisement'
import { BackendContractError } from '../../backend-contract/errors'
import type { CharacteristicPath, GattDatabase } from '../../backend-contract/gatt'
import type { ConnectionLease } from '../../backend-contract/backend'
import type { BackendProvider, HostNeutralBackendIdentity } from '../../backend-contract/identity'
import {
  capacity,
  byteLimit,
  deadline,
  monotonicTimestamp,
  opaqueId,
  ownBytes,
  type ClientId,
  type SerializableRecord
} from '../../backend-contract/primitives'
import type { DeterministicBackendFixture } from '../../testing/deterministic/deterministic-test-backend'
import type { ProgrammableCompletion } from '../../testing/deterministic/deterministic-operation-runtime'
import type { VirtualCharacteristicAddress } from '../../testing/deterministic/virtual-peripheral'
import type { StreamItem } from '../../backend-contract/streams'
import type { TckFact, TckFactId, TckScenarioDefinition } from '../contracts'
import {
  deterministicCapabilityTruthFacts,
  deterministicIdentityLoadabilityFacts,
  deterministicIdentityNegotiationFacts,
  deterministicIdentityRejectionFacts,
  deterministicIdentitySelectionFacts
} from './deterministic-tck-identity'
import { deterministicManagerOwnershipFacts } from './deterministic-tck-manager-ownership'
import { deterministicLifecycleFacts, deterministicDiagnosticsFacts } from './deterministic-tck-lifecycle-diagnostics'
import { deterministicSubscriptionOverflowFacts } from './deterministic-tck-subscription-overflow'
import { traceDispatchCount } from './deterministic-tck-scenario-helpers'

interface FactObservation {
  readonly id: TckFactId
  readonly holds: boolean
  readonly detail: SerializableRecord
}

export interface DeterministicTckDependencyBlock {
  readonly id: 'core-manager-ownership' | 'provider-restoration-authority' | 'electron-main-arbiter'
  readonly owner: 'G2 core-manager' | 'restoration provider' | 'electron main boundary'
  readonly explanation: string
}

export const deterministicTckDependencyBlocks: readonly DeterministicTckDependencyBlock[] = Object.freeze([
  {
    id: 'core-manager-ownership',
    owner: 'G2 core-manager',
    explanation: 'Borrowing, ownership transfer, and revocation are proven through the G2 logical manager fixture.'
  },
  {
    id: 'provider-restoration-authority',
    owner: 'restoration provider',
    explanation: 'The deterministic backend does not own a provider restoration journal or adoption authority.'
  },
  {
    id: 'electron-main-arbiter',
    owner: 'electron main boundary',
    explanation: 'Renderer sender validation and reload ownership belong to the Electron main-process fixture.'
  }
])

/** Runner-owned deterministic scenario evidence. Public receipts are built by the shared TCK runner. */
export async function executeDeterministicTckScenarioEvidence(
  fixture: DeterministicBackendFixture,
  provider: BackendProvider<string, HostNeutralBackendIdentity<string>>,
  definition: TckScenarioDefinition
): Promise<readonly TckFact[]> {
  const observations = await executeScenario(fixture, provider, definition)
  return definition.requiredFacts.map(id => findFact(id, observations))
}

export function createDeterministicTckAdvertisement(): AdvertisementObservation<string> {
  return {
    peerId: peerId(),
    observedAt: monotonicTimestamp(1),
    source: 'platform-raw',
    ingressOrdinal: 1,
    localName: { state: 'present', value: 'Deterministic peripheral', provenance: 'observed' },
    rssi: { state: 'present', value: -42, provenance: 'observed' },
    txPower: { state: 'absent', reason: 'not advertised', provenance: 'not-provided' },
    connectable: { state: 'present', value: true, provenance: 'observed' },
    appearance: { state: 'absent', reason: 'not advertised', provenance: 'not-provided' },
    serviceUuids: { state: 'present', value: [], provenance: 'observed' },
    solicitedServiceUuids: { state: 'absent', reason: 'not advertised', provenance: 'not-provided' },
    overflowServiceUuids: { state: 'absent', reason: 'not advertised', provenance: 'not-provided' },
    serviceData: { state: 'absent', reason: 'not advertised', provenance: 'not-provided' },
    manufacturerData: { state: 'absent', reason: 'not advertised', provenance: 'not-provided' },
    rawRecord: { state: 'present', value: ownBytes(new Uint8Array([2, 1, 6]), byteLimit(3)), provenance: 'observed' },
    scanResponseRecord: { state: 'absent', reason: 'not supplied', provenance: 'not-provided' }
  }
}
async function executeScenario(
  fixture: DeterministicBackendFixture,
  provider: BackendProvider<string, HostNeutralBackendIdentity<string>>,
  definition: TckScenarioDefinition
): Promise<readonly FactObservation[]> {
  if (definition.id === 'identity.provider-loadability-and-adapter-availability') {
    return deterministicIdentityLoadabilityFacts(fixture, provider)
  }
  if (definition.id === 'identity.adapter-selection-and-unique-instance') {
    return deterministicIdentitySelectionFacts(fixture, provider)
  }
  if (definition.id === 'identity.valid-all-axis-negotiation') {
    return deterministicIdentityNegotiationFacts(fixture)
  }
  if (definition.id === 'identity.version-skew-and-malformed-offers') {
    return deterministicIdentityRejectionFacts()
  }
  if (definition.id === 'capability.truth-limits-evidence-and-binding') {
    return deterministicCapabilityTruthFacts(fixture)
  }
  if (definition.id === 'adapter.atomic-snapshot-and-watch') {
    return adapterWatch(fixture)
  }
  if (definition.id === 'scan.owner-join-authority-and-signature') {
    return scanOwnership(fixture)
  }
  if (definition.id === 'scan.fairness-abort-deadline-and-final-cleanup') {
    return scanCleanup(fixture)
  }
  if (definition.id === 'connection.lease-joins-borrowing-transfer-and-revocation') {
    return deterministicManagerOwnershipFacts()
  }
  if (definition.id === 'connection.two-client-arbitration') {
    return connectionArbitration(fixture)
  }
  if (definition.id === 'gatt.discovery-complete-paths-and-services-changed') {
    return gattDiscovery(fixture)
  }
  if (definition.id === 'gatt.reads-descriptors-write-policy-and-dispatched-cancellation') {
    return gattReadWrite(fixture)
  }
  if (definition.id === 'subscription.enable-ready-shared-cccd-and-fanout') {
    return subscriptionReadinessAndSharing(fixture)
  }
  if (definition.id === 'subscription.pre-ready-overflow-controls-and-late-quarantine') {
    return subscriptionOverflowAndRemoval(fixture)
  }
  if (definition.id === 'lifecycle.destroy-idempotency-admission-and-exact-settlement') {
    return lifecycleFacts()
  }
  if (definition.id === 'diagnostics.trace-redaction-and-resource-counters') {
    return diagnosticsFacts(fixture)
  }
  if (definition.id === 'scenario.scan-connect-discover-read-notify-destroy') {
    return verticalSlice(fixture)
  }
  return featureNotSelectedFacts(definition)
}
async function adapterWatch(fixture: DeterministicBackendFixture): Promise<readonly FactObservation[]> {
  const watch = await fixture.backend.adapter.watchState()
  const initial = watch.initial
  const next = watch.transitions[Symbol.asyncIterator]().next()
  fixture.controller.setAdapterState('available', 'granted', 'off', 'TCK adapter transition')
  const transition = await next
  await watch.transitions.close()
  fixture.controller.setAdapterState('available', 'granted', 'on', null)
  let transitionPowerOff = false
  if (!transition.done && transition.value.kind === 'value') {
    transitionPowerOff = transition.value.value.power === 'off'
  }
  const atomic = initial.power === 'on' && transitionPowerOff
  return [
    fact('adapter-watch-is-atomic-with-initial-snapshot', atomic, { initialPowerOn: initial.power === 'on' }),
    fact('adapter-watch-orders-snapshot-before-transition', transitionPowerOff, { transitionPowerOff })
  ]
}

async function scanOwnership(fixture: DeterministicBackendFixture): Promise<readonly FactObservation[]> {
  const ownerPromise = fixture.backend.scanner.start(scanOptions(true), clientId('owner'))
  fixture.controller.clock.runUntilIdle()
  const owner = await ownerPromise
  const token = owner.shareToken
  if (token === null) {
    throw new Error('sharing owner did not provide a scan token')
  }
  const joined = await fixture.backend.scanner.join(owner.leaseId, token, clientId('joined'))
  const ordinaryRejected = await rejectsWithCode(
    fixture.backend.scanner.start(scanOptions(false), clientId('unshared')),
    'scan.already-active'
  )
  const invalidJoinRejected = await rejectsWithCode(
    fixture.backend.scanner.join(
      owner.leaseId,
      opaqueId('forged', 'scan-share-token', 'deterministic:forged'),
      clientId('forged')
    ),
    'ownership.denied'
  )
  fixture.controller.emitAdvertisement(createDeterministicTckAdvertisement())
  const ownerReceived = await receivesValue(owner.observations)
  const joinedReceived = await receivesValue(joined.observations)
  const stopJoined = joined.stop()
  fixture.controller.clock.runUntilIdle()
  await stopJoined
  const stopOwner = owner.stop()
  fixture.controller.clock.runUntilIdle()
  await stopOwner
  return [
    fact('scan-owner-remains-physical-authority', ordinaryRejected && ownerReceived && joinedReceived, {
      ordinaryRejected,
      ownerReceived,
      joinedReceived
    }),
    fact('scan-join-requires-authorized-identical-semantics', invalidJoinRejected, { invalidJoinRejected })
  ]
}

async function scanCleanup(fixture: DeterministicBackendFixture): Promise<readonly FactObservation[]> {
  const ownerPromise = fixture.backend.scanner.start(scanOptions(true), clientId('scan-cleanup-owner'))
  fixture.controller.clock.runUntilIdle()
  const owner = await ownerPromise
  const token = owner.shareToken
  if (token === null) {
    throw new Error('sharing owner did not provide a scan token')
  }
  const shared = await fixture.backend.scanner.join(owner.leaseId, token, clientId('scan-cleanup-shared'))
  const sharedStop = shared.stop()
  fixture.controller.clock.runUntilIdle()
  await sharedStop
  fixture.controller.emitAdvertisement(createDeterministicTckAdvertisement())
  const ownerStillReceives = await receivesValue(owner.observations)
  const ownerStop = owner.stop()
  fixture.controller.clock.runUntilIdle()
  await ownerStop
  fixture.controller.emitAdvertisement(createDeterministicTckAdvertisement())
  const noLateValue = await receivesTerminal(owner.observations)
  const controllerReleased = Number(fixture.backend.resourceCounters().activeScanControllers) === 0
  const aborted = new AbortController()
  aborted.abort()
  const abortRejected = await rejectsWithCode(
    fixture.backend.scanner.start({ ...scanOptions(false), signal: aborted.signal }, clientId('scan-abort')),
    'operation.aborted'
  )
  const timeoutRejected = await rejectsWithCode(
    fixture.backend.scanner.start(
      { ...scanOptions(false), deadline: deadline(Number(fixture.controller.clock.now())) },
      clientId('scan-timeout')
    ),
    'operation.timed-out'
  )
  return [
    fact('scan-consumer-release-is-fair-and-isolated', ownerStillReceives, { ownerStillReceives }),
    fact('scan-abort-and-deadline-close-ingress', abortRejected && timeoutRejected, { abortRejected, timeoutRejected }),
    fact('scan-stop-resolves-before-final-physical-release', controllerReleased, { controllerReleased }),
    fact('scan-no-late-observation-after-stop', noLateValue, { noLateValue })
  ]
}

async function connectionArbitration(fixture: DeterministicBackendFixture): Promise<readonly FactObservation[]> {
  const first = fixture.backend.connections.connect(peerId(), clientId('connection-owner'), noOperationOptions())
  fixture.controller.clock.runUntilIdle()
  const ownerLease = await first
  const secondRejected = await rejectsWithCode(
    fixture.backend.connections.connect(peerId(), clientId('connection-second-client'), noOperationOptions()),
    'connection.already-owned'
  )
  const release = ownerLease.release()
  fixture.controller.clock.runUntilIdle()
  await release
  return [fact('connection-second-client-arbitrates-without-stealing-link', secondRejected, { secondRejected })]
}

async function gattDiscovery(fixture: DeterministicBackendFixture): Promise<readonly FactObservation[]> {
  const connected = await connectAndDiscover(fixture, 'gatt-discovery')
  const completePaths =
    connected.snapshot.services.length === 2 &&
    connected.snapshot.characteristics.length === 3 &&
    connected.snapshot.descriptors.length === 1 &&
    pathsMatchDatabaseGeneration(connected.snapshot)
  const characteristic = connected.snapshot.characteristics[0]
  if (characteristic === undefined) {
    throw new Error('deterministic TCK snapshot has no characteristic')
  }
  fixture.controller.triggerServicesChanged(peerId())
  const snapshotInvalidated = await rejectsWithCode(connected.database.snapshot(), 'gatt.stale-handle')
  const dispatchesBeforeStaleRead = traceDispatchCount(fixture)
  const staleRejectedBeforeDispatch = await rejectsWithCode(
    connected.database.read(characteristic.path, noOperationOptions()),
    'gatt.stale-handle'
  )
  const dispatchesAfterStaleRead = traceDispatchCount(fixture)
  const staleReadDidNotDispatch = dispatchesBeforeStaleRead === dispatchesAfterStaleRead
  await releaseConnection(fixture, connected.lease)
  return [
    fact('gatt-discovery-returns-complete-occurrence-safe-paths', completePaths, {
      serviceCount: connected.snapshot.services.length,
      characteristicCount: connected.snapshot.characteristics.length,
      descriptorCount: connected.snapshot.descriptors.length
    }),
    fact('gatt-services-changed-invalidates-database-generation', snapshotInvalidated, { snapshotInvalidated }),
    fact('gatt-stale-path-rejects-before-dispatch', staleRejectedBeforeDispatch && staleReadDidNotDispatch, {
      staleRejectedBeforeDispatch,
      dispatchesBeforeStaleRead,
      dispatchesAfterStaleRead
    })
  ]
}

async function gattReadWrite(fixture: DeterministicBackendFixture): Promise<readonly FactObservation[]> {
  const connected = await connectAndDiscover(fixture, 'gatt-read-write')
  const characteristic = connected.snapshot.characteristics[0]
  const descriptor = connected.snapshot.descriptors[0]
  if (characteristic === undefined || descriptor === undefined) {
    throw new Error('deterministic TCK snapshot lacks required attribute paths')
  }
  const controllerFaultProbe = connected.database.read(characteristic.path, noOperationOptions())
  fixture.controller.clock.runUntilIdle()
  const controllerFault = await observeExpectedRejection(controllerFaultProbe, 'gatt.read-failed')
  const controllerFaultOutcomeValid = controllerFault.matched
  const read = connected.database.read(characteristic.path, noOperationOptions())
  fixture.controller.clock.runUntilIdle()
  const firstValue = await read
  const firstByte = firstValue[0]
  firstValue[0] = firstByte === undefined ? 1 : firstByte + 1
  const reread = connected.database.read(characteristic.path, noOperationOptions())
  fixture.controller.clock.runUntilIdle()
  const secondValue = await reread
  const descriptorRead = connected.database.readDescriptor(descriptor.path, noOperationOptions())
  fixture.controller.clock.runUntilIdle()
  const descriptorValue = await descriptorRead
  const ownedBytes = secondValue[0] === firstByte && descriptorValue.byteLength > 0 && controllerFaultOutcomeValid
  const writePlan: ProgrammableCompletion = {
    delayMs: 10,
    failure: null,
    cancellable: false,
    deadlineOrder: 'completion-first'
  }
  fixture.controller.queueCompletion('write', writePlan)
  const write = fixture.backend.gatt.write(characteristic.path, {
    operation: {
      correlation: opaqueId('uncertain-write', 'core-operation', 'deterministic:uncertain-write'),
      signal: null,
      deadline: null
    },
    bytes: new Uint8Array([91]),
    mode: 'with-response'
  })
  fixture.controller.clock.advanceBy(0)
  const cancellation = await write.requestCancellation()
  const callerCancelled = await rejectsWithCode(write.completion, 'operation.aborted')
  const pendingBeforeAcknowledgement = fixture.controller.pendingBackendAcknowledgements() === 1
  fixture.controller.clock.advanceBy(10)
  const acknowledged = fixture.controller.pendingBackendAcknowledgements() === 0
  const persistedValue =
    fixture.controller.peripheral.readCharacteristic(characteristicAddress(characteristic.path))[0] === 91
  const policyCharacteristic = connected.snapshot.characteristics[1]
  if (policyCharacteristic === undefined) {
    throw new Error('deterministic TCK snapshot lacks write-policy characteristic')
  }
  const unsupportedPolicy = connected.database.write(policyCharacteristic.path, new Uint8Array([3]), {
    signal: null,
    deadline: null,
    mode: 'without-response'
  })
  fixture.controller.clock.runUntilIdle()
  const policyRejected = await rejectsWithCode(unsupportedPolicy, 'gatt.property-not-supported')
  await releaseConnection(fixture, connected.lease)
  return [
    fact('gatt-read-and-descriptor-return-owned-bytes', ownedBytes, {
      ownedBytes,
      firstByte: firstByte ?? null,
      injectedReadRejected: controllerFault.matched,
      controllerFaultOutcomeValid
    }),
    fact(
      'gatt-write-policy-and-uncertain-dispatched-commit-are-exact',
      policyRejected &&
        cancellation.state === 'cancellation-requested' &&
        callerCancelled &&
        pendingBeforeAcknowledgement &&
        acknowledged &&
        persistedValue,
      {
        policyRejected,
        cancellationRequested: cancellation.state === 'cancellation-requested',
        callerCancelled,
        pendingBeforeAcknowledgement,
        acknowledged,
        persistedValue
      }
    )
  ]
}

async function subscriptionReadinessAndSharing(
  fixture: DeterministicBackendFixture
): Promise<readonly FactObservation[]> {
  const connected = await connectAndDiscover(fixture, 'subscription-sharing')
  const characteristic = connected.snapshot.characteristics[0]
  if (characteristic === undefined) {
    throw new Error('deterministic TCK snapshot has no subscribable characteristic')
  }
  fixture.controller.queueCompletion('subscribe', {
    delayMs: 10,
    failure: null,
    cancellable: false,
    deadlineOrder: 'completion-first'
  })
  const firstPromise = connected.database.subscribe(characteristic.path, subscriptionOptions('drop-oldest', 4, 32))
  fixture.controller.clock.advanceBy(0)
  fixture.controller.emitNotification(characteristicAddress(characteristic.path), new Uint8Array([1]))
  fixture.controller.clock.advanceBy(10)
  const first = await firstPromise
  fixture.controller.emitNotification(characteristicAddress(characteristic.path), new Uint8Array([2]))
  const readyItem = await nextValue(first.values)
  const noValueBeforeReady = readyItem !== null && readyItem.value[0] === 2
  const second = await connected.database.subscribe(characteristic.path, subscriptionOptions('drop-oldest', 4, 32))
  const sharedCccd =
    Number(fixture.backend.resourceCounters().physicalCccdEnablements) === 1 &&
    Number(fixture.backend.resourceCounters().subscriptionConsumers) === 2
  fixture.controller.emitNotification(characteristicAddress(characteristic.path), new Uint8Array([3]))
  const firstItem = await nextValue(first.values)
  const secondItem = await nextValue(second.values)
  const firstByte = firstItem?.value[0]
  if (firstItem !== null && firstByte !== undefined) {
    firstItem.value[0] = firstByte + 1
  }
  const consumerIsolation = secondItem !== null && secondItem.value[0] === 3
  const removeFirst = first.remove()
  fixture.controller.clock.runUntilIdle()
  await removeFirst
  const remainsEnabled = Number(fixture.backend.resourceCounters().physicalCccdEnablements) === 1
  const removeSecond = second.remove()
  await drainVirtualClock(fixture)
  await removeSecond
  await releaseConnection(fixture, connected.lease)
  return [
    fact('subscription-no-value-before-ready', noValueBeforeReady, { noValueBeforeReady }),
    fact('subscription-shares-physical-cccd-with-consumer-refcount', sharedCccd && remainsEnabled, {
      sharedCccd,
      remainsEnabled
    }),
    fact('subscription-fanout-is-consumer-isolated', consumerIsolation, { consumerIsolation })
  ]
}

async function subscriptionOverflowAndRemoval(
  fixture: DeterministicBackendFixture
): Promise<readonly FactObservation[]> {
  return deterministicSubscriptionOverflowFacts(fixture)
}

async function verticalSlice(fixture: DeterministicBackendFixture): Promise<readonly FactObservation[]> {
  const scanPromise = fixture.backend.scanner.start(scanOptions(false), clientId('vertical-scan'))
  fixture.controller.clock.runUntilIdle()
  const scan = await scanPromise
  fixture.controller.emitAdvertisement(createDeterministicTckAdvertisement())
  const scanReceived = await receivesValue(scan.observations)
  const connected = await connectAndDiscover(fixture, 'vertical-connect')
  const characteristic = connected.snapshot.characteristics[0]
  if (characteristic === undefined) {
    throw new Error('deterministic TCK snapshot has no characteristic')
  }
  const read = connected.database.read(characteristic.path, noOperationOptions())
  fixture.controller.clock.runUntilIdle()
  const value = await read
  const subscriptionPromise = connected.database.subscribe(
    characteristic.path,
    subscriptionOptions('drop-oldest', 2, 16)
  )
  fixture.controller.clock.runUntilIdle()
  const subscription = await subscriptionPromise
  fixture.controller.emitNotification(characteristicAddress(characteristic.path), new Uint8Array([8]))
  const notified = await nextValue(subscription.values)
  const remove = subscription.remove()
  await drainVirtualClock(fixture)
  await remove
  await releaseConnection(fixture, connected.lease)
  const stop = scan.stop()
  fixture.controller.clock.runUntilIdle()
  await stop
  const counters = fixture.backend.resourceCounters()
  const cleaned = Object.values(counters).every(counter => Number(counter) === 0)
  return [
    fact(
      'vertical-slice-preserves-scan-and-cleans-up',
      scanReceived && value.byteLength > 0 && notified !== null && cleaned,
      {
        scanReceived,
        readBytes: value.byteLength,
        notified: notified !== null,
        cleaned
      }
    )
  ]
}

async function connectAndDiscover(fixture: DeterministicBackendFixture, client: string) {
  const connectionPromise = fixture.backend.connections.connect(peerId(), clientId(client), noOperationOptions())
  fixture.controller.clock.runUntilIdle()
  const lease = await connectionPromise
  const discoveryPromise = fixture.backend.gatt.discover(lease.connection, noOperationOptions())
  fixture.controller.clock.runUntilIdle()
  const database = await discoveryPromise
  const snapshot = await database.snapshot()
  return { lease, database, snapshot }
}

async function releaseConnection(
  fixture: DeterministicBackendFixture,
  lease: ConnectionLease<string, string, string>
): Promise<void> {
  const release = lease.release()
  fixture.controller.clock.runUntilIdle()
  await release
}

async function drainVirtualClock(fixture: DeterministicBackendFixture): Promise<void> {
  fixture.controller.clock.runUntilIdle()
  await Promise.resolve()
  fixture.controller.clock.runUntilIdle()
  await Promise.resolve()
  fixture.controller.clock.runUntilIdle()
}

function pathsMatchDatabaseGeneration(
  snapshot: Awaited<ReturnType<GattDatabase<string, string, string>['snapshot']>>
): boolean {
  const expectedAttachment = String(snapshot.path.attachment.backendInstanceId)
  const expectedDatabase = String(snapshot.path.databaseGeneration)
  for (const service of snapshot.services) {
    if (
      String(service.path.attachment.backendInstanceId) !== expectedAttachment ||
      String(service.path.databaseGeneration) !== expectedDatabase
    ) {
      return false
    }
  }
  for (const characteristic of snapshot.characteristics) {
    if (
      String(characteristic.path.attachment.backendInstanceId) !== expectedAttachment ||
      String(characteristic.path.databaseGeneration) !== expectedDatabase ||
      characteristic.path.validity !== 'current'
    ) {
      return false
    }
  }
  for (const descriptor of snapshot.descriptors) {
    if (
      String(descriptor.path.attachment.backendInstanceId) !== expectedAttachment ||
      String(descriptor.path.databaseGeneration) !== expectedDatabase ||
      descriptor.path.validity !== 'current'
    ) {
      return false
    }
  }
  return true
}

function characteristicAddress(
  path: CharacteristicPath<string, string, string, string, string, 'current'>
): VirtualCharacteristicAddress {
  return {
    serviceUuid: path.serviceUuid,
    serviceOccurrence: Number(path.serviceOccurrence),
    characteristicUuid: path.characteristicUuid,
    characteristicOccurrence: Number(path.characteristicOccurrence)
  }
}

function subscriptionOptions(overflowPolicy: 'drop-oldest' | 'error', itemCapacity: number, byteCapacity: number) {
  return {
    signal: null,
    deadline: null,
    delivery: {
      itemCapacity: capacity(itemCapacity),
      byteCapacity: capacity(byteCapacity),
      reservedControlCapacity: capacity(1),
      overflowPolicy
    }
  }
}

async function nextValue<Value>(stream: AsyncIterable<StreamItem<Value>>): Promise<Value | null> {
  const item = await nextStreamItem(stream)
  if (item === null || item.kind !== 'value') {
    return null
  }
  return item.value
}

async function nextStreamItem<Value>(stream: AsyncIterable<StreamItem<Value>>): Promise<StreamItem<Value> | null> {
  const iterator = stream[Symbol.asyncIterator]()
  const item = await iterator.next()
  return item.done ? null : item.value
}

async function lifecycleFacts(): Promise<readonly FactObservation[]> {
  return deterministicLifecycleFacts()
}

async function diagnosticsFacts(fixture: DeterministicBackendFixture): Promise<readonly FactObservation[]> {
  return deterministicDiagnosticsFacts(fixture, createDeterministicTckAdvertisement())
}

function featureNotSelectedFacts(definition: TckScenarioDefinition): readonly FactObservation[] {
  const block = featureDependencyBlock(definition.id)
  if (block === null) {
    return definition.requiredFacts.map(id =>
      fact(id, false, { blockedBy: 'feature is not registered by this backend' })
    )
  }
  return definition.requiredFacts.map(id => fact(id, false, { blockedBy: block.id, owner: block.owner }))
}

function featureDependencyBlock(scenarioId: TckScenarioDefinition['id']): DeterministicTckDependencyBlock | null {
  if (scenarioId === 'restoration.provider-journal-adoption-and-rejection') {
    return deterministicTckDependencyBlocks[1] ?? null
  }
  if (scenarioId === 'electron.trusted-sender-envelope-generations-and-quotas') {
    return deterministicTckDependencyBlocks[2] ?? null
  }
  return null
}

function fact(id: TckFactId, holds: boolean, detail: SerializableRecord): FactObservation {
  return { id, holds, detail }
}

function findFact(id: TckFactId, observations: readonly FactObservation[]): TckFact {
  const found = observations.find(observation => observation.id === id)
  return found ?? fact(id, false, { blockedBy: 'scenario fixture has no observation' })
}

function scanOptions(allowSharing: boolean): OwnerScanOptions<string, string> {
  return {
    filter: { serviceUuids: [], localNamePrefix: null },
    duplicatePolicy: 'all',
    timestampPolicy: 'receipt-monotonic',
    delivery: {
      itemCapacity: capacity(4),
      byteCapacity: capacity(128),
      reservedControlCapacity: capacity(1),
      overflowPolicy: 'drop-oldest'
    },
    deadline: null,
    signal: null,
    sharing: { mode: 'owner', allowSharing }
  }
}

function noOperationOptions() {
  return { signal: null, deadline: null }
}

function peerId() {
  return opaqueId('deterministic-peer', 'peer', 'deterministic')
}

function clientId(value: string): ClientId<string, string> {
  return opaqueId(value, 'client', `deterministic:${value}`)
}

async function rejectsWithCode<Value>(promise: Promise<Value>, code: string): Promise<boolean> {
  const observation = await observeExpectedRejection(promise, code)
  return observation.matched
}

interface ExpectedRejectionObservation {
  readonly resolved: boolean
  readonly matched: boolean
}

async function observeExpectedRejection<Value>(
  promise: Promise<Value>,
  code: string
): Promise<ExpectedRejectionObservation> {
  return promise.then(
    () => ({ resolved: true, matched: false }),
    error => ({
      resolved: false,
      matched: error instanceof BackendContractError && error.normalized.code === code
    })
  )
}

async function receivesValue(stream: AsyncIterable<{ readonly kind: string }>): Promise<boolean> {
  const iterator = stream[Symbol.asyncIterator]()
  const item = await iterator.next()
  return !item.done && item.value.kind === 'value'
}

async function receivesTerminal(stream: AsyncIterable<{ readonly kind: string }>): Promise<boolean> {
  const iterator = stream[Symbol.asyncIterator]()
  const item = await iterator.next()
  return !item.done && item.value.kind === 'terminal'
}
