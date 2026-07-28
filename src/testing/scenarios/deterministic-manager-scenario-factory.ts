// src/testing/scenarios/deterministic-manager-scenario-factory.ts

import {
  attachBleBackend,
  BleManager,
  createManagerOwnershipAuthority,
  DEFAULT_BLE_MANAGER_OPTIONS
} from '../../manager/ble-manager'
import { opaqueId, version, versionRange } from '../../backend-contract/primitives'
import type { BackendCompatibilityOffer } from '../../backend-contract/primitives'
import type { AttachedBackend, ManagerConstruction } from '../../backend-contract/backend'
import type { HostNeutralBackendIdentity } from '../../backend-contract/identity'
import type { CleanupRecord } from '../../backend-contract/errors'
import {
  deterministicScenarioAdvertisement,
  managerScenarioScanOptions,
  type ManagerScenarioController
} from './manager-scenario-executor'
import { createManagerScenarioFixture } from './manager-scenario-fixture'
import type { ManagerScenarioControl, ManagerScenarioFactory } from './manager-scenarios'
import {
  createDeterministicTestBackend,
  type DeterministicBackendFixture
} from '../deterministic/deterministic-test-backend'

const deterministicCompatibility: BackendCompatibilityOffer = {
  backendContract: versionRange(version('backend-contract', 1), version('backend-contract', 1)),
  capabilitySchema: versionRange(version('capability-schema', 1), version('capability-schema', 1)),
  eventSchema: versionRange(version('event-schema', 1), version('event-schema', 1)),
  traceFormat: versionRange(version('trace-format', 1), version('trace-format', 1))
}

const deterministicControls: readonly ManagerScenarioControl[] = Object.freeze([
  'advertisement',
  'notification',
  'late-advertisement',
  'late-notification',
  'virtual-operation-timing',
  'services-changed',
  'forced-disconnect',
  'unsubscribe-failure',
  'adapter-loss'
])

type DeterministicManager = BleManager<string, HostNeutralBackendIdentity<string>>

/** Binds the deterministic virtual peripheral to the shared public-manager scenario executor. */
export function createDeterministicManagerScenarioFactory(): ManagerScenarioFactory {
  return {
    backendId: 'unified-ble:deterministic-test',
    platformId: 'test:deterministic',
    create: async () => {
      const fixture = createDeterministicTestBackend()
      const attached = await attachBleBackend(fixture.backend, deterministicCompatibility)
      const authority = createManagerOwnershipAuthority(attached)
      const owner = await BleManager.create(
        managerConstruction(attached, 'owner', 'owning'),
        authority,
        DEFAULT_BLE_MANAGER_OPTIONS
      )
      let borrower: DeterministicManager | null = null
      let disposed = false
      return createManagerScenarioFixture({
        backendId: 'unified-ble:deterministic-test',
        platformId: 'test:deterministic',
        evidence: { proofScope: 'deterministic', boundaryKind: 'deterministic-backend' },
        owner,
        createBorrower: async () => {
          borrower = await BleManager.create(
            managerConstruction(attached, 'borrower', 'borrowing'),
            authority,
            DEFAULT_BLE_MANAGER_OPTIONS
          )
          return borrower
        },
        controller: createDeterministicManagerScenarioController(fixture),
        resourceCounters: () => fixture.backend.resourceCounters(),
        dispose: async () => {
          if (disposed) {
            return { state: 'released', failures: [] }
          }
          disposed = true
          return disposeManagers(fixture, owner, borrower)
        }
      })
    }
  }
}

export function createDeterministicManagerScenarioController(
  fixture: DeterministicBackendFixture
): ManagerScenarioController<string> {
  return {
    availableControls: deterministicControls,
    now: () => Number(fixture.controller.clock.now()),
    scanOptions: (itemCapacity, byteCapacity) => managerScenarioScanOptions(itemCapacity, byteCapacity),
    settle: promise => settle(fixture, promise),
    flush: flushMicrotasks,
    advanceBy: milliseconds => fixture.controller.clock.advanceBy(milliseconds),
    emitAdvertisement: () => fixture.controller.emitAdvertisement(deterministicScenarioAdvertisement()),
    emitNotification: (path, value) => fixture.controller.emitNotification(characteristicAddress(path), value),
    forceDisconnect: peerId => fixture.controller.forceDisconnect(peerId),
    triggerServicesChanged: peerId => fixture.controller.triggerServicesChanged(peerId),
    queueDelayedRead: delayMilliseconds =>
      fixture.controller.queueCompletion('read', {
        delayMs: delayMilliseconds,
        failure: null,
        cancellable: false,
        deadlineOrder: 'completion-first'
      }),
    injectUnsubscribeFailure: () => fixture.controller.peripheral.injectFailure('unsubscribe', 'platform.failure'),
    loseAdapter: () => fixture.controller.setAdapterState('unavailable', 'unavailable', 'off', 'scenario adapter loss')
  }
}

function managerConstruction(
  attachedBackend: AttachedBackend<string, HostNeutralBackendIdentity<string>>,
  identity: string,
  ownerMode: 'owning' | 'borrowing'
): ManagerConstruction<string, HostNeutralBackendIdentity<string>> {
  return {
    attachedBackend,
    clientId: opaqueId(`scenario-${identity}-client`, 'client', `deterministic:scenario:${identity}`),
    managerId: opaqueId(`scenario-${identity}-manager`, 'manager', `deterministic:scenario:${identity}`),
    ownerMode
  }
}

function characteristicAddress(path: Parameters<ManagerScenarioController<string>['emitNotification']>[0]) {
  return {
    serviceUuid: path.serviceUuid,
    serviceOccurrence: Number(path.serviceOccurrence),
    characteristicUuid: path.characteristicUuid,
    characteristicOccurrence: Number(path.characteristicOccurrence)
  }
}

async function disposeManagers(
  fixture: DeterministicBackendFixture,
  owner: DeterministicManager,
  borrower: DeterministicManager | null
): Promise<CleanupRecord> {
  if (borrower !== null && borrower.state !== 'destroyed') {
    const borrowerCleanup = await settle(fixture, borrower.destroy())
    if (borrowerCleanup.state === 'release-failed') {
      return borrowerCleanup
    }
  }
  if (owner.state !== 'destroyed') {
    return settle(fixture, owner.destroy())
  }
  return { state: 'released', failures: [] }
}

async function settle<Value>(fixture: DeterministicBackendFixture, promise: Promise<Value>): Promise<Value> {
  let settled = false
  promise.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    }
  )
  for (let attempt = 0; attempt < 100 && !settled; attempt += 1) {
    fixture.controller.clock.runUntilIdle()
    await Promise.resolve()
  }
  return promise
}

async function flushMicrotasks(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) {
    await Promise.resolve()
  }
}
