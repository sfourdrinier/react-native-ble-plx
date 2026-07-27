// src/backend-contract/host/electron-renderer.ts

import type { ElectronRendererBoundary } from '../electron'
export interface ElectronRendererHost<Attachment extends string, Renderer extends string> {
  readonly boundary: ElectronRendererBoundary<Attachment, Renderer>
}
