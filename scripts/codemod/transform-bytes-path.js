/**
 * Optional codemod v0: rewrite Base64 characteristic reads to AsBytes variants.
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
  },
  {
    from: /writeCharacteristicWithResponseForDevice\s*\(/g,
    to: 'writeCharacteristicWithResponseForDeviceFromBytes('
  },
  {
    from: /writeCharacteristicWithoutResponseForDevice\s*\(/g,
    to: 'writeCharacteristicWithoutResponseForDeviceFromBytes('
  },
  {
    from: /monitorCharacteristicForDevice\s*\(/g,
    to: 'monitorCharacteristicForDeviceAsBytes('
  }
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
    if (out === src && !/AsBytes|FromBytes/.test(src)) {
      console.error('codemod --check: no bytes-path transforms applied')
      process.exit(1)
    }
    if (!out.includes('AsBytes') && !out.includes('FromBytes')) {
      console.error('codemod --check: expected AsBytes/FromBytes in output')
      process.exit(1)
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
