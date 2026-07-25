/**
 * EXPERIMENTAL optional codemod — monorepo-only, NOT required for 4.0 upgrade.
 *
 * Charter: Base64 call sites keep working. This tool is opt-in only for teams
 * that want an *assisted* jump to the additive `*AsBytes` path.
 *
 * **Not published on npm** — lives under `scripts/` (omitted from package `files`).
 * Clone the monorepo to run it; published consumers should migrate by hand or stay
 * on Base64 (recommended).
 *
 * Limits (ROADMAP §6.2 / §6.3):
 * - Does **not** rewrite writes (`*FromBytes` needs Uint8Array args, not Base64).
 * - Safe mode uses TypeScript AST **call-site** analysis: only renames a
 *   `readCharacteristicForDevice` when that call’s binding does not consume
 *   `.value` in a Base64-shaped way (mixed files rewrite selectively).
 * - Aggressive renames mark remaining `.value` consumers with `// ble-plx-4: review`.
 * - Always dry-run / review the report before `--write`.
 *
 * Usage:
 *   node scripts/codemod/transform-bytes-path.js --dry-run path/to/file.js
 *   node scripts/codemod/transform-bytes-path.js --write path/to/file.js
 *   node scripts/codemod/transform-bytes-path.js --check scripts/codemod/fixtures/before-read.js
 *   node scripts/codemod/transform-bytes-path.js --aggressive path/to/file.js
 *   node scripts/codemod/transform-bytes-path.js path/to/file.js   # print transformed source
 */

'use strict'

const fs = require('fs')
const path = require('path')
const ts = require('typescript')

const REVIEW_MARKER = '// ble-plx-4: review'
const TARGET_NAME = 'readCharacteristicForDevice'
const REPLACEMENT_NAME = 'readCharacteristicForDeviceAsBytes'

/**
 * True if `node` is a call to `readCharacteristicForDevice` (bare or member).
 * @param {ts.Node} node
 * @returns {node is ts.CallExpression}
 */
function isReadCharacteristicCall(node) {
  if (!ts.isCallExpression(node)) return false
  const expr = node.expression
  if (ts.isIdentifier(expr)) return expr.text === TARGET_NAME
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text === TARGET_NAME
  return false
}

/**
 * Callee name node to replace (`readCharacteristicForDevice` identifier).
 * @param {ts.CallExpression} call
 * @returns {ts.Identifier | null}
 */
function getCalleeNameNode(call) {
  const expr = call.expression
  if (ts.isIdentifier(expr)) return expr
  if (ts.isPropertyAccessExpression(expr)) return expr.name
  return null
}

/**
 * Binding name assigned from this call (const/let/var x = await? call).
 * @param {ts.CallExpression} call
 * @returns {string | null}
 */
function getAssignedBindingName(call) {
  let node = call.parent
  // unwrap await
  if (node && ts.isAwaitExpression(node)) {
    node = node.parent
  }
  if (!node) return null
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    return node.name.text
  }
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isIdentifier(node.left)
  ) {
    return node.left.text
  }
  return null
}

/**
 * Nearest function-like body containing `node`, or source file.
 * @param {ts.Node} node
 * @returns {ts.Node}
 */
function getEnclosingScope(node) {
  let cur = node.parent
  while (cur) {
    if (
      ts.isFunctionDeclaration(cur) ||
      ts.isFunctionExpression(cur) ||
      ts.isArrowFunction(cur) ||
      ts.isMethodDeclaration(cur) ||
      ts.isConstructorDeclaration(cur) ||
      ts.isGetAccessorDeclaration(cur) ||
      ts.isSetAccessorDeclaration(cur)
    ) {
      return cur.body || cur
    }
    if (ts.isSourceFile(cur)) return cur
    cur = cur.parent
  }
  return node.getSourceFile()
}

/**
 * Does this PropertyAccess `binding.value` look Base64-shaped at this site?
 * @param {ts.PropertyAccessExpression} access
 * @returns {boolean}
 */
function isValueAccessBase64Shaped(access) {
  const parent = access.parent
  if (!parent) return false

  // return x.value
  if (ts.isReturnStatement(parent) && parent.expression === access) return true

  // typeof x.value
  if (parent.kind === ts.SyntaxKind.TypeOfExpression) return true

  // x.value === '...' / !== / == / !=
  if (ts.isBinaryExpression(parent)) {
    const op = parent.operatorToken.kind
    if (
      op === ts.SyntaxKind.EqualsEqualsToken ||
      op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      op === ts.SyntaxKind.ExclamationEqualsToken ||
      op === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      op === ts.SyntaxKind.PlusToken
    ) {
      return true
    }
  }

  // atob(x.value) / base64ToBytes(x.value) / Buffer.from(x.value, 'base64')
  if (ts.isCallExpression(parent)) {
    const argIndex = parent.arguments.indexOf(access)
    if (argIndex < 0) return false
    const callee = parent.expression
    if (ts.isIdentifier(callee)) {
      const name = callee.text
      if (name === 'atob' || name === 'btoa' || name === 'base64ToBytes' || name === 'bytesToBase64') {
        return true
      }
    }
    // Buffer.from(x.value, 'base64')
    if (
      ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      callee.expression.text === 'Buffer' &&
      callee.name.text === 'from'
    ) {
      const encoding = parent.arguments[1]
      if (
        encoding &&
        ts.isStringLiteral(encoding) &&
        /base64/i.test(encoding.text)
      ) {
        return true
      }
    }
  }

  return false
}

/**
 * True if `binding` has a Base64-shaped `.value` use inside `scope`.
 * @param {ts.Node} scope
 * @param {string} binding
 * @returns {boolean}
 */
function bindingUsesValueAsStringLike(scope, binding) {
  let found = false
  function visit(node) {
    if (found) return
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === binding &&
      node.name.text === 'value'
    ) {
      if (isValueAccessBase64Shaped(node)) {
        found = true
        return
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(scope)
  return found
}

/**
 * Heuristic fallback when AST cannot resolve a binding (file-level).
 * Used only for unassigned call results inspected via whole expression chains.
 * @param {string} source
 */
function usesValueAsStringLike(source) {
  const code = source.replace(/\/\/[^\n]*/g, '')
  return (
    /\breturn\s+\w+\.value\b/.test(code) ||
    /\btypeof\s+\w+\.value\b/.test(code) ||
    /\w+\.value\s*===\s*['"]/.test(code) ||
    /\w+\.value\s*\+\s*['"]/.test(code) ||
    (/\.value\b/.test(code) && /atob|base64ToBytes|Buffer\.from\s*\([^,]+,\s*['"]base64['"]/i.test(code))
  )
}

/**
 * Collect per-call rewrite decisions via TypeScript AST.
 * @param {string} source
 * @returns {{ start: number, end: number, skip: boolean, binding: string | null }[]}
 */
function analyzeReadCalls(source) {
  const kind = source.includes('</') || source.includes('/>') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sf = ts.createSourceFile('codemod-input.ts', source, ts.ScriptTarget.Latest, true, kind)
  /** @type {{ start: number, end: number, skip: boolean, binding: string | null }[]} */
  const decisions = []

  function visit(node) {
    if (isReadCharacteristicCall(node)) {
      const nameNode = getCalleeNameNode(node)
      if (nameNode) {
        const binding = getAssignedBindingName(node)
        let skip = false
        if (binding) {
          const scope = getEnclosingScope(node)
          skip = bindingUsesValueAsStringLike(scope, binding)
        }
        // Unassigned: leave alone only if whole remaining file is Base64-shaped
        // (rare bare fire-and-forget reads are treated as safe to rename).
        decisions.push({
          start: nameNode.getStart(sf),
          end: nameNode.getEnd(),
          skip,
          binding
        })
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sf)
  return decisions
}

/**
 * Transform source with a structured report.
 *
 * Safe mode (default) refuses to rename **per call site** when that call’s
 * binding uses `.value` in a Base64-shaped way; inserts a review marker instead.
 *
 * @param {string} source
 * @param {{ aggressive?: boolean }} [options]
 * @returns {{ out: string, report: { rewritten: number, skipped: number, marked: number, lines: string[] } }}
 */
function transformSourceWithReport(source, options = {}) {
  const aggressive = Boolean(options.aggressive)
  const report = { rewritten: 0, skipped: 0, marked: 0, lines: [] }

  const decisions = analyzeReadCalls(source)
  if (decisions.length === 0) {
    return { out: source, report }
  }

  // Apply replacements from end → start so offsets stay valid
  let out = source
  const sorted = decisions.slice().sort((a, b) => b.start - a.start)
  let anyAmbiguous = false

  for (const d of sorted) {
    if (d.skip && !aggressive) {
      report.skipped += 1
      anyAmbiguous = true
      continue
    }
    out = out.slice(0, d.start) + REPLACEMENT_NAME + out.slice(d.end)
    report.rewritten += 1
    if (d.skip) anyAmbiguous = true
  }

  if (report.skipped > 0) {
    report.lines.push(
      `skip: ${report.skipped} readCharacteristicForDevice call(s) left unchanged (ambiguous .value consumer at call site)`
    )
  }
  if (report.rewritten > 0) {
    report.lines.push(`rewrite: ${report.rewritten} readCharacteristicForDevice → AsBytes`)
  }

  if (anyAmbiguous && !out.includes(REVIEW_MARKER)) {
    const markerLine = aggressive
      ? `${REVIEW_MARKER} — aggressive rename applied; .value is now Uint8Array|null on AsBytes results, not Base64.\n`
      : `${REVIEW_MARKER} — readCharacteristicForDevice result uses .value (Base64 on classic API); ` +
        `do not auto-rename to AsBytes without adapting consumers (ROADMAP §6.2). ` +
        `Re-run with --aggressive only if you will migrate .value to Uint8Array.\n`
    out = markerLine + out
    report.marked = 1
  }

  return { out, report }
}

/**
 * Pure string transform (safe mode by default).
 * @param {string} source
 * @param {{ aggressive?: boolean }} [options]
 */
function transformSource(source, options = {}) {
  return transformSourceWithReport(source, options).out
}

function formatReport(report, fileLabel) {
  const parts = [
    `codemod report (${fileLabel}):`,
    `  rewritten=${report.rewritten} skipped=${report.skipped} marked=${report.marked}`
  ]
  for (const line of report.lines) {
    parts.push(`  - ${line}`)
  }
  return parts.join('\n')
}

function main(argv) {
  const check = argv.includes('--check')
  const dryRun = argv.includes('--dry-run')
  const write = argv.includes('--write')
  const aggressive = argv.includes('--aggressive')
  const file = argv.find(a => !a.startsWith('-') && a !== process.argv[1])
  if (!file) {
    console.error(
      'Usage: transform-bytes-path.js [--check|--dry-run|--write] [--aggressive] <file.js>\n' +
        'EXPERIMENTAL monorepo-only: not required for 4.0; not published on npm.\n' +
        'See MIGRATION_4.0.md § Optional bytes codemod.'
    )
    process.exit(2)
  }
  const abs = path.resolve(file)
  const src = fs.readFileSync(abs, 'utf8')
  const { out, report } = transformSourceWithReport(src, { aggressive })
  const label = path.relative(process.cwd(), abs)

  if (check) {
    // Fixture / CI: expect either a rewrite or an explicit review marker on ambiguous sites
    const hasAsBytes = out.includes('AsBytes')
    const hasMarker = out.includes(REVIEW_MARKER)
    if (!hasAsBytes && !hasMarker && !/AsBytes/.test(src)) {
      console.error('codemod --check: no bytes-path transforms or review markers applied')
      process.exit(1)
    }
    console.log(formatReport(report, label))
    console.log('codemod --check OK:', label)
    return
  }

  if (dryRun) {
    console.log(formatReport(report, label))
    if (out !== src) {
      console.log('--- would write ---')
      process.stdout.write(out)
      if (!out.endsWith('\n')) process.stdout.write('\n')
    } else {
      console.log('(no file changes)')
    }
    return
  }

  if (write) {
    if (out !== src) {
      fs.writeFileSync(abs, out, 'utf8')
      console.log(formatReport(report, label))
      console.log('wrote:', label)
    } else {
      console.log(formatReport(report, label))
      console.log('(no file changes):', label)
    }
    return
  }

  process.stdout.write(out)
}

if (require.main === module) {
  main(process.argv.slice(2))
}

module.exports = {
  REVIEW_MARKER,
  transformSource,
  transformSourceWithReport,
  analyzeReadCalls,
  usesValueAsStringLike,
  REPLACEMENTS: [
    {
      from: /readCharacteristicForDevice\s*\(/g,
      to: 'readCharacteristicForDeviceAsBytes(',
      note: 'Only applied per call site when safe or --aggressive'
    }
  ]
}
