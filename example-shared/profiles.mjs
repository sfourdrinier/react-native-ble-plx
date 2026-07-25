/**
 * ESM re-export of package SIG profiles for the web example.
 * Imports pure profile modules only (never the package main entry, which pulls RN).
 *
 * Resolution (R2-F108):
 * - After `pnpm prepack`: `../lib/module/profiles/*.js` exists.
 * - Vite dev without prepack: `example-web/vite.config.js` aliases
 *   `lib/module/profiles/*` → `src/profiles/*.ts`.
 * - CJS twin (`profiles.js`) falls back to `src/profiles` via require.
 * Source of truth: `src/profiles/*`.
 */
export * from '../lib/module/profiles/heartRate.js'
export * from '../lib/module/profiles/battery.js'
export * from '../lib/module/profiles/deviceInformation.js'
export * from '../lib/module/profiles/healthThermometer.js'
export * from '../lib/module/profiles/bloodPressure.js'
