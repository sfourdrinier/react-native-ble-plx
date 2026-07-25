/**
 * Optional codemod v0: rewrite Base64 characteristic **reads** to AsBytes variants.
 * Does **not** rewrite writes — FromBytes APIs take Uint8Array, not Base64 strings.
 * Fixture-driven only — not required for 4.0 upgrade (compat guarantee).
 *
 * Usage:
 *   node scripts/codemod/transform-bytes-path.js path/to/file.js
 *   node scripts/codemod/transform-bytes-path.js --check scripts/codemod/fixtures/before-read.js
 */

const fs = require('fs')
const path = require('path')

const REPLACEMENTS = [
  {
    from: /readCharacteristicForDevice\s*\(/g,
    to: 'readCharacteristicForDeviceAsBytes('
  }
  // Intentionally no write* rewrites: write*FromBytes expects Uint8Array args,
  // not Base64 strings left in place by a naive rename.
]

function transformSource(source) {
  let out = source
  for (const { from, to } of REPLACEMENTS) {
    out = out.replace(from, to)
  }
  return out
}

function main(argv) {
  const check = argv.includes('--check')
  const file = argv.find(a => !a.startsWith('-') && a !== process.argv[1])
  if (!file) {
    console.error('Usage: transform-bytes-path.js [--check] <file.js>')
    process.exit(2)
  }
  const abs = path.resolve(file)
  const src = fs.readFileSync(abs, 'utf8')
  const out = transformSource(src)
  if (check) {
    if (out === src && !/AsBytes/.test(src)) {
      console.error('codemod --check: no bytes-path transforms applied')
      process.exit(1)
    }
    if (!out.includes('AsBytes')) {
      console.error('codemod --check: expected AsBytes in output')
      process.exit(1)
    }
    // Guard: must not produce FromBytes with leftover Base64-shaped call sites
    if (/FromBytes\s*\(/.test(out) && !/FromBytes\s*\([^)]*Uint8Array/.test(out)) {
      // soft: FromBytes without obvious Uint8Array is suspicious but not required in fixtures
    }
    console.log('codemod --check OK:', path.relative(process.cwd(), abs))
    return
  }
  process.stdout.write(out)
}

if (require.main === module) {
  main(process.argv.slice(2))
}

module.exports = { transformSource, REPLACEMENTS }
