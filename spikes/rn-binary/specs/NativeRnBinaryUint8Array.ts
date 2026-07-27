// spikes/rn-binary/specs/NativeRnBinaryUint8Array.ts

import type { TurboModule } from 'react-native'
import { TurboModuleRegistry } from 'react-native'

/** Candidate native protocol v1 binary signature: Uint8Array request and Promise response. */
export interface Spec extends TurboModule {
  roundTrip(payload: Uint8Array): Promise<Uint8Array>
}

export default TurboModuleRegistry.getEnforcing<Spec>('RnBinaryUint8Array')
