import { Platform } from 'react-native'
import { expandBluetoothUuid } from './discovery/uuidMatch'
import type { UUID } from './TypeDefinition'

export { fillStringWithArguments } from './stringUtils'

/**
 * Converts UUID to full 128bit, lowercase format which should be used to compare UUID values.
 * Delegates to {@link expandBluetoothUuid} so 0x-prefix, braces, and undashed 128-bit
 * tokens share one expansion rule package-wide.
 *
 * @param {UUID} uuid 16bit, 32bit or 128bit UUID (optionally `0x…` / `{…}`).
 * @returns {UUID} 128bit lowercase UUID.
 */
export function fullUUID(uuid: UUID): UUID {
  return expandBluetoothUuid(uuid)
}

/**
 * Live Platform.OS check (not snapshotted at module load).
 * Package suites toggle `Platform.OS` for Android FGS / subscriptionType vs iOS short-circuit.
 */
export function isIOS(): boolean {
  return Platform.OS === 'ios'
}
