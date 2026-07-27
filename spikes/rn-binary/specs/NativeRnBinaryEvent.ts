// spikes/rn-binary/specs/NativeRnBinaryEvent.ts

import type { CodegenTypes, TurboModule } from 'react-native'
import { TurboModuleRegistry } from 'react-native'

export type BinaryNotification = {
  readonly sequence: number
  readonly payload: Uint8Array
}

/** Candidate binary event signature, separate from request/response candidates. */
export interface Spec extends TurboModule {
  readonly onBinaryNotification: CodegenTypes.EventEmitter<BinaryNotification>
}

export default TurboModuleRegistry.getEnforcing<Spec>('RnBinaryEvent')
