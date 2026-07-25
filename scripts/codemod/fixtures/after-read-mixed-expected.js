// ble-plx-4: review — readCharacteristicForDevice result uses .value (Base64 on classic API); do not auto-rename to AsBytes without adapting consumers (ROADMAP §6.2). Re-run with --aggressive only if you will migrate .value to Uint8Array.
// Fixture: mixed file — one Base64 consumer + one uuid-only read (call-site selective)
async function readBase64(manager, deviceId) {
  const a = await manager.readCharacteristicForDevice(
    deviceId,
    '0000180d-0000-1000-8000-00805f9b34fb',
    '00002a37-0000-1000-8000-00805f9b34fb'
  )
  return a.value
}

async function readUuid(manager, deviceId) {
  const b = await manager.readCharacteristicForDeviceAsBytes(
    deviceId,
    '0000180d-0000-1000-8000-00805f9b34fb',
    '00002a37-0000-1000-8000-00805f9b34fb'
  )
  return b.uuid
}

module.exports = { readBase64, readUuid }
