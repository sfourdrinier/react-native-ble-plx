// src/profiles/errors.ts

export type ProfileCodecErrorCode =
  | 'profile.codec.truncated'
  | 'profile.codec.malformed'
  | 'profile.codec.reserved'
  | 'profile.codec.invalid-value'

/** A standards-level payload failure that is distinct from a transport failure. */
export class ProfileCodecError extends Error {
  constructor(
    readonly code: ProfileCodecErrorCode,
    readonly codec: string,
    readonly detail: string,
    readonly offset: number | null = null
  ) {
    super(`${code}: ${codec}: ${detail}`)
    this.name = 'ProfileCodecError'
  }
}

export function profileCodecError(
  code: ProfileCodecErrorCode,
  codec: string,
  detail: string,
  offset: number | null = null
): ProfileCodecError {
  return new ProfileCodecError(code, codec, detail, offset)
}
