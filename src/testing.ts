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
export { createFirstPartyBackendTckRegistry } from './tck/first-party/first-party-tck-registry'
export { createWebBluetoothFirstPartyTckRegistration } from './tck/first-party/web-bluetooth-tck-registration'
export { createCoreBluetoothFirstPartyTckRegistration } from './tck/first-party/corebluetooth-tck-registration'
export { createBluezFirstPartyTckRegistration } from './tck/first-party/bluez-tck-registration'
export { createWinRtFirstPartyTckRegistration } from './tck/first-party/winrt-tck-registration'
export {
  createReactNativeAndroidFirstPartyTckRegistration,
  createReactNativeAppleFirstPartyTckRegistration
} from './tck/first-party/react-native-tck-registration'
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
  TckRunOptions,
  TckRunReport,
  TckScenarioDefinition,
  TckScenarioController,
  TckScenarioId
} from './tck/contracts'
export type {
  FirstPartyBackendTckRegistration,
  FirstPartyBackendTckRegistry,
  FirstPartyBackendTckRunReport,
  FirstPartyTckCapabilityExclusion,
  FirstPartyTckSuite
} from './tck/first-party/first-party-tck-registry'
export type {
  CoreBluetoothFirstPartyTckRegistrationOptions,
  DeterministicCoreBluetoothBoundary
} from './tck/first-party/corebluetooth-tck-registration'
export type {
  DeterministicWebBluetoothTckBoundary,
  WebBluetoothFirstPartyTckRegistrationOptions,
  WebBluetoothNotificationInput
} from './tck/first-party/web-bluetooth-tck-registration'
export type {
  BluezFirstPartyTckRegistrationOptions,
  BluezNotificationInput,
  DeterministicBluezTckBoundary
} from './tck/first-party/bluez-tck-registration'
export type {
  DeterministicWinRtBoundary,
  WinRtFirstPartyTckRegistrationOptions
} from './tck/first-party/winrt-tck-registration'
export type {
  DeterministicReactNativeAppleTckBoundary,
  DeterministicReactNativeTckBoundary,
  ReactNativeAndroidFirstPartyTckRegistrationOptions,
  ReactNativeAppleFirstPartyTckRegistrationOptions
} from './tck/first-party/react-native-tck-registration'
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
