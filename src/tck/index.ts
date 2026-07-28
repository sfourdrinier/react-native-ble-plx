// src/tck/index.ts

export { runBackendTck } from './runner'
export { baseTckScenarios, findTckScenario } from './scenarios'
export { TckAssertionError } from './contracts'
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
} from './contracts'
