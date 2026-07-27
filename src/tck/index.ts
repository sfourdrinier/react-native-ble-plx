// src/tck/index.ts

export { runBackendTck } from './runner'
export { baseTckScenarios, findTckScenario } from './scenarios'
export { TckAssertionError } from './contracts'
export type { TckScenarioAdapter } from './scenario-adapter'
export type {
  BackendTckFactory,
  BackendTckFixture,
  RegisteredFeature,
  TckController,
  TckControllerAction,
  TckControllerResult,
  TckFact,
  TckFactId,
  TckFeatureBinding,
  TckFeatureSuite,
  TckProofLabel,
  TckProofScope,
  TckRuntimeIdentity,
  TckRunConfiguration,
  TckRunReport,
  TckScenarioDefinition,
  TckScenarioId,
  TckScenarioReceipt
} from './contracts'
