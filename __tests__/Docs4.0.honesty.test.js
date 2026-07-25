/**
 * Documentation honesty guards for the 4.0 docs batch.
 * Keeps ROADMAP / GAPS / PLATFORMS / identity docs aligned with shipped code.
 */
const fs = require('fs')
const path = require('path')
const { supports } = require('../src/supports')

const root = path.join(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n')

describe('4.0 docs honesty (docs batch)', () => {
  test('supports() ships requestDevice (not deviceChooser); ROADMAP matches (F021)', () => {
    expect(supports('requestDevice', 'web')).toBe(true)
    expect(supports('deviceChooser', 'web')).toBe(false)

    const roadmap40 = read('ROADMAP.4.0.md')
    const roadmap = read('ROADMAP.md')
    expect(roadmap40).toContain("supports('requestDevice')")
    expect(roadmap40).not.toContain("supports('deviceChooser')")
    expect(roadmap).toContain("supports('requestDevice')")
    expect(roadmap).not.toContain("supports('deviceChooser')")
  })

  test('ROADMAP links to root MIGRATION_4.0.md (F118)', () => {
    const roadmap40 = read('ROADMAP.4.0.md')
    expect(fs.existsSync(path.join(root, 'MIGRATION_4.0.md'))).toBe(true)
    expect(roadmap40).toMatch(/\]\(\.\/MIGRATION_4\.0\.md\)|`MIGRATION_4\.0\.md`/)
    expect(roadmap40).not.toContain('docs/MIGRATION_4.0.md')
  })

  test('GAPS §2 baseline matches wired RN Phase-2 + macOS BlePort L2 (F023)', () => {
    const gaps = read('docs/GAPS.4.0.md')
    expect(gaps).toMatch(/supports\(\).*true|RN queue\/services\/longWrite.*true/i)
    expect(gaps).not.toMatch(/false\*\* until wired|false until wired/)
    // Baseline must not claim full BlePort still open for macOS
    expect(gaps).toMatch(/macOS.*full BlePort|CoreBluetooth.*L2|done \(L2 software\)/i)
  })

  test('GAPS has a single GAP-E-MAC-PORT catalog row (F064)', () => {
    const gaps = read('docs/GAPS.4.0.md')
    // Count table rows that start with | **GAP-E-MAC-PORT**
    const rows = gaps.match(/^\| \*\*GAP-E-MAC-PORT\*\*/gm) || []
    expect(rows.length).toBe(1)
    expect(gaps).toMatch(/GAP-E-MAC-PORT.*done \(L2 software\)/)
  })

  test('GAPS Electron macOS runbook uses real build:electron:macos (F107)', () => {
    const gaps = read('docs/GAPS.4.0.md')
    expect(gaps).toContain('pnpm run build:electron:macos')
    expect(gaps).not.toMatch(/build:electron:macos\s+# to be added/)
  })

  test('PLATFORMS continuous scan is backend-aware for Electron (F024)', () => {
    const platforms = read('docs/PLATFORMS.md')
    // Must not claim uniform Y via all three backends including WinRT
    expect(platforms).not.toMatch(/Y \(BlueZ \/ WinRT \/ CoreBluetooth backends\)/)
    expect(platforms).toMatch(/CoreBluetooth|BlueZ|WinRT/)
    expect(platforms.toLowerCase()).toMatch(/placeholder|partial|preview|l2/)
  })

  test('PLATFORMS services-changed honesty for port hosts (F065)', () => {
    const platforms = read('docs/PLATFORMS.md')
    // RN remains native-backed Y; port hosts must not claim full radio Services Changed
    expect(platforms).toMatch(/services-changed|servicesChanged|onServicesReset/)
    expect(platforms).toMatch(/partial|listener API|software|test inject|emitServicesReset/i)
  })

  test('EXPO_PLUGIN / GETTING_STARTED / CONNECTION_MANAGER lead with unified-ble-manager (F016, F022)', () => {
    const expo = read('docs/EXPO_PLUGIN.md')
    const getting = read('docs/GETTING_STARTED.md')
    const cm = read('docs/CONNECTION_MANAGER.md')

    expect(expo).toMatch(/unified-ble-manager/)
    expect(expo).toMatch(/plugins":\s*\[\s*"unified-ble-manager"|plugins.*unified-ble-manager/)
    expect(expo).toMatch(/unified-ble-manager\/Restoration|pod 'unified-ble-manager\/Restoration'/)

    expect(getting).toContain("from 'unified-ble-manager'")
    // Ex.1 / Ex.2 primary samples use 4.0 package
    expect(getting).toMatch(/#### Ex\.1[\s\S]*from 'unified-ble-manager'/)
    expect(getting).toMatch(/#### Ex\.2[\s\S]*from 'unified-ble-manager'/)

    expect(cm).toContain("from 'unified-ble-manager'")
  })

  test('FORK.md and TVOS.md lead with Path A unified-ble-manager (R2-F041, R2-F042)', () => {
    const fork = read('docs/FORK.md')
    const tvos = read('docs/TVOS.md')

    expect(fork).toMatch(/Canonical package \(4\.0 Path A\).*unified-ble-manager/s)
    expect(fork).toContain('unified-ble-manager')
    expect(fork).toMatch(/MIGRATION_4\.0\.md/)
    // Must not present scoped name as the sole product identity
    expect(fork).not.toMatch(/^\*\*Package:\*\* `@sfourdrinier\/react-native-ble-plx`\s*$/m)

    expect(tvos).toContain("from 'unified-ble-manager'")
    expect(tvos).not.toMatch(/from '@sfourdrinier\/react-native-ble-plx'/)
  })

  test('BACKGROUND covers FGS matrix and owned restore path (F062, F077)', () => {
    const bg = read('docs/BACKGROUND.md')
    expect(bg).toMatch(/foreground service|FGS|enableBackgroundMode/i)
    expect(bg).toMatch(/com\.sfourdrinier\.unifiedblemanager\.BlePlxForegroundService/)
    expect(bg).toMatch(/OwnedCoreBluetoothAdapter|owned CoreBluetooth|willRestoreState/)
    expect(bg).not.toMatch(/reused `BleClientManager`/)
    expect(bg).toMatch(/unified-ble-manager\/Restoration|pod 'unified-ble-manager\/Restoration'/)
  })

  test('ELECTRON documents per-OS status (F063)', () => {
    const electron = read('docs/ELECTRON.md')
    expect(electron).not.toMatch(/Linux \*\*BlueZ\*\*.*is the implemented desktop-native path today/)
    expect(electron).toMatch(/macOS|CoreBluetooth/)
    expect(electron).toMatch(/BlueZ|Linux/)
    expect(electron).toMatch(/WinRT|Windows/)
  })

  test('RN bytes path interim Base64 bridge is documented (F092 / GAP-GA-PERF)', () => {
    const gaps = read('docs/GAPS.4.0.md')
    const platforms = read('docs/PLATFORMS.md')
    const migration = read('MIGRATION_4.0.md')
    const bleManager = read('src/BleManager.ts')

    expect(gaps).toMatch(/GAP-GA-PERF/)
    expect(gaps).toMatch(/Base64 native bridge|TurboModule ArrayBuffer|F036|F092/)
    expect(platforms).toMatch(/Base64 bridge|TurboModule ArrayBuffer|F036|F092/)
    expect(migration).toMatch(/Interim \(RN host|Base64 native bridge|TurboModule/)
    expect(bleManager).toMatch(/INTERIM \(F036 \/ F092 \/ GAP-GA-PERF\)/)
    expect(bleManager).toMatch(/bytesToBase64 → BleModule\.write\*/)
  })

  test('GETTING_STARTED leads with requestBluetoothPermissions helper (F085)', () => {
    const getting = read('docs/GETTING_STARTED.md')
    expect(getting).toMatch(/requestBluetoothPermissions/)
    expect(getting).toMatch(/neverForLocation/)
    expect(getting).toMatch(/ACCESS_FINE_LOCATION/)
  })

  test('ELECTRON packaging + Fake CI-only honesty (F067)', () => {
    const electron = read('docs/ELECTRON.md')
    expect(electron).toContain('build:electron:macos')
    const gaps = read('docs/GAPS.4.0.md')
    const platforms = read('docs/PLATFORMS.md')

    // Per-OS truth: mac L2 full BlePort; BlueZ partial; WinRT placeholder
    expect(electron).toMatch(/L2 full BlePort|full BlePort/)
    expect(electron).toMatch(/Partial|preview/)
    expect(electron).toMatch(/Placeholder|placeholder/)
    expect(electron).not.toMatch(/full BlePort still open/i)

    // electron-rebuild / @electron/rebuild install notes (not node-gyp alone)
    expect(electron).toMatch(/@electron\/rebuild|electron-rebuild/)
    expect(electron).toMatch(/node-gyp/)
    expect(electron).toMatch(/com\.apple\.security\.device\.bluetooth/)

    // Fake is CI / tests / smoke — not production radio
    expect(electron).toMatch(/CI.*only|tests.*only|headless smoke/i)
    expect(electron).toMatch(/allowMockFallback:\s*false|allowMockFallback: false/)

    // GAPS baseline must not claim mac BlePort still open; PKG docs landed
    expect(gaps).not.toMatch(/full BlePort still open/i)
    expect(gaps).toMatch(/macOS:.*full CoreBluetooth BlePort.*done \(L2 software\)/)
    expect(gaps).toMatch(/GAP-E-MAC-PKG.*done \(L0 docs\)/)

    // PLATFORMS aligns Fake = CI-only + rebuild note
    expect(platforms).toMatch(/CI|unit tests|headless smoke/i)
    expect(platforms).toMatch(/@electron\/rebuild|electron-rebuild/)
  })

  test('Claude/CLAUDE floors match Expo 57 / RN 0.86 / Node 20 (F016)', () => {
    const claude = read('CLAUDE.md')
    expect(claude).toMatch(/Expo 57|expo \^57|Expo SDK 57/)
    expect(claude).toMatch(/0\.86|React Native 0\.86/)
    expect(claude).toMatch(/Node.*20|engines.*20|>= 20|Node \^20/)
    expect(claude).toMatch(/unified-ble-manager/)
    expect(claude).not.toMatch(/Expo 54/)
    expect(claude).not.toMatch(/0\.81\.4/)
    expect(claude).not.toMatch(/Node >= 18\.0\.0/)
  })

  // R2-F006 / R2-F010: README leads with 4.0 identity + bonding honesty
  test('R2-F006/F010 README Path A unified-ble-manager + does not claim createBond unsupported', () => {
    const readme = read('README.md')
    expect(readme).toMatch(/pnpm add unified-ble-manager|npm install unified-ble-manager/)
    expect(readme).toMatch(/plugins":\s*\[\s*"unified-ble-manager"|plugins.*unified-ble-manager/)
    expect(readme).toMatch(/pod 'unified-ble-manager\/Restoration'|unified-ble-manager\/Restoration/)
    expect(readme).toMatch(/from 'unified-ble-manager'/)
    // Manual Android install must lead with Path A (not scoped-only)
    expect(readme).toMatch(/### Android \(Manual Setup\)[\s\S]*?pnpm add unified-ble-manager/)
    // Bonding honesty: Android createBond is supported; must not list createBond as unsupported
    expect(readme).not.toMatch(/does NOT support[\s\S]*createBond/i)
    expect(readme).not.toMatch(/Explicit OS bonding\/pairing APIs \(`createBond`-style control\)/)
    expect(readme).toMatch(/createBond|BONDING\.md|Android bonding/i)
    // Dead 3.x pod path must not remain as the primary recipe
    expect(readme).not.toContain("pod 'react-native-ble-plx/Restoration'")
  })

  // R2-F011: Phase 5 must not claim live CoreBluetooth radio still open
  test('R2-F011 ROADMAP Phase 5 Electron status matches GAPS macOS L2 done', () => {
    const roadmap40 = read('ROADMAP.4.0.md')
    expect(roadmap40).not.toMatch(/live WinRT\/CoreBluetooth radio still open/)
    expect(roadmap40).not.toMatch(/CoreBluetooth radio still open/)
    expect(roadmap40).toMatch(/macOS CoreBluetooth BlePort done \(L2 software\)|CoreBluetooth BlePort \*\*done \(L2 software\)\*\*/)
    const gaps = read('docs/GAPS.4.0.md')
    expect(gaps).toMatch(/GAP-E-MAC-PORT.*done \(L2 software\)/)
  })

  // R2-F013: live scripts split headless CLI vs Electron UI rebuild
  test('R2-F013 example:electron:live is live-polar; ui:live uses @electron/rebuild', () => {
    const pkg = JSON.parse(read('package.json'))
    expect(pkg.scripts['example:electron:live']).toMatch(/live-polar\.js/)
    expect(pkg.scripts['example:electron:live']).not.toMatch(/electron example-electron\/main\.js/)
    expect(pkg.scripts['example:electron:ui:live']).toMatch(/@electron\/rebuild|electron\/rebuild/)
    expect(pkg.scripts['example:electron:ui:live']).toMatch(/ELECTRON_BLE_REQUIRE_NATIVE=1/)
    expect(pkg.scripts['example:electron:ui:live']).toMatch(/electron example-electron\/main\.js/)
    const electronDoc = read('docs/ELECTRON.md')
    expect(electronDoc).toContain('example:electron:ui:live')
    expect(electronDoc).toContain('example:electron:live')
  })

  // R2-F115: WEB.md documents service-less filter fail-closed
  test('R2-F115 WEB.md documents service-less filters require optionalServices', () => {
    const web = read('docs/WEB.md')
    expect(web).toMatch(/service-less|namePrefix|name \/ namePrefix/i)
    expect(web).toMatch(/Fail closed|fail closed/i)
    expect(web).toMatch(/optionalServices/)
  })

  // R2-F049: PERFORMANCE.md is a real deliverable (not a dangling ROADMAP path)
  test('R2-F049 PERFORMANCE.md exists with dual-path honesty + harness', () => {
    expect(fs.existsSync(path.join(root, 'docs/PERFORMANCE.md'))).toBe(true)
    const perf = read('docs/PERFORMANCE.md')
    expect(perf).toMatch(/GAP-GA-PERF|Base64 native bridge|Benchmark\.harness/)
    expect(perf).toMatch(/interim|F092|F036/i)
    const roadmap = read('ROADMAP.4.0.md')
    expect(roadmap).toMatch(/docs\/PERFORMANCE\.md/)
  })

  // R2-F050: Phase 3 Status distinguishes owned default vs GAP-GA-LEGACY
  test('R2-F050 ROADMAP Phase 3 has Status + GAP-GA-LEGACY honesty', () => {
    const roadmap = read('ROADMAP.4.0.md')
    expect(roadmap).toMatch(/### Phase 3[\s\S]*?\| Work \| Status \|/)
    expect(roadmap).toMatch(/GAP-GA-LEGACY/)
    expect(roadmap).toMatch(/Done \(L2 default path\)|default path|L2 default/i)
    expect(roadmap).toMatch(/android\/src\/legacy|ios\/vendor/)
  })

  // R2-F051: BONDING.md OS-honest manager.supports
  test('R2-F051 BONDING.md OS-honest manager.supports bonding on iOS', () => {
    const bonding = read('docs/BONDING.md')
    expect(bonding).toMatch(/manager\.supports\('bonding'\) === false/)
    expect(bonding).toMatch(/OS-honest/i)
    expect(bonding).not.toMatch(/supports\('bonding'\) is `?true`? on the react-native host/)
  })

  // R2-F052: multi-host NODE + Electron recipes + GETTING_STARTED links
  test('R2-F052 NODE.md and multi-host recipes exist', () => {
    expect(fs.existsSync(path.join(root, 'docs/NODE.md'))).toBe(true)
    const node = read('docs/NODE.md')
    expect(node).toMatch(/unified-ble-manager\/node/)
    expect(node).toMatch(/allowMockFallback:\s*false|allowMockFallback: false/)
    expect(node).toMatch(/FakeBlePort|inject/)
    const electron = read('docs/ELECTRON.md')
    expect(electron).toMatch(/GAP-E-LIN-LAB|Linux L4/)
    expect(electron).toMatch(/requireNative:\s*true|requireNative: true/)
    expect(electron).toMatch(/What works today|placeholder/i)
    const getting = read('docs/GETTING_STARTED.md')
    expect(getting).toMatch(/unified-ble-manager\/node|NODE\.md/)
    expect(getting).toMatch(/Multi-host/)
  })

  // R2-F053: GAPS issue index includes RN-BYTES + B3; next work not stale RN-Q/LW only
  test('R2-F053 GAPS indexes GAP-RN-BYTES and GAP-B3; next TS work updated', () => {
    const gaps = read('docs/GAPS.4.0.md')
    expect(gaps).toMatch(/GAP-RN-BYTES/)
    expect(gaps).toMatch(/GAP-B3/)
    expect(gaps).toMatch(/catalog[\s\S]{0,80}GAP-RN-BYTES|GAP-RN-BYTES[\s\S]{0,120}open/)
    expect(gaps).toMatch(/catalog[\s\S]{0,40}GAP-B3|GAP-B3[\s\S]{0,80}open/)
    expect(gaps).toMatch(/GAP-RN-BYTES|native ArrayBuffer|GAP-GA-PERF/)
    expect(gaps).toMatch(/GAP-RN-Q[\s\S]{0,80}done|already \*\*done L1\*\*|are done \(L1/)
  })

  // R2-F054 / R2-F055: requestMTU iOS report-only + servicesChanged contract
  test('R2-F054/F055 PLATFORMS requestMTU report-only + servicesChanged contract', () => {
    const platforms = read('docs/PLATFORMS.md')
    expect(platforms).toMatch(/report-only|cannot negotiate|maximumWriteValueLength/i)
    expect(platforms).toMatch(/request MTU[\s\S]{0,220}Android/)
    expect(platforms).toMatch(/servicesChanged contract|Listener API present only|listener API only/i)
    expect(platforms).toMatch(/supports\('servicesChanged'\)[\s\S]{0,120}false|Web[\s\S]{0,60}false/)
  })

  // R2-F068: BACKGROUND cold-null vs optional Restoration subspec
  test('R2-F068 BACKGROUND restore matrix cold-null vs optional subspec', () => {
    const bg = read('docs/BACKGROUND.md')
    expect(bg).toMatch(/[Cc]old-null|cold launch|Cold launch/)
    expect(bg).toMatch(/Owned default path|owned.*willRestoreState|Owned \+ identifier/i)
    expect(bg).toMatch(/Optional Restoration subspec|optional.*Restoration subspec/i)
    expect(bg).not.toMatch(/Restoration subspec off \+ identifier \| May wait until destroy/)
    expect(bg).toMatch(/Identifier-only is enough|subspec is not required|not required for cold-null/i)
  })

  // R2-F098: CI baseline vs GAP-CI-* residual honesty
  test('R2-F098 GAPS CI baseline vs GAP-CI-* residual honesty', () => {
    const gaps = read('docs/GAPS.4.0.md')
    expect(gaps).toMatch(/GAP-E-MAC-CI/)
    expect(gaps).toMatch(/GAP-CI-WIN|fail-closed/)
    expect(gaps).toMatch(/GAP-CI-LIN|mock only/)
    const macCiRow = gaps.match(/^\| \*\*GAP-E-MAC-CI\*\*[^\n]+/m)
    expect(macCiRow).toBeTruthy()
    expect(macCiRow[0]).toMatch(/partial|open|Residual|residual/)
    expect(gaps).toMatch(/lib\/commonjs\/hosts\/electron|Electron L2|GAP-E-MAC-CI/)
  })
})
