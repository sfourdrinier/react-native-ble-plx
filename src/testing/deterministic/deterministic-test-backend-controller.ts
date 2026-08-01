// src/testing/deterministic/deterministic-test-backend-controller.ts

import type { AdvertisementObservation } from '../../backend-contract/advertisement'
import type { ConnectionPath } from '../../backend-contract/gatt'
import type { AdapterStateSnapshot } from '../../backend-contract/identity'
import type { PeerId } from '../../backend-contract/primitives'
import type { DeterministicBackendTraceRecord, DeterministicTestBackend } from './deterministic-test-backend'
import type { DiagnosticTraceDocument } from '../../diagnostics/trace-format'
import type { DeterministicCompletionStage, ProgrammableCompletion } from './deterministic-operation-runtime'
import type { VirtualCharacteristicAddress, VirtualPeripheral, VirtualPeripheralOperation } from './virtual-peripheral'
import type { BleErrorCode } from '../../backend-contract/errors'
import type { DeterministicVirtualClock } from './virtual-clock'

export interface DeterministicBackendController {
  readonly clock: DeterministicVirtualClock
  readonly peripheral: VirtualPeripheral
  queueCompletion(stage: DeterministicCompletionStage, completion: ProgrammableCompletion): void
  emitAdvertisement(observation: AdvertisementObservation<string>): void
  emitNotification(address: VirtualCharacteristicAddress, value: Uint8Array, indication?: boolean): void
  forceDisconnect(peerId: PeerId<string>): ConnectionPath<string, string>
  replayConnectionLoss(connection: ConnectionPath<string, string>): void
  setMaximumWriteLength(maximumWriteLength: number): void
  injectAttError(operation: VirtualPeripheralOperation, code: BleErrorCode): void
  triggerServicesChanged(peerId: PeerId<string>): void
  setAdapterState(
    availability: AdapterStateSnapshot<string>['availability'],
    authorization: AdapterStateSnapshot<string>['authorization'],
    power: AdapterStateSnapshot<string>['power'],
    safeReason: string | null
  ): void
  reset(): void
  traceSnapshot(): readonly DeterministicBackendTraceRecord[]
  traceDocument(): DiagnosticTraceDocument
  pendingBackendAcknowledgements(): number
}

export interface DeterministicBackendFixture {
  readonly backend: DeterministicTestBackend
  readonly controller: DeterministicBackendController
}
