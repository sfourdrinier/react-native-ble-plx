// src/electron-renderer.ts

export * from './electron/protocol'
export { ElectronRendererBleClient } from './electron/renderer'
export type { ElectronConnectionEventCleanupReceipt, ElectronConnectionEventSubscription } from './electron/renderer'
export { assertAdvertisementObservation as assertElectronAdvertisementObservation } from './electron/advertisement-observation'
