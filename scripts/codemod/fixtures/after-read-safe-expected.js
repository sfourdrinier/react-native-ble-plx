// Fixture: only reads uuid — safe mechanical AsBytes rename target
async function sample(manager, deviceId) {
  const c = await manager.readCharacteristicForDeviceAsBytes(
    deviceId,
    '0000180d-0000-1000-8000-00805f9b34fb',
    '00002a37-0000-1000-8000-00805f9b34fb'
  )
  return c.uuid
}

module.exports = { sample }
