// __tests__/Docs4.0.honesty.test.js

// __tests__/Docs4.0.honesty.test.js

/**
 * Guards the clean-baseline 4.0 documentation decision.
 * Transitional source facts are allowed only when the document labels them as
 * characterization; these tests deliberately make no claim about production code.
 */
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/\r\n/g, '\n')

const architectureAuthorityDocuments = [
  'README.md',
  'ROADMAP.4.0.md',
  'MIGRATION_4.0.md',
  'RELEASE.md',
  'docs/GAPS.4.0.md',
  'docs/GETTING_STARTED.md',
  'docs/PLATFORMS.md',
  'docs/ELECTRON.md',
  'docs/NODE.md',
  'docs/EXPO_PLUGIN.md',
  'docs/BACKGROUND.md',
  'docs/WEB.md',
  'docs/TVOS.md',
  'docs/PERFORMANCE.md',
]

const transitionalCharacterizationDocuments = [
  'docs/BONDING.md',
  'docs/CONNECTION_MANAGER.md',
  'docs/DISCOVERY_AND_PROFILES.md',
  'docs/HELPERS.md',
  'example-web/README.md'
]

const deterministicExampleDocuments = ['example-electron/README.md']

const supersededAuthorityDocuments = [
  'ROADMAP.md',
  'docs/FIX_TRACKER.4.0.md',
  'docs/FIX_TRACKER.4.0-round2.md',
  'docs/FIX_TRACKER.4.0-round3.md',
]

const canonicalAdrDocuments = [
  'docs/ADR/2026-07-4.0-public-api.md',
  'docs/ADR/2026-07-4.0-backend-contract.md',
  'docs/ADR/2026-07-4.0-capability-registry.md',
  'docs/ADR/2026-07-4.0-boundary.md',
  'docs/ADR/2026-07-4.0-rn-restoration-bootstrap.md',
  'docs/ADR/2026-07-4.0-packaging.md',
  'docs/ADR/2026-07-4.0-open-source-governance.md',
]

const deletedTransitionalAdrs = [
  'docs/ADR/2026-07-4.0-host-and-bytes.md',
  'docs/ADR/2026-07-4.0-electron-macos-corebluetooth.md',
  'docs/ADR/2026-07-4.0-owned-core-and-electron-natives.md',
]

describe('4.0 documentation honesty', () => {
  test('controlling implementation plan records the clean-baseline decisions', () => {
    const plan = read('docs/UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md')

    expect(plan).toContain('new open-source package with no production users')
    expect(plan).toContain('one versioned backend contract')
    expect(plan).toContain('one shared manager/policy core')
    expect(plan).toContain('All payloads are `Uint8Array`')
    expect(plan).toContain('AbortSignal')
    expect(plan).toContain('No static host capability matrix')
    expect(plan).toContain('No duplicated Base64 and byte method families')
    expect(plan).toContain('does not wrap Noble')
    expect(plan).toContain('Meta Quest is deferred to 4.1')
    expect(plan).toContain('It is not a 4.0 work package, evidence requirement, or release blocker')
    expect(plan).toContain('explicitly deferred to 4.1')
  })

  test('plan keeps Quest out of the 4.0 execution graph and Android acceptance checklist', () => {
    const plan = read('docs/UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md')
    const graphStart = plan.indexOf('### 24.1 Hard dependency graph')
    const graphEnd = plan.indexOf('### 24.2 Recommended integration order', graphStart)
    const graph = plan.slice(graphStart, graphEnd)

    expect(graphStart).toBeGreaterThanOrEqual(0)
    expect(graphEnd).toBeGreaterThan(graphStart)
    expect(graph).not.toMatch(/\bQUEST\b/)
    expect(graph.match(/\bQuest\b/g)).toHaveLength(1)
    expect(graph).toContain('deferred 4.1 Quest work depends on frozen shared surfaces')
    expect(plan).not.toContain('and Quest build/runtime proof where claimed.')
  })

  test('plan and canonical ADRs retain normative capability, ownership, event, and transport contracts', () => {
    const plan = read('docs/UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md')
    const publicApi = read('docs/ADR/2026-07-4.0-public-api.md')
    const backendContract = read('docs/ADR/2026-07-4.0-backend-contract.md')

    expect(plan).toContain("'supported' | 'limited' | 'unsupported' | 'unavailable'")
    expect(plan).toContain('selectedSchemaRange')
    expect(plan).toContain('implementationOrigin')
    expect(plan).toContain('CapabilityEvidence')
    expect(plan).toContain('CapabilityTckBinding')
    expect(plan).toContain('Unsupported operations are registered as `unsupported`')
    expect(plan).toContain('highest common version')
    expect(plan).toContain('complete selected `NegotiatedVersionTuple` becomes immutable attachment data')
    expect(plan).toContain('Malformed offers, duplicate handshakes')
    expect(plan).toContain('BoundedAsyncStream<BackendEvent>')
    expect(plan).toContain('Every observation field is `present`, `absent`, or `unavailable`')
    expect(plan).toContain('advertisementPayload')
    expect(plan).toContain('scanResponsePayload')
    expect(plan).toContain('owner lease, connection generation, database')
    expect(plan).toContain('C++ JSI-owned binary payload transport')
    expect(plan).toContain('Codegen/TurboModule control and bootstrap methods carry metadata only')
    expect(plan).toContain('prove that none carries BLE bytes')
    expect(plan).not.toMatch(/\bscanAlreadyActive\b/)
    expect(plan).not.toMatch(/\bmanagerDestroyed\b/)
    expect(plan).not.toContain('TurboModule-supported `ArrayBuffer`/typed binary values')
    expect(plan).not.toContain('TurboModule binary round-trip')
    expect(plan).not.toContain('Unsupported operations are absent capabilities')

    expect(publicApi).toContain('only when no registered borrowers')
    expect(publicApi).toContain('settled revocation')
    expect(publicApi).toContain('atomic, verified ownership')
    expect(backendContract).toContain('BoundedAsyncStream<BackendEvent>')
    expect(backendContract).toContain('owner lease')
  })

  test.each(architectureAuthorityDocuments)('%s identifies the controlling architecture authority', (relativePath) => {
    const document = read(relativePath)

    expect(document.split('\n')[0]).toBe(`<!-- ${relativePath} -->`)
    expect(document).toContain('UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md')
  })

  test.each(transitionalCharacterizationDocuments)('%s labels inherited behavior as transitional characterization', (relativePath) => {
    const document = read(relativePath)

    expect(document.split('\n')[0]).toBe(`<!-- ${relativePath} -->`)
    expect(document).toMatch(/transitional source characterization|transitional source behavior|legacy manager/i)
    expect(document).toContain('UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md')
  })

  test.each(deterministicExampleDocuments)('%s makes only deterministic package-surface claims', (relativePath) => {
    const document = read(relativePath)

    expect(document.split('\n')[0]).toBe(`<!-- ${relativePath} -->`)
    expect(document).toMatch(/without\s+claiming live Electron-radio support/)
    expect(document).toContain('not a substitute for device-lab validation')
    expect(document).not.toMatch(/legacy manager|transitional source/i)
  })

  test.each(supersededAuthorityDocuments)('%s cannot compete with the clean-baseline authority', (relativePath) => {
    const document = read(relativePath)

    expect(document.split('\n')[0]).toBe(`<!-- ${relativePath} -->`)
    expect(document).toMatch(/historical|superseded|authority boundary/i)
    expect(document).toContain('UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md')
  })

  test('the seven canonical ADRs replace every transitional ADR path', () => {
    const adrDirectory = path.join(root, 'docs/ADR')
    const actual = fs.readdirSync(adrDirectory).sort()
    const expected = canonicalAdrDocuments.map((relativePath) => path.basename(relativePath)).sort()

    expect(actual).toEqual(expected)
    deletedTransitionalAdrs.forEach((relativePath) => {
      expect(fs.existsSync(path.join(root, relativePath))).toBe(false)
    })
  })

  test.each(canonicalAdrDocuments)('%s is an accepted canonical decision record', (relativePath) => {
    const document = read(relativePath)

    expect(document.split('\n')[0]).toBe(`<!-- ${relativePath} -->`)
    expect(document).toContain('**Status:** Accepted design baseline')
    expect(document).toContain('## Decision')
    expect(document).toContain('## Consequences and gates')
    expect(document).toContain('## Rejected alternatives')
  })

  test('canonical ADRs record the accepted binary, restoration, and scope decisions', () => {
    const boundary = read('docs/ADR/2026-07-4.0-boundary.md')
    const restoration = read('docs/ADR/2026-07-4.0-rn-restoration-bootstrap.md')
    const governance = read('docs/ADR/2026-07-4.0-open-source-governance.md')

    expect(boundary).toMatch(/one\s+owned, versioned C\+\+ JSI binary transport/)
    expect(boundary).toMatch(/never use Base64, a parallel bridge, a compatibility\s+fallback/)
    expect(boundary).toContain('Electron main is the only production radio owner')
    expect(restoration).toContain('exactly one `CBCentralManager`')
    expect(restoration).toContain('It never creates a second central')
    expect(governance).toContain('Meta Quest is explicitly deferred to 4.1')
    expect(governance).toContain('absent from 4.0 work packages')
  })

  test('roadmap rejects compatibility, dual APIs, static matrices, Noble, and reduced scope', () => {
    const roadmap = read('ROADMAP.4.0.md')

    expect(roadmap).toContain('not a compatibility release')
    expect(roadmap).toContain('bytes-only public and backend BLE contracts')
    expect(roadmap).toContain('does not preserve a permanent 3.x API')
    expect(roadmap).toContain('Meta Quest, peripheral mode, Bluetooth Classic, LE Audio, L2CAP CoC')
    expect(roadmap).toContain('retains an evidence-bound `Live Preview` target but is not a 4.0 gate')
    expect(roadmap).toContain('are deferred to 4.1')
    expect(roadmap).not.toMatch(/hard compatibility guarantee/i)
    expect(roadmap).not.toMatch(/Base64 still available unless 5\.0/i)
    expect(roadmap).not.toMatch(/thin install\/import shim/i)
  })

  test('migration documents the current v4 package without inventing a compatibility path', () => {
    const migration = read('MIGRATION_4.0.md')
    const release = read('RELEASE.md')

    expect(migration).toContain('current public 4.0 package line')
    expect(migration).toContain('unified-ble-manager@4.0.0-alpha.14')
    expect(migration).toContain('stable `hostSessionScope`')
    expect(migration).toContain('`Uint8Array`')
    expect(migration).toContain('`AbortSignal`')
    expect(migration).toContain('`await manager.destroy()`')
    expect(migration).toContain('not a source-compatible rename')
    expect(migration).toContain('Base64 only as an explicit codec helper')
    expect(migration).not.toMatch(/zero-change (JS )?API/i)
    expect(migration).not.toMatch(/optional bytes codemod/i)
    expect(migration).not.toContain('no released 4.0 API instructions yet')

    expect(release).toContain('does not define a 4.0 API')
    expect(release).toContain('does not authorize publishing 4.0')
    expect(release).toContain('no permanent scoped shim')
    expect(release).not.toMatch(/publishes the \*\*4\.0 dual identity\*\*/i)
  })

  test('public README provides only current alpha.14 construction and plugin guidance', () => {
    const readme = read('README.md')
    const changelog = read('CHANGELOG.md')

    expect(readme).toContain('unified-ble-manager@4.0.0-alpha.14')
    expect(readme).toContain('pnpm add unified-ble-manager@4.0.0-alpha.14')
    expect(readme).toContain('createReactNativeBleManager')
    expect(readme).toContain('stable `hostSessionScope`')
    expect(readme).toContain('`Uint8Array`')
    expect(readme).toContain('`AbortSignal`')
    expect(readme).toContain('iosNativeProtocolRestoration')
    expect(readme).not.toMatch(
      /iosEnableRestoration|iosRestorationIdentifier|iosNativeProtocolRestorationIdentifier|androidEnableForegroundService/
    )
    expect(readme).not.toMatch(/new\s+BleManager\s*\(/)
    expect(readme).not.toMatch(/npm install/)
    expect(changelog).toContain('## [4.0.0-alpha.14] - 2026-07-30')
    expect(changelog).toContain('node-addon-api')
    expect(changelog).toContain('hostSessionScope')
  })

  test('platform pages make instantiated backend evidence, not static source behavior, authoritative', () => {
    const platforms = read('docs/PLATFORMS.md')
    const gaps = read('docs/GAPS.4.0.md')

    expect(platforms).toContain('not a static 4.0 capability matrix')
    expect(platforms).toContain('typed capabilities of its instantiated backend')
    expect(gaps).toContain('not architecture authority')
    expect(gaps).toContain('current-state characterization and migration input')
    expect(gaps).toContain('must never be presented as live-radio proof')
  })

  test('profile discovery documentation names only supported hyphenated package exports', () => {
    const discovery = read('docs/DISCOVERY_AND_PROFILES.md')
    const commands = read('docs/PROFILES_AND_COMMANDS.md')
    const supportedProfileSubpaths = [
      'unified-ble-manager/profiles/heart-rate',
      'unified-ble-manager/profiles/battery-service',
      'unified-ble-manager/profiles/device-information',
      'unified-ble-manager/profiles/health-thermometer',
      'unified-ble-manager/profiles/blood-pressure'
    ]

    for (const subpath of supportedProfileSubpaths) {
      expect(discovery).toContain(subpath)
      expect(commands).toContain(subpath)
    }
    expect(discovery).not.toMatch(
      /profiles\/(heartRate|battery(?!-service)|deviceInformation|healthThermometer|bloodPressure)/
    )
  })
})
