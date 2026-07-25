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
