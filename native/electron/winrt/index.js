/**
 * Windows WinRT native entry placeholder.
 * CI on windows-latest can replace this with a real Node-API binary.
 * createPort() throws until the native addon is linked — hosts use FakeBlePort fallback.
 */
function createPort() {
  throw new Error('unified-ble-winrt native addon not built; use FakeBlePort fallback in Electron host')
}

module.exports = { createPort, radioId: 'winrt-ble-v1' }
