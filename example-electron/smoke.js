/**
 * Headless deterministic public-manager smoke (CI / package job).
 *
 * This consumes only the published 4.0 package entrypoints. The deterministic
 * test boundary provides the Fake radio controls needed to prove the public
 * scan -> connect -> discover -> read -> notify -> destroy journey without
 * claiming a live Electron router/client or live-radio result. The packed
 * consumer smoke owns the authenticated Electron router/client journey.
 *
 * It also verifies that the Electron-main router is published. L3
 * Electron-main ABI coverage lives in scripts/ci/electron-main-smoke.js.
 *
 *   pnpm prepack && node example-electron/smoke.js
 */
'use strict'

const path = require('node:path')

function requirePublishedEntrypoint(specifier) {
  const resolved = require.resolve(specifier)
  const compiledArtifactSegment = `${path.sep}lib${path.sep}`
  if (!resolved.includes(compiledArtifactSegment)) {
    throw new Error(`expected ${specifier} to resolve to a published lib artifact, got ${resolved}`)
  }
  return require(specifier)
}

const { BleManager } = requirePublishedEntrypoint('unified-ble-manager')
const {
  createDeterministicManagerScenarioFactory,
  managerScenarioDefinitions
} = requirePublishedEntrypoint('unified-ble-manager/testing')
const { ElectronMainBleRouter } = requirePublishedEntrypoint('unified-ble-manager/electron/main')

const L1_SCENARIO_ID = 'manager.scan-connect-discover-read-notify-destroy'
const L1_SCENARIO_FACT = 'scan-connect-discover-read-notify-destroy-completes'

function requireFunction(value, name) {
  if (typeof value !== 'function') {
    throw new Error(`published entrypoint did not export ${name}`)
  }
}

function requireL1Scenario() {
  const scenario = managerScenarioDefinitions.find(definition => definition.id === L1_SCENARIO_ID)
  if (scenario === undefined) {
    throw new Error(`published testing entrypoint is missing ${L1_SCENARIO_ID}`)
  }
  return scenario
}

function assertReleased(cleanup, operation) {
  if (cleanup.state !== 'released' || cleanup.failures.length !== 0) {
    throw new Error(`${operation} did not release cleanly: ${JSON.stringify(cleanup)}`)
  }
}

function assertNoResourceLeaks(counters) {
  for (const [resource, count] of Object.entries(counters)) {
    if (Number(count) !== 0) {
      throw new Error(`deterministic L1 flow leaked ${resource}=${count}`)
    }
  }
}

async function main() {
  requireFunction(BleManager, 'BleManager')
  requireFunction(ElectronMainBleRouter, 'ElectronMainBleRouter')
  requireFunction(createDeterministicManagerScenarioFactory, 'createDeterministicManagerScenarioFactory')

  const scenario = requireL1Scenario()
  const factory = createDeterministicManagerScenarioFactory()
  const fixture = await factory.create()

  let cleanup
  try {
    const unsupported = fixture.unsupported(scenario)
    if (unsupported !== null) {
      throw new Error(`deterministic L1 scenario is unsupported: ${unsupported.explanation}`)
    }

    console.log('Deterministic public-manager scenario:', scenario.id)
    const receipt = await fixture.execute(scenario)
    if (receipt.disposition !== 'passed' || !receipt.facts.includes(L1_SCENARIO_FACT)) {
      throw new Error(`deterministic L1 scenario returned an incomplete receipt: ${JSON.stringify(receipt)}`)
    }
    console.log('  scan/connect/discover/read/notify completed')
  } finally {
    cleanup = await fixture.dispose()
  }

  assertReleased(cleanup, 'deterministic L1 fixture destroy')
  assertNoResourceLeaks(fixture.resourceCounters())
  console.log('example-electron public-manager smoke OK (published 4.0 entrypoints, deterministic boundary)')
}

main().catch(error => {
  console.error('[example-electron/smoke] L1 smoke failed:', error)
  process.exitCode = 1
})
