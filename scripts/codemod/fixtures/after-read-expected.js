// ble-plx-4: review — readCharacteristicForDevice result uses .value (Base64 on classic API); do not auto-rename to AsBytes without adapting consumers (ROADMAP §6.2). Re-run with --aggressive only if you will migrate .value to Uint8Array.
// Fixture: 3.x Base64 read pattern (optional codemod target)
async function sample(manager, deviceId) {
  const c = await manager.readCharacteristicForDevice(
    deviceId,
    '0000180d-0000-1000-8000-00805f9b34fb',
    '00002a37-0000-1000-8000-00805f9b34fb'
  )
  return c.value
}

module.exports = { sample }
