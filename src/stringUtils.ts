/**
 * Pure string helpers (no react-native dependency — safe for web/electron Node entrypoints).
 */

export type StringArgumentValues = {
  readonly [key: string]: string | number | null | undefined
}

export function fillStringWithArguments(value: string, object: StringArgumentValues): string {
  return value.replace(/\{([^}]+)\}/g, function (_, arg: string) {
    const replacement = object[arg]
    return replacement === null || replacement === undefined ? '?' : String(replacement)
  })
}
