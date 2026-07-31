#!/usr/bin/env node
// scripts/ci/electron-packed-boundary-fixture.js
/**
 * Clean-consumer Electron host-boundary fixture.
 *
 * This is intentionally a Node-hosted L1 package-boundary fixture, not an
 * Electron ABI, live-radio, or contextIsolation check. The consumer process
 * loads the documented main and renderer entrypoints from the packed package.
 * Its separate data-only VM preload-surface membrane models a narrow boundary;
 * it does not execute Electron or prove Electron context isolation.
 */
'use strict'

const assert = require('node:assert/strict')
const { createRequire } = require('node:module')
const path = require('node:path')
const vm = require('node:vm')

const consumer = process.argv[2]

if (typeof consumer !== 'string' || consumer.length === 0) {
  throw new Error('Usage: node scripts/ci/electron-packed-boundary-fixture.js <clean-consumer-directory>')
}

const consumerRequire = createRequire(path.join(path.resolve(consumer), 'package.json'))

function requirePackedEntrypoint(specifier) {
  const resolved = consumerRequire.resolve(specifier)
  assert.ok(
    resolved.includes(`${path.sep}lib${path.sep}`),
    `${specifier} must resolve to a compiled packed artifact, got ${resolved}`
  )
  return consumerRequire(specifier)
}

function assertNotExported(specifier) {
  assert.throws(
    () => consumerRequire(specifier),
    error => error !== null && typeof error === 'object' && error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED',
    `${specifier} must remain unavailable from a packaged consumer`
  )
}

function createBootstrapResponse() {
  return {
    kind: 'bootstrap',
    bootstrap: {
      attachment: Object.freeze({ attachmentId: 'packed-attachment' }),
      attachmentId: 'packed-attachment',
      versions: Object.freeze({
        backendContract: Object.freeze({ selected: Object.freeze({ value: 1 }) }),
        capabilitySchema: Object.freeze({ selected: Object.freeze({ value: 1 }) }),
        eventSchema: Object.freeze({ selected: Object.freeze({ value: 1 }) }),
        traceFormat: Object.freeze({ selected: Object.freeze({ value: 1 }) }),
        ipcProtocol: Object.freeze({ selected: Object.freeze({ value: 1 }) })
      }),
      renderer: Object.freeze({ clientId: 'packed-renderer', windowScope: 'window', sessionScope: 'session' }),
      rendererLease: Object.freeze({ leaseId: 'packed-lease', generation: 'packed-generation' })
    }
  }
}

function createReleaseResponse() {
  return { kind: 'release', cleanup: { state: 'released', failures: [] } }
}

function assertDataOnlyPreloadSurfaceMembrane() {
  const serializedInput = JSON.stringify({
    bootstrapResponse: createBootstrapResponse(),
    releaseResponse: createReleaseResponse()
  })
  const sandbox = vm.createContext(Object.create(null), {
    codeGeneration: { strings: false, wasm: false }
  })
  const serializedProof = vm.runInContext(
    `(() => {
      'use strict'
      const input = JSON.parse(${JSON.stringify(serializedInput)})
      const requests = []

      class ContextRealmRendererProxy {
        constructor(transport) {
          this.transport = transport
          this.initialized = false
          this.destroyed = false
        }

        initialize() {
          if (this.destroyed) throw new Error('renderer proxy has already been destroyed')
          if (!this.initialized) {
            requests.push('bootstrap')
            this.initialized = true
          }
          return this.transport.bootstrapResponse.bootstrap
        }

        destroy() {
          if (!this.destroyed) {
            requests.push('release')
            this.destroyed = true
          }
          return this.transport.releaseResponse.cleanup
        }
      }

      function constructorEscapeIsBlocked(escape) {
        try {
          escape()
          return false
        } catch (error) {
          return error !== null && typeof error === 'object' && error.name === 'EvalError'
        }
      }

      const client = new ContextRealmRendererProxy(input)
      const bootstrap = client.initialize()
      const cleanup = client.destroy()
      return JSON.stringify({
        requestKinds: requests,
        ipcProtocolVersion: bootstrap.versions.ipcProtocol.selected.value,
        cleanupState: cleanup.state,
        processType: typeof process,
        requireType: typeof require,
        objectConstructorEscapeBlocked: constructorEscapeIsBlocked(() =>
          Object.constructor.constructor('return process')()
        ),
        functionConstructorEscapeBlocked: constructorEscapeIsBlocked(() =>
          Object.getPrototypeOf(() => undefined).constructor('return require')()
        )
      })
    })()`,
    sandbox,
    { timeout: 1000 }
  )
  const proof = JSON.parse(serializedProof)
  assert.deepEqual(proof.requestKinds, ['bootstrap', 'release'], 'data-only renderer proxy limits requests to bootstrap and release')
  assert.equal(proof.ipcProtocolVersion, 1, 'data-only renderer proxy preserves the versioned IPC handshake')
  assert.equal(proof.cleanupState, 'released', 'data-only renderer proxy preserves release cleanup')
  assert.equal(proof.processType, 'undefined', 'data-only VM membrane does not expose process')
  assert.equal(proof.requireType, 'undefined', 'data-only VM membrane does not expose require')
  assert.equal(proof.objectConstructorEscapeBlocked, true, 'data-only VM membrane blocks Object constructor process escapes')
  assert.equal(
    proof.functionConstructorEscapeBlocked,
    true,
    'data-only VM membrane blocks function constructor require escapes'
  )
}

async function main() {
  const electronMain = requirePackedEntrypoint('unified-ble-manager/electron/main')
  const electronRenderer = requirePackedEntrypoint('unified-ble-manager/electron/renderer')

  for (const [name, value] of Object.entries({
    ElectronMainBleBinding: electronMain.ElectronMainBleBinding,
    ElectronMainBleRouter: electronMain.ElectronMainBleRouter,
    createElectronMainCoreBluetoothBackendProvider: electronMain.createElectronMainCoreBluetoothBackendProvider,
    createNativeCoreBluetoothBoundary: electronMain.createNativeCoreBluetoothBoundary
  })) {
    assert.equal(typeof value, 'function', `Electron main public surface must export ${name}`)
  }
  assert.equal(typeof electronRenderer.ElectronRendererBleClient, 'function', 'renderer public proxy exports its client')
  for (const forbiddenExport of [
    'ElectronMainBleBinding',
    'ElectronMainBleRouter',
    'createElectronMainCoreBluetoothBackendProvider',
    'createNativeCoreBluetoothBoundary'
  ]) {
    assert.equal(
      Object.hasOwn(electronRenderer, forbiddenExport),
      false,
      `renderer public proxy must not expose main or native ownership through ${forbiddenExport}`
    )
  }

  for (const privateSpecifier of [
    'unified-ble-manager/electron/main-binding',
    'unified-ble-manager/electron/main-router',
    'unified-ble-manager/backends/corebluetooth/corebluetooth-provider',
    'unified-ble-manager/native/electron/corebluetooth'
  ]) {
    assertNotExported(privateSpecifier)
  }

  const requests = []
  const rendererTransport = {
    invoke: async request => {
      requests.push(request)
      if (request.kind === 'bootstrap') {
        return createBootstrapResponse()
      }
      if (request.kind === 'release') {
        return createReleaseResponse()
      }
      throw new Error(`unexpected renderer proxy request: ${request.kind}`)
    },
    subscribe: () => () => undefined,
    acknowledge: async () => undefined
  }
  const client = new electronRenderer.ElectronRendererBleClient(rendererTransport)
  const bootstrap = await client.initialize()
  assert.equal(bootstrap.versions.ipcProtocol.selected.value, 1, 'renderer receives the versioned IPC handshake')
  assert.deepEqual(requests.map(request => request.kind), ['bootstrap'], 'renderer proxy makes only its bootstrap IPC request')
  await client.destroy()
  assert.deepEqual(
    requests.map(request => request.kind),
    ['bootstrap', 'release'],
    'renderer proxy releases through its versioned IPC transport'
  )
  assertDataOnlyPreloadSurfaceMembrane()
  console.log('pack+install Electron L1 entrypoint and data-only preload-surface membrane fixture ok')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
