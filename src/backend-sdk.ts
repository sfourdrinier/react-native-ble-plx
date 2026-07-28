// src/backend-sdk.ts

/**
 * Public backend-authoring contract. This entrypoint is intentionally separate
 * from the application root so backend implementation dependencies are opt-in.
 */
export * from './backend-contract'
export {
  createBackendAuthorDefinition,
  featureRegistryOf,
  inspectBackendCapabilities,
  runBackendAuthorTck
} from './backend-sdk-authoring'
export type {
  BackendAuthorDefinition,
  BackendAuthorMetadata,
  BackendConformanceProfile
} from './backend-contract/backend-sdk'
export type {
  BackendAuthoringDefinition,
  BackendCapabilityReport,
  BackendCapabilityReportEntry
} from './backend-sdk-authoring'
export { runBackendTck } from './tck/runner'
export { baseTckScenarios, findTckScenario } from './tck/scenarios'
export { TckAssertionError } from './tck/contracts'
export type {
  BackendTckFactory,
  BackendTckFixture,
  RegisteredFeature,
  TckControllerAction,
  TckFact,
  TckFactId,
  TckFeatureBinding,
  TckFeatureSuite,
  TckProofLabel,
  TckProofScope,
  TckRuntimeIdentity,
  TckRunOptions,
  TckRunReport,
  TckScenarioDefinition,
  TckScenarioController,
  TckScenarioId,
  TckScenarioReceipt
} from './tck/contracts'
