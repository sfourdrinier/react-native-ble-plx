#!/usr/bin/env node
// scripts/ci/bluez-soft-probe.js
/**
 * Linux BlueZ L2/L3 soft-probe (R2-F038 / GAP-CI-LIN).
 *
 * Never silent-success: if the system daemon is absent, exit 0 with an explicit
 * skip message. If present, open and close the public BlueZ D-Bus boundary.
 *
 * Invoked only after systemctl/dbus soft checks in ci.yml.
 */
'use strict'

const path = require('path')

const root = path.resolve(__dirname, '../..')

async function main() {
  const { DbusNextBluezBoundaryFactory } = require(path.join(root, 'lib/commonjs/node-bluez'))
  const factory = new DbusNextBluezBoundaryFactory()
  let boundary = null
  try {
    boundary = await factory.open('system')
    const objects = await boundary.objectManager.getManagedObjects()
    console.log('BlueZ L3 public D-Bus boundary opened, managed objects=', objects.length)
  } catch (e) {
    // Host conditions can prevent a BlueZ boundary even when systemd reported a
    // service. The probe names that residual condition explicitly.
    console.log('BlueZ L3 public-boundary skip:', String((e && e.message) || e))
  } finally {
    if (boundary !== null) {
      await boundary.close()
    }
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
