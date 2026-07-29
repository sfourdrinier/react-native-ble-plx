// __tests__/backends/winrt/winrt-native-boundary-source.test.js

const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '../../..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function section(source, start, end) {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex)

  expect(startIndex).toBeGreaterThanOrEqual(0)
  expect(endIndex).toBeGreaterThan(startIndex)

  return source.slice(startIndex, endIndex)
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

  test('does not invent packaged-manifest or descriptor access support', () => {
    const addon = read('native/electron/winrt/src/addon.cpp')

    expect(addon).not.toContain('IsPackagedProcess() ? "present"')
    expect(addon).not.toContain('descriptor.Set("readable", Napi::Boolean::New(env, true))')
    expect(addon).not.toContain('descriptor.Set("writable", Napi::Boolean::New(env, true))')
  })

  test('uses complete current C++/WinRT APIs without default-constructing projected GATT values', () => {
    const addon = read('native/electron/winrt/src/addon.cpp')
    const boundary = read('native/electron/winrt/src/winrt-boundary.inc')

    expect(addon).toContain('#include <appmodel.h>')
    expect(addon).toContain('#include <winrt/Windows.Foundation.Collections.h>')
    expect(addon).toContain('winrt::to_string(winrt::to_hstring(value))')
    expect(addon).not.toContain('std::string text = winrt::to_string(value)')
    expect(addon).toContain('GetProcAddress')
    expect(addon).toContain('channel_.has_value()')
    expect(addon).toContain('*channel_ == IngressChannel::notification')
    expect(addon).not.toContain('!channel.has_value()')
    expect(boundary).toContain('const auto native_services = services_result.Services()')
    expect(boundary).toContain('const auto native_characteristics = characteristics_result.Characteristics()')
    expect(boundary).toContain('const auto native_descriptors = descriptors_result.Descriptors()')
    expect(boundary).toContain('GattCharacteristic characteristic{nullptr}')
    expect(boundary).toContain('std::optional<NotificationEntry> notification')
    expect(boundary).not.toContain('GattCharacteristic characteristic;')
    expect(boundary).not.toContain('NotificationEntry notification;')
  })

  test('keeps WinRT lifecycle control delivery and teardown lossless under failure races', () => {
    const addon = read('native/electron/winrt/src/addon.cpp')
    const boundary = read('native/electron/winrt/src/winrt-boundary.inc')
    const startScan = section(boundary, 'Napi::Value StartScan', 'Napi::Value StopScan')
    const startNotify = section(boundary, 'Napi::Value StartNotify', 'Napi::Value StopNotify')
    const removeConnection = section(addon, 'void RemoveConnection', 'void StopScan')

    expect(startScan).toContain('ThrowIfCurrentOperationWasCancelled();')
    expect(startScan).toContain('listener->Release();')
    expect(startNotify).toContain('listener->Release();')
    expect(startNotify).toContain('!state->connections.contains(address.peer)')
    expect(removeConnection).toContain('connections.erase(found);')
    expect(removeConnection).toContain('std::move(notification->second)')
    expect(boundary).toContain('ContinueWinRtTeardown')
    expect(boundary).toContain('WinRT destroy encountered teardown failures')
    expect(addon).toContain('function_.BlockingCall(payload')
    expect(addon).toContain('ReportControlIngressFailure("connection-loss", status)')
    expect(addon).toContain('ReportControlIngressFailure("database-changed", status)')
    expect(addon).toContain('ReportControlIngressFailure("adapter-state", status)')
  })
})
