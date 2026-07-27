// __tests__/backends/winrt/winrt-native-boundary-source.test.js

const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '../../..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('WinRT native boundary source contract', () => {
  test('waits for an actual GATT confirmation and makes queued connection work cancellable', () => {
    const addon = read('native/electron/winrt/src/addon.cpp')
    const boundary = read('native/electron/winrt/src/winrt-boundary.inc')

    expect(addon).toContain('cancellation_requested')
    expect(addon).toContain('ThrowIfCurrentOperationWasCancelled')
    expect(boundary).toContain('GetGattServicesAsync(winrt::Windows::Devices::Bluetooth::BluetoothCacheMode::Uncached)')
    expect(boundary).toContain('RequireSuccess(confirmation.Status(), "WinRT connection confirmation")')
    expect(boundary).toContain('device.ConnectionStatus() != BluetoothConnectionStatus::Connected')
  })

  test('bounds overload, counts every native ingress drop, and keeps payload cleanup owned', () => {
    const addon = read('native/electron/winrt/src/addon.cpp')
    const boundary = read('native/electron/winrt/src/winrt-boundary.inc')

    expect(addon).toContain('kNotificationIngressQueueCapacity = 128U')
    expect(addon).toContain('kAdvertisementIngressQueueCapacity = 256U')
    expect(addon).toContain('notification_queue_drops')
    expect(addon).toContain('advertisement_queue_drops')
    expect(addon).toContain('notification_close_drops')
    expect(addon).toContain('advertisement_close_drops')
    expect(addon).toContain('std::unique_ptr<NotificationPayload> owned(value)')
    expect(addon).toContain('std::unique_ptr<AdvertisementPayload> owned(value)')
    expect(boundary).toContain('kNotificationIngressQueueCapacity, 1')
    expect(boundary).toContain('kAdvertisementIngressQueueCapacity, 1')
    expect(boundary).toContain('InstanceMethod("ingressTelemetry"')
  })
})
