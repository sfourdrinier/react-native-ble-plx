/**
 * Pure string helpers (no react-native dependency — safe for web/electron Node entrypoints).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function fillStringWithArguments(value: string, object: any): string {
  return value.replace(/\{([^}]+)\}/g, function (_, arg: string) {
    return object[arg] || '?'
  })
}
