/**
 * ESM twin of centralDemo.js — re-export CJS implementation (single source of truth).
 * Web/Vite resolves this; Electron/Jest use the .js CJS module.
 */
export { createCentralDemo, createDemoFakeRadio } from './centralDemo.js'
