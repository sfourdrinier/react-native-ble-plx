/**
 * Chrome Polar/HR demo — serves the **shared** UI (also used by Electron).
 * Electron: 43.2.x stable; Web: Vite + shared shell at example-shared/ui.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * R2-F108: map compiled profile / host paths to TypeScript sources when prepack
 * has not produced `lib/module` yet (dev-friendly Vite without mandatory prepack).
 */
function libOrSrc(relLib, relSrc) {
  const libPath = path.join(repoRoot, relLib)
  const srcPath = path.join(repoRoot, relSrc)
  if (fs.existsSync(libPath)) return libPath
  return srcPath
}

/**
 * Resolve `lib/module/profiles/*.js` (and host modules) to `src/**` when lib is absent.
 */
function srcFallbackPlugin() {
  return {
    name: 'unified-ble-src-fallback',
    enforce: 'pre',
    resolveId(id, importer) {
      const candidates = []
      if (path.isAbsolute(id)) {
        candidates.push(id)
      } else if (importer) {
        candidates.push(path.resolve(path.dirname(importer), id))
      }
      for (const abs of candidates) {
        const norm = abs.replace(/\\/g, '/')
        // Pure profiles (profiles.mjs imports)
        const profileMatch = norm.match(/\/lib\/module\/profiles\/([^/]+)\.js$/)
        if (profileMatch) {
          if (fs.existsSync(abs)) return abs
          const src = path.join(repoRoot, 'src/profiles', `${profileMatch[1]}.ts`)
          if (fs.existsSync(src)) return src
        }
        // Host entry
        const hostMatch = norm.match(/\/lib\/module\/hosts\/([^/]+)\.js$/)
        if (hostMatch) {
          if (fs.existsSync(abs)) return abs
          const src = path.join(repoRoot, 'src/hosts', `${hostMatch[1]}.ts`)
          if (fs.existsSync(src)) return src
        }
      }
      return null
    }
  }
}

export default {
  // Same index.html / app.js / boot.js as Electron renderer
  root: path.join(repoRoot, 'example-shared', 'ui'),
  plugins: [srcFallbackPlugin()],
  server: {
    port: 5173,
    host: true,
    strictPort: false,
    fs: {
      allow: [repoRoot]
    }
  },
  resolve: {
    alias: {
      // Prefer prepack output; fall back to src for hosts when lib missing
      'unified-ble-manager/web': libOrSrc('lib/module/hosts/web.js', 'src/hosts/web.ts'),
      // Keep package root alias for any remaining consumers; shared profiles.mjs
      // imports pure lib/module/profiles/* (never RN main entry).
      'unified-ble-manager': libOrSrc('lib/module/index.js', 'src/index.ts')
    }
  },
  // Allow resolving package profile helpers from example-shared/* profile modules
  optimizeDeps: {
    exclude: ['unified-ble-manager', 'unified-ble-manager/web']
  }
}
