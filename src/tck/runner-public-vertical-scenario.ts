// src/tck/runner-public-vertical-scenario.ts

import type { BleCentralBackend } from '../backend-contract/backend'
import type { BackendIdentity } from '../backend-contract/identity'
import { byteLimit, ownBytes, type SerializableRecord } from '../backend-contract/primitives'
import type { BleManager } from '../manager/ble-manager'
import { managerScenarioScanOptions } from '../testing/scenarios/manager-scenario-executor'
import type { BackendTckFixture, TckScenarioDefinition } from './contracts'
import { TckAssertionError } from './contracts'

export async function executePublicVerticalSlice<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(
  manager: BleManager<Attachment, Identity>,
  fixture: BackendTckFixture<Attachment, Identity, Backend>,
  definition: TckScenarioDefinition
): Promise<void> {
  const scan = await fixture.controller.settle(manager.scan(managerScenarioScanOptions(4, 128)))
  const scanIterator = scan.observations[Symbol.asyncIterator]()
  const observation = scanIterator.next()
  await fixture.controller.perform('queue-advertisement', emptyInput)
  await fixture.controller.flush()
  const observed = await fixture.controller.settle(observation)
  if (observed.done || observed.value.kind !== 'value') {
    throw new TckAssertionError(definition.id, 'public manager scan did not receive an advertisement')
  }

  const connection = await fixture.controller.settle(manager.connect(observed.value.value.peerId, operationOptions))
  const database = await fixture.controller.settle(connection.discover(operationOptions))
  const snapshot = await database.snapshot()
  const characteristic = snapshot.characteristics[0]
  if (characteristic === undefined) {
    throw new TckAssertionError(definition.id, 'public manager discovery returned no characteristic')
  }
  const value = await fixture.controller.settle(database.read(characteristic.path, operationOptions))
  if (value.byteLength === 0) {
    throw new TckAssertionError(definition.id, 'public manager read returned no bytes')
  }

  const subscription = await fixture.controller.settle(
    database.subscribe(characteristic.path, {
      ...operationOptions,
      delivery: managerScenarioScanOptions(4, 128).delivery
    })
  )
  const notification = subscription.values[Symbol.asyncIterator]().next()
  await fixture.controller.perform(
    'emit-notification',
    Object.freeze({
      serviceUuid: String(characteristic.path.serviceUuid),
      serviceOccurrence: Number(characteristic.path.serviceOccurrence),
      characteristicUuid: String(characteristic.path.characteristicUuid),
      characteristicOccurrence: Number(characteristic.path.characteristicOccurrence),
      value: ownBytes(new Uint8Array([21]), byteLimit(1))
    })
  )
  await fixture.controller.flush()
  const delivered = await fixture.controller.settle(notification)
  if (delivered.done || delivered.value.kind !== 'value' || delivered.value.value.value[0] !== 21) {
    throw new TckAssertionError(definition.id, 'public manager notification was not delivered exactly')
  }
  const postGattObservation = scanIterator.next()
  await fixture.controller.perform('queue-advertisement', emptyInput)
  await fixture.controller.flush()
  const postGattObserved = await fixture.controller.settle(postGattObservation)
  if (postGattObserved.done || postGattObserved.value.kind !== 'value') {
    throw new TckAssertionError(definition.id, 'public manager scan did not remain active through GATT work')
  }
  assertReleased(definition, await fixture.controller.settle(subscription.remove()), 'subscription')
  assertReleased(definition, await fixture.controller.settle(scan.stop()), 'scan')
  if (Number(manager.localResourceCounters().activeScanControllers) !== 0) {
    throw new TckAssertionError(definition.id, 'public manager retained a scan controller after cleanup')
  }
}

function assertReleased(
  definition: TckScenarioDefinition,
  cleanup: Awaited<ReturnType<{ stop(): Promise<import('../backend-contract/errors').CleanupRecord> }['stop']>>,
  resource: string
): void {
  if (cleanup.state !== 'released' || cleanup.failures.length !== 0) {
    throw new TckAssertionError(
      definition.id,
      `public manager ${resource} cleanup returned ${cleanup.state} with failures: ${
        cleanup.failures.map(failure => failure.error.code).join(', ') || 'none'
      }`
    )
  }
}

const emptyInput: SerializableRecord = Object.freeze({})
const operationOptions = Object.freeze({ signal: null, deadline: null })
