// src/testing/deterministic/deterministic-subscription-lifecycle.ts

import { BackendContractError, contractError } from '../../backend-contract/errors'
import type { CleanupRecord } from '../../backend-contract/errors'
import type { OperationOptions, OperationTerminalRecord } from '../../backend-contract/operations'
import type { DeterministicOperationRuntime } from './deterministic-operation-runtime'
import type { DeterministicSubscription, PhysicalSubscription } from './deterministic-test-backend-handles'
import { noOperationOptions, releasedCleanup, takePeripheralFailure } from './deterministic-test-backend-handles'
import type { VirtualPeripheral } from './virtual-peripheral'

interface DeterministicSubscriptionResources {
  readonly operations: DeterministicOperationRuntime
  readonly peripheral: VirtualPeripheral
  readonly physicalSubscriptions: Map<string, PhysicalSubscription>
}

export async function unsubscribeManagedDeterministicSubscription<Operation extends string>(
  resources: DeterministicSubscriptionResources & {
    readonly subscriptionsById: Map<string, DeterministicSubscription>
    readonly managed: DeterministicSubscription
    readonly operation: OperationOptions<string, Operation>
    readonly requireCurrent: () => void
  }
): Promise<OperationTerminalRecord<string, string>> {
  const physical = resources.physicalSubscriptions.get(resources.managed.physicalKey)
  if (physical === undefined || !physical.consumers.has(resources.managed)) {
    throw contractError('gatt.stale-handle', 'gatt', 'gatt.unsubscribe')
  }
  const result = await resources.operations.run(
    'unsubscribe',
    resources.operation,
    resources.operation.correlation,
    false,
    () => {
      resources.requireCurrent()
      const ownsPhysicalDisable = physical.consumers.size === 1
      if (ownsPhysicalDisable) {
        takePeripheralFailure(resources.peripheral, 'unsubscribe', 'gatt.subscribe-failed')
      }
      resources.managed.closeForRemoval()
      physical.consumers.delete(resources.managed)
      resources.subscriptionsById.delete(String(resources.managed.subscriptionId))
      if (ownsPhysicalDisable) {
        physical.state = 'removing'
        resources.physicalSubscriptions.delete(physical.key)
      }
      return undefined
    },
    null,
    null,
    String(resources.managed.path.connectionId)
  )
  return result.terminal
}

export async function disableDeterministicPhysicalSubscription(
  resources: DeterministicSubscriptionResources & {
    readonly physical: PhysicalSubscription
    readonly recordFailure: (cause: import('../../backend-contract/errors').BleErrorCode) => void
  }
): Promise<CleanupRecord> {
  if (resources.physical.enablePromise !== null) {
    try {
      await resources.physical.enablePromise
    } catch (error) {
      resources.recordFailure(error instanceof BackendContractError ? error.normalized.code : 'platform.failure')
      return releasedCleanup
    }
  }
  try {
    await resources.operations.run(
      'unsubscribe',
      noOperationOptions(),
      null,
      false,
      () => {
        takePeripheralFailure(resources.peripheral, 'unsubscribe', 'gatt.subscribe-failed')
        resources.physical.state = 'removing'
        resources.physicalSubscriptions.delete(resources.physical.key)
        return undefined
      },
      null,
      null,
      String(resources.physical.database.path.connectionId),
      true
    )
  } catch (error) {
    const normalized =
      error instanceof BackendContractError
        ? error.normalized
        : contractError('platform.failure', 'cleanup', 'deterministic.unsubscribe').normalized
    return { state: 'release-failed', failures: [{ resourceKind: 'subscription', error: normalized }] }
  }
  return releasedCleanup
}
