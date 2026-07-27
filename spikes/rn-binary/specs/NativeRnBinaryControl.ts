// spikes/rn-binary/specs/NativeRnBinaryControl.ts

import type { CodegenTypes, TurboModule } from 'react-native'
import { TurboModuleRegistry } from 'react-native'

export type ControlNotification = {
  readonly sequence: number
  readonly payload: ReadonlyArray<number>
}

/**
 * A non-binary control spec used solely to prove the local RN 0.86 Codegen
 * pipeline can parse a TurboModule, emit Promise bindings, and emit events.
 */
export interface Spec extends TurboModule {
  roundTrip(payload: ReadonlyArray<number>): Promise<ReadonlyArray<number>>
  readonly onControlNotification: CodegenTypes.EventEmitter<ControlNotification>
}

export default TurboModuleRegistry.getEnforcing<Spec>('RnBinaryControl')
