// native/electron/winrt/index.js

'use strict'

const path = require('path')

const addonPath = path.join(__dirname, 'build', 'Release', 'unified_ble_winrt.node')
const nativeModule = require(addonPath)
const boundaryVersion = 2
const requiredBoundaryMethods = [
  'listAdapters',
  'selectAdapter',
  'adapterSnapshot',
  'startScan',
  'stopScan',
  'connect',
  'disconnect',
  'discover',
  'read',
  'write',
  'readDescriptor',
  'writeDescriptor',
  'startNotify',
  'stopNotify',
  'onConnectionLost',
  'onDatabaseChanged',
  'onAdapterState',
  'onScanTerminal',
  'ingressTelemetry',
  'destroy'
]

if (nativeModule.boundaryVersion !== boundaryVersion || typeof nativeModule.createContractBoundary !== 'function') {
  throw new Error('The WinRT Node-API artifact does not implement strict native boundary protocol v2')
}

function createContractBoundary() {
  const boundary = nativeModule.createContractBoundary()
  if (boundary === null || typeof boundary !== 'object') {
    throw new Error('The WinRT native boundary factory did not return an object')
  }
  for (const method of requiredBoundaryMethods) {
    if (typeof boundary[method] !== 'function') {
      throw new Error(`The WinRT native boundary protocol v2 is missing required method ${method}`)
    }
  }
  return boundary
}

module.exports = Object.freeze({
  boundaryVersion,
  createContractBoundary
})
