// spikes/rn-binary/specs/NativeRnBinaryArrayBuffer.ts

import type { TurboModule } from 'react-native'
import { TurboModuleRegistry } from 'react-native'

/** Candidate native protocol v1 binary signature: ArrayBuffer request and Promise response. */
export interface Spec extends TurboModule {
  roundTrip(payload: ArrayBuffer): Promise<ArrayBuffer>
}

export default TurboModuleRegistry.getEnforcing<Spec>('RnBinaryArrayBuffer')
