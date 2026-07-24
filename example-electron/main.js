/**
 * Electron main-process smoke for unified-ble-manager/electron.
 * Uses mock fallback (no radio) so it runs on Linux CI without BlueZ.
 *
 *   node example-electron/main.js
 *   # or: electron example-electron/main.js  (when electron is installed)
 */

// Prefer built package when present; fall back to babel-register source for dev.
let ElectronHost
try {
  ElectronHost = require('../lib/commonjs/hosts/electron')
} catch {
  require('@babel/register')({
    extensions: ['.ts', '.js'],
    presets: ['module:@react-native/babel-preset', '@babel/preset-typescript'],
    ignore: [/node_modules/]
  })
  ElectronHost = require('../src/hosts/electron.ts')
}

const { BleManager, FakeBlePort } = ElectronHost

async function main() {
  const port = new FakeBlePort({
    id: 'example-electron-fake',
    advertisements: [{ id: 'demo', name: 'Demo', rssi: -40 }],
    services: {
      demo: {
        '0000180f-0000-1000-8000-00805f9b34fb': {
          '00002a19-0000-1000-8000-00805f9b34fb': {
            value: new Uint8Array([100]),
            properties: { read: true, write: true, notify: true }
          }
        }
      }
    }
  })

  const manager = new BleManager({ port, backend: 'mock' })
  const info = manager.getHostInfo()
  console.log('hostInfo', info)
  if (!info.isMainProcessOriented) {
    throw new Error('expected main-process-oriented host')
  }

  await manager.connectToDevice('demo')
  const bytes = await manager.readCharacteristicForDeviceAsBytes(
    'demo',
    '0000180f-0000-1000-8000-00805f9b34fb',
    '00002a19-0000-1000-8000-00805f9b34fb'
  )
  console.log('read bytes', Array.from(bytes.value))
  console.log('supports(central)', manager.supports('central'))
  console.log('supports(androidForegroundService)', manager.supports('androidForegroundService'))
  console.log('example-electron smoke OK')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
