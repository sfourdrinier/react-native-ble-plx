// src/backend-contract/host/electron-main.ts

import type { ElectronMainArbiter } from '../electron'
import type { BackendProvider, IpcBackendIdentity } from '../identity'
export {
  ElectronMainArbiterContext,
  type ElectronMainArbiter,
  type ElectronMainArbiterAuthority,
  type ElectronMainArbiterHandlers,
  type IpcEnvelope,
  type TrustedIpcSender
} from '../electron'
export interface ElectronMainHost<Attachment extends string> {
  readonly provider: BackendProvider<Attachment, IpcBackendIdentity<Attachment>>
  readonly arbiter: ElectronMainArbiter<Attachment>
}
