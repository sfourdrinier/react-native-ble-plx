// native/electron/winrt/index.js

'use strict'

const path = require('path')

const addonPath = path.join(__dirname, 'build', 'Release', 'unified_ble_winrt.node')
const nativeModule = require(addonPath)

if (nativeModule.nativeProtocolVersion !== 1 || typeof nativeModule.createContractBoundary !== 'function') {
  throw new Error('The WinRT Node-API artifact does not implement strict native boundary protocol v1')
}

module.exports = Object.freeze({
  nativeProtocolVersion: nativeModule.nativeProtocolVersion,
  createContractBoundary: nativeModule.createContractBoundary
})
