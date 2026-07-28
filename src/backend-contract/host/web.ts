// src/backend-contract/host/web.ts

import type { ScanFilter } from '../advertisement'
import type { BackendProvider, HostNeutralBackendIdentity } from '../identity'
import type { PublicOperationOptions } from '../operations'
import type { PeerId, Uuid } from '../primitives'

export interface ChooserRequest {
  readonly filters: readonly ScanFilter[]
  readonly acceptAllDevices: boolean
  readonly optionalServices: readonly Uuid[]
}
export interface ChooserSelection<Attachment extends string> {
  readonly peerId: PeerId<Attachment>
  readonly grantedServices: readonly Uuid[]
}
export interface WebChooser<Attachment extends string> {
  choose(request: ChooserRequest, options: PublicOperationOptions): Promise<ChooserSelection<Attachment>>
}
export interface WebHost<Attachment extends string> {
  readonly provider: BackendProvider<Attachment, HostNeutralBackendIdentity<Attachment>>
  readonly chooser: WebChooser<Attachment>
}
