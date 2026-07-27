// src/core/core-adapter-state.ts

import { BackendContractError, contractError } from '../backend-contract/errors'
import type { BleCentralBackend } from '../backend-contract/backend'
import type { AdapterStateSnapshot, BackendIdentity } from '../backend-contract/identity'

/** Reads one native-authoritative adapter snapshot and normalizes unexpected boundary failures. */
export async function readCoreAdapterState<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  backend: BleCentralBackend<Attachment, Identity>
): Promise<AdapterStateSnapshot<Attachment>> {
  try {
    return await backend.adapter.currentState()
  } catch (error) {
    if (error instanceof BackendContractError) {
      throw error
    }
    throw contractError('platform.failure', 'adapter', 'unified-core.adapter-state')
  }
}
