#!/usr/bin/env node
// bin/ubm.js

'use strict'

const { formatUnifiedBleCliResult, runUnifiedBleCli } = require('../lib/commonjs/cli.js')

async function main() {
  const result = await runUnifiedBleCli(process.argv.slice(2))
  process.stdout.write(formatUnifiedBleCliResult(result))
  process.exitCode = result.ok ? 0 : 1
}

main().catch(error => {
  const message = error instanceof Error ? error.message : 'CLI failed with a non-Error value'
  process.stderr.write(`${JSON.stringify({ ok: false, command: null, data: null, failures: [{ code: 'cli.execution-failed', message }] })}\n`)
  process.exitCode = 1
})
