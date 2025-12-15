export function isBlePlxPluginDebugEnabled(propDebug?: boolean): boolean {
  if (propDebug === true) return true

  const env = process.env.BLEPLX_PLUGIN_DEBUG
  if (!env) return false

  return env === '1' || env.toLowerCase() === 'true' || env.toLowerCase() === 'yes'
}

export function blePlxPluginDebugLog(enabled: boolean, ...args: unknown[]): void {
  if (!enabled) return
  // eslint-disable-next-line no-console
  console.log('[BLEPLX_PLUGIN]', ...args)
}
