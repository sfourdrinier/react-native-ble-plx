// src/backend-contract/backend-sdk.ts

import type { BleCentralBackend } from './backend'
import type { FeatureRegistry } from './capabilities'
import type { NormalizedBleError } from './errors'
import type { BackendIdentity, BackendProvider } from './identity'
import type { BackendCompatibilityOffer } from './primitives'

export interface BackendAuthorMetadata {
  readonly packageName: string
  readonly authorNamespace: string
  readonly backendId: string
  readonly platformId: string
  readonly compatibility: BackendCompatibilityOffer
}
export interface BackendConformanceProfile {
  readonly profileId: string
  readonly mandatoryScenarioIds: readonly string[]
  readonly capabilityRegistry: FeatureRegistry
}
export interface BackendAuthorDefinition<Attachment extends string, Identity extends BackendIdentity<Attachment>> {
  readonly metadata: BackendAuthorMetadata
  readonly provider: BackendProvider<Attachment, Identity>
  readonly backend: BleCentralBackend<Attachment, Identity>
  readonly tck: BackendConformanceProfile
  normalizeError(error: NormalizedBleError): NormalizedBleError
}
