// src/codecs.ts

/** Binary-only codec primitives. BLE payloads remain Uint8Array throughout public operations. */
export { copyBytes, dataView } from './codecs-primitives'

export { ProfileCodecError } from './profiles/errors'
export type { ProfileCodecErrorCode } from './profiles/errors'
export {
  decodeIeee11073Float,
  decodeIeee11073Sfloat,
  encodeIeee11073Float,
  encodeIeee11073Sfloat
} from './profiles/ieee-11073'
export type { Ieee11073FiniteValue, Ieee11073SpecialValue, Ieee11073Value } from './profiles/ieee-11073'
