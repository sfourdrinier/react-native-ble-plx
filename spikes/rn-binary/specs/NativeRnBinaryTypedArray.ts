// spikes/rn-binary/specs/NativeRnBinaryTypedArray.ts

import type { TurboModule } from 'react-native'
import { TurboModuleRegistry } from 'react-native'

/** Candidate native protocol v1 binary signature: TypedArray request and Promise response. */
export interface Spec extends TurboModule {
  roundTrip(payload: TypedArray): Promise<TypedArray>
}

export default TurboModuleRegistry.getEnforcing<Spec>('RnBinaryTypedArray')
