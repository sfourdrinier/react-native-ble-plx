// src/backend-contract/host/node.ts

import type { BackendProvider, HostNeutralBackendIdentity } from '../identity'
export interface NodeHost<Attachment extends string> {
  readonly provider: BackendProvider<Attachment, HostNeutralBackendIdentity<Attachment>>
}
