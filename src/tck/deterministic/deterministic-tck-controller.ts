// src/tck/deterministic/deterministic-tck-controller.ts

import { contractError } from '../../backend-contract/errors'
import type { AdapterStateSnapshot } from '../../backend-contract/identity'
import { canonicalUuid, opaqueId, type PeerId, type SerializableRecord } from '../../backend-contract/primitives'
import { deterministicScenarioAdvertisement } from '../../testing/scenarios/manager-scenario-executor'
import type { DeterministicCompletionStage } from '../../testing/deterministic/deterministic-operation-runtime'
import type { DeterministicBackendFixture } from '../../testing/deterministic/deterministic-test-backend'
import type { TckControllerAction, TckScenarioController } from '../contracts'

const deterministicTckActions: readonly TckControllerAction[] = Object.freeze([
  'queue-advertisement',
  'emit-notification',
  'queue-operation-completion',
  'advance-time',
  'force-disconnect',
  'trigger-services-changed',
  'inject-unsubscribe-failure',
  'set-adapter-state'
])

/** Adapts deterministic boundary manipulation to the public TCK controller contract. */
export function createDeterministicTckScenarioController(fixture: DeterministicBackendFixture): TckScenarioController {
  return {
    availableActions: deterministicTckActions,
    now: () => Number(fixture.controller.clock.now()),
    settle: promise => settle(fixture, promise),
    flush: flushMicrotasks,
    perform: async (action, input) => {
      if (action === 'queue-advertisement') {
        requireEmptyInput(action, input)
        fixture.controller.emitAdvertisement(deterministicScenarioAdvertisement())
        return
      }
      if (action === 'emit-notification') {
        fixture.controller.emitNotification(
          {
            serviceUuid: canonicalUuid(stringField(action, input, 'serviceUuid')),
            serviceOccurrence: nonNegativeIntegerField(action, input, 'serviceOccurrence'),
            characteristicUuid: canonicalUuid(stringField(action, input, 'characteristicUuid')),
            characteristicOccurrence: nonNegativeIntegerField(action, input, 'characteristicOccurrence')
          },
          bytesField(action, input, 'value')
        )
        return
      }
      if (action === 'queue-operation-completion') {
        fixture.controller.queueCompletion(completionStage(action, input), {
          delayMs: nonNegativeIntegerField(action, input, 'delayMilliseconds'),
          failure: null,
          cancellable: false,
          deadlineOrder: 'completion-first'
        })
        return
      }
      if (action === 'advance-time') {
        fixture.controller.clock.advanceBy(nonNegativeIntegerField(action, input, 'milliseconds'))
        return
      }
      if (action === 'force-disconnect') {
        fixture.controller.forceDisconnect(peerId(action, input))
        return
      }
      if (action === 'trigger-services-changed') {
        fixture.controller.triggerServicesChanged(peerId(action, input))
        return
      }
      if (action === 'inject-unsubscribe-failure') {
        requireEmptyInput(action, input)
        fixture.controller.peripheral.injectFailure('unsubscribe', 'platform.failure')
        return
      }
      if (action === 'set-adapter-state') {
        fixture.controller.setAdapterState(
          availabilityField(action, input),
          authorizationField(action, input),
          powerField(action, input),
          nullableStringField(action, input, 'safeReason')
        )
        return
      }
      throw contractError('capability.unavailable', 'core', `deterministic-tck-controller.${action}`)
    }
  }
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
  if (!settled) {
    throw contractError('operation.timed-out', 'core', 'deterministic-tck-controller.settle')
  }
  return promise
}

async function flushMicrotasks(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) {
    await Promise.resolve()
  }
}

function requireEmptyInput(action: TckControllerAction, input: SerializableRecord): void {
  if (Object.keys(input).length !== 0) {
    throw malformedInput(action, 'must not contain input')
  }
}

function stringField(action: TckControllerAction, input: SerializableRecord, field: string): string {
  const value = input[field]
  if (typeof value !== 'string' || value.length === 0) {
    throw malformedInput(action, `${field} must be a non-empty string`)
  }
  return value
}

function nullableStringField(action: TckControllerAction, input: SerializableRecord, field: string): string | null {
  const value = input[field]
  if (value === null) {
    return null
  }
  if (typeof value !== 'string') {
    throw malformedInput(action, `${field} must be a string or null`)
  }
  return value
}

function nonNegativeIntegerField(action: TckControllerAction, input: SerializableRecord, field: string): number {
  const value = input[field]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw malformedInput(action, `${field} must be a non-negative safe integer`)
  }
  return value
}

function bytesField(action: TckControllerAction, input: SerializableRecord, field: string): Uint8Array {
  const value = input[field]
  if (!(value instanceof Uint8Array)) {
    throw malformedInput(action, `${field} must be a Uint8Array`)
  }
  return new Uint8Array(value)
}

function completionStage(action: TckControllerAction, input: SerializableRecord): DeterministicCompletionStage {
  const stage = stringField(action, input, 'stage')
  if (stage === 'read' || stage === 'write' || stage === 'subscribe') {
    return stage
  }
  throw malformedInput(action, 'stage must be read, write, or subscribe')
}

function peerId(action: TckControllerAction, input: SerializableRecord): PeerId<string> {
  return opaqueId(stringField(action, input, 'peerId'), 'peer', 'deterministic')
}

function availabilityField(
  action: TckControllerAction,
  input: SerializableRecord
): AdapterStateSnapshot<string>['availability'] {
  const availability = stringField(action, input, 'availability')
  if (
    availability === 'available' ||
    availability === 'unavailable' ||
    availability === 'unsupported' ||
    availability === 'unknown'
  ) {
    return availability
  }
  throw malformedInput(action, 'availability is invalid')
}

function authorizationField(
  action: TckControllerAction,
  input: SerializableRecord
): AdapterStateSnapshot<string>['authorization'] {
  const authorization = stringField(action, input, 'authorization')
  if (
    authorization === 'granted' ||
    authorization === 'denied' ||
    authorization === 'restricted' ||
    authorization === 'not-determined' ||
    authorization === 'unavailable'
  ) {
    return authorization
  }
  throw malformedInput(action, 'authorization is invalid')
}

function powerField(action: TckControllerAction, input: SerializableRecord): AdapterStateSnapshot<string>['power'] {
  const power = stringField(action, input, 'power')
  if (power === 'on' || power === 'off' || power === 'resetting' || power === 'unsupported' || power === 'unknown') {
    return power
  }
  throw malformedInput(action, 'power is invalid')
}

function malformedInput(action: TckControllerAction, detail: string) {
  return contractError('argument.invalid', 'core', `deterministic-tck-controller.${action}`, {
    domain: 'tck-controller',
    code: 'invalid-input',
    safeMessage: detail,
    metadata: { action }
  })
}
