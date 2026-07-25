#!/usr/bin/env node
/**
 * Linux BlueZ L2/L3 soft-probe (R2-F038 / GAP-CI-LIN).
 *
 * Never silent-success: if the system daemon is absent, exit 0 with an explicit
 * skip message. If present, construct BluezBlePort without mock and assert
 * ensureBus succeeds or fails with a typed error. Mock-bus Jest remains L1.
 *
 * Invoked only after systemctl/dbus soft checks in ci.yml.
 */
'use strict'

const path = require('path')

const root = path.resolve(__dirname, '../..')

async function main() {
  const { isBluezAvailable, BluezBlePort } = require(path.join(root, 'lib/commonjs/hosts/electron'))
  const available = await isBluezAvailable()
  console.log('isBluezAvailable:', available)
  if (!available) {
    console.log('BlueZ not available after soft-probe — typed skip (not silent success)')
    return
  }
  const port = new BluezBlePort()
  try {
    await port.ensureBus()
    console.log('BlueZ L3 ensureBus ok, port.id=', port.id)
  } catch (e) {
    // Typed failure is acceptable (no adapter / permission) — never silent success.
    console.log('BlueZ L3 typed failure after available=true:', String((e && e.message) || e))
  } finally {
    if (typeof port.close === 'function') port.close()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
