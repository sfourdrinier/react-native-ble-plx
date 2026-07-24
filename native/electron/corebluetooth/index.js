/**
 * macOS CoreBluetooth native entry placeholder for Electron main.
 * CI on macos-latest can replace this with a real Node-API binary.
 */
function createPort() {
  throw new Error(
    'unified-ble-corebluetooth native addon not built; use FakeBlePort fallback in Electron host'
  )
}

module.exports = { createPort, radioId: 'corebluetooth-electron-v1' }
