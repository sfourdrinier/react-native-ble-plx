// src/testing.ts

/**
 * Deterministic test-only facilities. They are never imported by the public
 * manager root and provide no live-radio support claim.
 */
export {
  createDeterministicTestBackend,
  DeterministicTestBackend
} from './testing/deterministic/deterministic-test-backend'
export type {
  DeterministicBackendController,
  DeterministicBackendFixture,
  DeterministicBackendOptions,
  DeterministicBackendTraceRecord
} from './testing/deterministic/deterministic-test-backend'
export { DeterministicVirtualClock } from './testing/deterministic/virtual-clock'
export { VirtualPeripheral, canonicalUuid } from './testing/deterministic/virtual-peripheral'
export type {
  VirtualCharacteristicAddress,
  VirtualDescriptorAddress,
  VirtualGattCharacteristicDefinition,
  VirtualGattDescriptorDefinition,
  VirtualGattServiceDefinition,
  VirtualPeripheralDefinition,
  VirtualPeripheralOperation,
  VirtualWriteRecord
} from './testing/deterministic/virtual-peripheral'
export { runBackendTck } from './tck/runner'
export { baseTckScenarios, findTckScenario } from './tck/scenarios'
export { TckAssertionError } from './tck/contracts'
export { createDeterministicBackendTckFactory } from './tck/deterministic/deterministic-tck-factory'
export { createDeterministicManagerScenarioFactory } from './testing/scenarios/deterministic-manager-scenario-factory'
export { createManagerScenarioFixture } from './testing/scenarios/manager-scenario-fixture'
export {
  managerScenarioDefinitions,
  runManagerScenarios,
  unsupportedForMissingScenarioControls
} from './testing/scenarios/manager-scenarios'
export { executeManagerScenario, managerScenarioScanOptions } from './testing/scenarios/manager-scenario-executor'
export type {
  BackendTckFactory,
  BackendTckFixture,
  TckFeatureBinding,
  TckFeatureSuite,
  TckProofScope,
  TckRuntimeIdentity,
  TckRunConfiguration,
  TckRunReport,
  TckScenarioDefinition,
  TckScenarioId
} from './tck/contracts'
export type {
  ManagerScenarioDefinition,
  ManagerScenarioControl,
  ManagerScenarioEvidence,
  ManagerScenarioFactId,
  ManagerScenarioFactory,
  ManagerScenarioFixture,
  ManagerScenarioId,
  ManagerScenarioPassedReceipt,
  ManagerScenarioReceipt,
  ManagerScenarioReport,
  ManagerScenarioUnsupported,
  ManagerScenarioUnsupportedReceipt
} from './testing/scenarios/manager-scenarios'
export type { ManagerScenarioBridgeConfiguration } from './testing/scenarios/manager-scenario-fixture'
export type {
  ManagerScenarioController,
  ManagerScenarioExecutionContext
} from './testing/scenarios/manager-scenario-executor'
