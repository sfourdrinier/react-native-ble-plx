/**
 * Entry for shared UI: Electron (window.bleApi) or Web (createWebBleBridge).
 */
import { bootApp } from './app.js'

async function resolveBridge() {
  // Electron preload exposes bleApi (main-process BLE). Prefer it always when present.
  if (typeof globalThis !== 'undefined' && globalThis.bleApi) {
    return globalThis.bleApi
  }
  const { createWebBleBridge } = await import('./createWebBleBridge.js')
  return createWebBleBridge()
}

resolveBridge()
  .then(bridge => {
    bootApp(bridge)
  })
  .catch(err => {
    console.error('UI boot failed', err)
    const logEl = document.getElementById('log')
    if (logEl) logEl.textContent = `Boot failed: ${err && err.message ? err.message : err}`
  })
