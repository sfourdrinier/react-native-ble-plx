/**
 * Preload — contextBridge only. No BLE here (main process owns radio).
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('bleApi', {
  getState: () => ipcRenderer.invoke('ble:getState'),
  setHeartRateOnly: enabled => ipcRenderer.invoke('ble:setHeartRateOnly', enabled),
  getHeartRateOnly: () => ipcRenderer.invoke('ble:getHeartRateOnly'),
  discover: opts => ipcRenderer.invoke('ble:discover', opts || {}),
  stopScan: () => ipcRenderer.invoke('ble:stopScan'),
  listDevices: opts => ipcRenderer.invoke('ble:listDevices', opts || {}),
  listPairedDevices: () => ipcRenderer.invoke('ble:listPairedDevices'),
  pairDevice: deviceId => ipcRenderer.invoke('ble:pairDevice', deviceId),
  unpairDevice: deviceId => ipcRenderer.invoke('ble:unpairDevice', deviceId),
  connect: deviceId => ipcRenderer.invoke('ble:connect', deviceId),
  inspect: deviceId => ipcRenderer.invoke('ble:inspect', deviceId),
  startHr: deviceId => ipcRenderer.invoke('ble:startHr', deviceId),
  stopHr: () => ipcRenderer.invoke('ble:stopHr'),
  disconnect: deviceId => ipcRenderer.invoke('ble:disconnect', deviceId),
  onDevice: handler => {
    const fn = (_e, entry) => handler(entry)
    ipcRenderer.on('ble:device', fn)
    return () => ipcRenderer.removeListener('ble:device', fn)
  },
  onHr: handler => {
    const fn = (_e, sample) => handler(sample)
    ipcRenderer.on('ble:hr', fn)
    return () => ipcRenderer.removeListener('ble:hr', fn)
  },
  onLog: handler => {
    const fn = (_e, payload) => handler(payload)
    ipcRenderer.on('ble:log', fn)
    return () => ipcRenderer.removeListener('ble:log', fn)
  }
})
