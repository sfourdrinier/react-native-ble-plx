// src/tck/deterministic/deterministic-tck-factory.ts

import type { AdapterSelection, BackendProvider, HostNeutralBackendIdentity } from '../../backend-contract/identity'
import type { BackendCompatibilityOffer, SerializableRecord } from '../../backend-contract/primitives'
import { opaqueId, version, versionRange } from '../../backend-contract/primitives'
import { contractError } from '../../backend-contract/errors'
import {
  createDeterministicTestBackend,
  type DeterministicBackendController,
  type DeterministicBackendOptions,
  type DeterministicTestBackend
} from '../../testing/deterministic/deterministic-test-backend'
import type { BackendTckFactory, TckController, TckControllerAction, TckControllerResult } from '../contracts'
import { createRunnerControlledTckScenarioAdapter } from '../scenario-adapter'
import {
  createDeterministicTckAdvertisement,
  executeDeterministicTckScenarioEvidence
} from './deterministic-tck-scenarios'

const deterministicCompatibility: BackendCompatibilityOffer = {
  backendContract: versionRange(version('backend-contract', 1), version('backend-contract', 1)),
  capabilitySchema: versionRange(version('capability-schema', 1), version('capability-schema', 1)),
  eventSchema: versionRange(version('event-schema', 1), version('event-schema', 1)),
  traceFormat: versionRange(version('trace-format', 1), version('trace-format', 1))
}

const supportedControllerActions: readonly TckControllerAction[] = [
  'reset',
  'queue-advertisement',
  'force-disconnect',
  'trigger-services-changed',
  'inject-att-error',
  'configure-notifications',
  'set-read-value',
  'restart-backend',
  'set-adapter-state'
]

export interface DeterministicTckFactoryOptions {
  readonly backend?: DeterministicBackendOptions
}

/** Binds the production deterministic backend to the public production TCK. */
export function createDeterministicBackendTckFactory(
  options: DeterministicTckFactoryOptions = {}
): BackendTckFactory<string, HostNeutralBackendIdentity<string>, DeterministicTestBackend> {
  const providerBinding = createDeterministicProvider(options.backend)
  return {
    backendId: 'unified-ble:deterministic-test',
    provider: providerBinding.provider,
    selection: providerBinding.selection,
    run: { proofScope: 'deterministic' },
    create: async () => {
      const fixture = createDeterministicTestBackend(options.backend)
      const controller = new DeterministicTckController(fixture.controller)
      return {
        backend: fixture.backend,
        controller,
        scenarioAdapter: createRunnerControlledTckScenarioAdapter(definition =>
          executeDeterministicTckScenarioEvidence(fixture, providerBinding.provider, definition)
        ),
        dispose: async () => {
          await fixture.backend.destroy()
        }
      }
    }
  }
}

function createDeterministicProvider(options: DeterministicBackendOptions | undefined): {
  readonly provider: BackendProvider<string, HostNeutralBackendIdentity<string>>
  readonly selection: AdapterSelection<string>
} {
  const descriptorFixture = createDeterministicTestBackend(options)
  const adapter = descriptorFixture.backend.identity.attachment.adapter
  return {
    selection: { selectedAdapterId: adapter.adapterId },
    provider: {
      descriptor: {
        providerId: 'unified-ble:deterministic-test-provider',
        hostKind: 'test',
        loadability: 'loadable',
        compatibility: deterministicCompatibility
      },
      listAdapters: async () => [adapter],
      create: async selection => {
        if (String(selection.selectedAdapterId) !== String(adapter.adapterId)) {
          throw contractError('adapter.unavailable', 'adapter', 'deterministic-provider.create')
        }
        return createDeterministicTestBackend(options).backend
      }
    }
  }
}

class DeterministicTckController implements TckController {
  readonly availableActions = supportedControllerActions

  constructor(private readonly controller: DeterministicBackendController) {}

  async perform(action: TckControllerAction, input: SerializableRecord): Promise<TckControllerResult> {
    if (action === 'reset' || action === 'restart-backend') {
      this.controller.reset()
      return applied(action, { reset: true })
    }
    if (action === 'queue-advertisement') {
      this.controller.emitAdvertisement(createDeterministicTckAdvertisement())
      return applied(action, { emitted: true })
    }
    if (action === 'force-disconnect') {
      this.controller.forceDisconnect(
        opaqueId(inputString(input, 'peerId') ?? 'deterministic-peer', 'peer', 'deterministic')
      )
      return applied(action, { commandDelivered: true })
    }
    if (action === 'trigger-services-changed') {
      this.controller.triggerServicesChanged(
        opaqueId(inputString(input, 'peerId') ?? 'deterministic-peer', 'peer', 'deterministic')
      )
      return applied(action, { commandDelivered: true })
    }
    if (action === 'inject-att-error') {
      this.controller.peripheral.injectFailure('read', 'gatt.read-failed')
      return applied(action, { operation: 'read' })
    }
    if (action === 'configure-notifications') {
      const address = defaultCharacteristicAddress(this.controller)
      const notifying = this.controller.peripheral.canNotify(address, false)
      return { action, applied: notifying, detail: { notifying } }
    }
    if (action === 'set-read-value') {
      this.controller.peripheral.setCharacteristicValue(
        defaultCharacteristicAddress(this.controller),
        new Uint8Array([7])
      )
      return applied(action, { valueLength: 1 })
    }
    if (action === 'set-adapter-state') {
      this.controller.setAdapterState(
        adapterAvailability(inputString(input, 'availability')),
        adapterAuthorization(inputString(input, 'authorization')),
        adapterPower(inputString(input, 'power')),
        inputString(input, 'safeReason')
      )
      return applied(action, { stateUpdated: true })
    }
    return { action, applied: false, detail: { unsupported: true } }
  }
}

function applied(action: TckControllerAction, detail: SerializableRecord): TckControllerResult {
  return { action, applied: true, detail }
}

function inputString(input: SerializableRecord, key: string): string | null {
  const value = input[key]
  return typeof value === 'string' ? value : null
}

function adapterAvailability(value: string | null): 'available' | 'unavailable' | 'unsupported' | 'unknown' {
  if (value === 'unavailable' || value === 'unsupported' || value === 'unknown') {
    return value
  }
  return 'available'
}

function adapterAuthorization(
  value: string | null
): 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unavailable' {
  if (value === 'denied' || value === 'restricted' || value === 'not-determined' || value === 'unavailable') {
    return value
  }
  return 'granted'
}

function adapterPower(value: string | null): 'on' | 'off' | 'resetting' | 'unsupported' | 'unknown' {
  if (value === 'off' || value === 'resetting' || value === 'unsupported' || value === 'unknown') {
    return value
  }
  return 'on'
}

function defaultCharacteristicAddress(controller: DeterministicBackendController) {
  const service = controller.peripheral.services()[0]
  if (service === undefined) {
    throw new Error('deterministic TCK requires a virtual service')
  }
  const characteristic = service.characteristics[0]
  if (characteristic === undefined) {
    throw new Error('deterministic TCK requires a virtual characteristic')
  }
  return {
    serviceUuid: service.uuid,
    serviceOccurrence: service.occurrence,
    characteristicUuid: characteristic.uuid,
    characteristicOccurrence: characteristic.occurrence
  }
}
