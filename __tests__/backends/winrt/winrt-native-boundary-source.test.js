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
  test('pins the private loader and Windows ABI smoke to protocol v2', () => {
    const loader = read('native/electron/winrt/index.js')
    const nodeLoader = read('src/node-winrt.ts')
    const ci = read('.github/workflows/ci.yml')
    const electronSmoke = read('scripts/ci/electron-main-smoke.js')
    const electronDocs = read('docs/ELECTRON.md')

    expect(loader).toContain('const boundaryVersion = 2')
    expect(loader).toContain("'onScanTerminal'")
    expect(loader).toContain('strict native boundary protocol v2')
    expect(nodeLoader).toContain('readonly boundaryVersion: 2')
    expect(nodeLoader).toContain("'winrt.native-boundary.surface'")
    expect(ci).toContain('WinRT native boundary Node ABI build and load')
    expect(ci).toContain('WinRT native boundary Electron ABI rebuild and load')
    expect(ci).toContain('native.boundaryVersion !== 2')
    expect(electronSmoke).toContain("process.platform === 'win32'")
    expect(electronSmoke).toContain("'onScanTerminal'")
    expect(electronDocs).toContain('native boundary protocol v2')
    expect(electronDocs).toContain('startScan(scanToken, serviceUuids, onAdvertisement)')
    expect(electronDocs).toContain('onScanTerminal(listener)')
  })

  test('adopts an existing Electron COM apartment without hiding unrelated initialization failures', () => {
    const addon = read('native/electron/winrt/src/addon.cpp')
    const ensureApartment = section(addon, 'void EnsureWinRtApartment()', 'std::string ToUtf8')
    const electronSmoke = read('scripts/ci/electron-main-smoke.js')

    expect(ensureApartment).toContain('try')
    expect(ensureApartment).toContain('catch (const winrt::hresult_error& error)')
    expect(ensureApartment).toContain('error.code().value == RPC_E_CHANGED_MODE')
    expect(ensureApartment).toContain('throw;')
    expect(ensureApartment).not.toContain('catch (...)')
    expect(electronSmoke).toContain('const boundary = createNativeWinRtBoundary()')
    expect(electronSmoke).toContain('await cleanup.completion')
    expect(electronSmoke).toContain('Electron main-process L3 WinRT public boundary ok')
  })

  test('enumerates every Windows Bluetooth adapter and binds state events to the selected device id', () => {
    const addon = read('native/electron/winrt/src/addon.cpp')
    const boundary = read('native/electron/winrt/src/winrt-boundary.inc')

    expect(addon).toContain('#include <winrt/Windows.Devices.Enumeration.h>')
    expect(addon).toContain('DeviceInformation::FindAllAsync(BluetoothAdapter::GetDeviceSelector())')
    expect(addon).toContain('BluetoothAdapter::FromIdAsync(ToUtf8(device.Id()))')
    expect(addon).toContain('DeviceAccessInformation::CreateFromId(adapter.DeviceId())')
    expect(addon).toContain('if (authorization != "granted")')
    expect(addon).toContain('std::optional<Radio> radio')
    expect(addon).toContain('std::vector<AdapterView> ReadAdapters()')
    expect(addon).toContain('selected_adapter_id = selected_adapter')
    expect(addon).toContain('adapter = ReadAdapter(selected_adapter_id)')
    expect(boundary).toContain('return ReadAdapters();')
    expect(boundary).toContain('BluetoothAdapter::FromIdAsync(requested)')
    expect(boundary).not.toContain('BluetoothAdapter::GetDefaultAsync()')
    expect(boundary).toContain('ReadAdapter(selected_adapter)')
  })

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

  test('attaches WinRT GATT communication status and HRESULT details to rejected native operations', () => {
    const addon = read('native/electron/winrt/src/addon.cpp')

    expect(addon).toContain('class WinRtNativeStatusError final')
    expect(addon).toContain('GattCommunicationStatusCode')
    expect(addon).toContain('native_error_details_')
    expect(addon).toContain('error_object.Set("winRtCode"')
    expect(addon).toContain('error_object.Set("winRtGattStatus"')
    expect(addon).toContain('error_object.Set("winRtHresult"')
    expect(addon).toContain("std::setfill('0') << std::setw(8)")
  })

  test('clears worker operation state on every terminal exception path', () => {
    const addon = read('native/electron/winrt/src/addon.cpp')
    const execute = section(addon, 'void Execute() override', 'void OnOK() override')

    expect(addon).toContain('class CurrentOperationStatusScope final')
    expect(addon).toContain('current_operation_status.reset();')
    expect(execute).toContain('CurrentOperationStatusScope operation_scope(status_)')
    expect(execute).toContain('status_->terminal.store(true)')
    expect(execute).toContain('catch (const winrt::hresult_error& error)')
    expect(execute).toContain('catch (const std::exception& error)')
    expect(execute).toContain('catch (...)')
    expect(execute).toContain('SetError("WinRT native operation failed with a non-standard exception")')
    expect(execute).not.toContain('current_operation_status.reset();')
  })

  test('isolates every non-control native-to-JavaScript callback exception', () => {
    const addon = read('native/electron/winrt/src/addon.cpp')
    const callbackSections = [
      ['class NotificationListener', 'struct AdvertisementPayload', 'notification callback'],
      ['class AdvertisementListener', 'struct ConnectionEventPayload', 'advertisement callback'],
      ['class ConnectionLossListener', 'class AdapterListener', 'connection-loss callback'],
      ['class DatabaseListener', 'class AdapterListener', 'database-changed callback']
    ]

    for (const [start, end, delegate] of callbackSections) {
      const callback = section(addon, start, end)
      expect(callback).toContain('callback.Call({')
      expect(callback).toContain('catch (const std::exception& error)')
      expect(callback).toContain('catch (...)')
      expect(callback).toContain(`ReportWinRtDelegateFailure("${delegate}", error)`)
      expect(callback).toContain(`ReportWinRtDelegateFailure("${delegate}")`)
    }
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
    const removeConnection = section(boundary, 'bool BoundaryState::RemoveConnection', 'void BoundaryState::Destroy')

    expect(startScan).toContain('ThrowIfCurrentOperationWasCancelled();')
    expect(startScan).toContain('CleanupScanEntry(entry, failures, true)')
    expect(startScan).toContain('ThrowWinRtCleanupFailures("WinRT scan start rollback", failures)')
    expect(startNotify).toContain('listener->Release();')
    expect(startNotify).toContain('found->second != connection')
    expect(startNotify).toContain('state->notifications.emplace(key, *provisional)')
    expect(startNotify).toContain('The provisional map entry remains the retryable native owner')
    expect(startNotify).toContain('ThrowWinRtCleanupFailures("WinRT notification start rollback", cleanup_failures)')
    expect(removeConnection).toContain('connections.erase(found);')
    expect(removeConnection).toContain('notifications_for_peer.push_back(notification.second)')
    expect(removeConnection).toContain('connection->removal_claimed = false')
    expect(removeConnection).toContain('ThrowWinRtCleanupFailures("WinRT connection teardown", failures)')
    expect(boundary).toContain('ContinueWinRtTeardown')
    expect(boundary).toContain('WinRT destroy encountered teardown failures')
    expect(addon).toContain('function_.BlockingCall(payload')
    expect(addon).toContain('ReportControlIngressFailure("connection-loss", status)')
    expect(addon).toContain('ReportControlIngressFailure("database-changed", status)')
    expect(addon).toContain('ReportControlIngressFailure("adapter-state", status)')
  })

  test('emits exact connection generations with separate loss and database payload shapes', () => {
    const addon = read('native/electron/winrt/src/addon.cpp')
    const loss = section(addon, 'class ConnectionLossListener', 'class AdapterListener')
    const database = section(addon, 'class DatabaseListener', 'class AdapterListener')

    expect(addon).toContain('struct ConnectionEventPayload')
    expect(loss).toContain('event.Set("nativePeerId"')
    expect(loss).toContain('event.Set("connectionGeneration"')
    expect(loss).toContain('event.Set("safeReason"')
    expect(database).toContain('event.Set("nativePeerId"')
    expect(database).toContain('event.Set("connectionGeneration"')
    expect(database).not.toContain('event.Set("safeReason"')
    expect(loss).toContain('function_.BlockingCall(payload')
    expect(database).toContain('function_.BlockingCall(payload')
  })

  test('publishes boundary v2 scan terminals with a closed BluetoothError mapping', () => {
    const addon = read('native/electron/winrt/src/addon.cpp')
    const boundary = read('native/electron/winrt/src/winrt-boundary.inc')

    expect(boundary).toContain('exports.Set("boundaryVersion", Napi::Number::New(env, 2))')
    expect(boundary).toContain('InstanceMethod("onScanTerminal"')
    expect(boundary).toContain('info.Length() != 3')
    expect(boundary).toContain('const std::string scan_token')
    expect(boundary).toContain('WinRT scan stop requires the active scanToken')
    expect(boundary).toContain('WinRT scan stop requires a non-empty active scanToken')
    expect(boundary).toContain('state->StopScan(scan_token)')
    expect(addon).toContain('class ScanTerminalListener final')
    expect(addon).toContain('enum class ScanTerminalError')
    expect(addon).toContain('case BluetoothError::Success:')
    expect(addon).toContain('case BluetoothError::RadioNotAvailable:')
    expect(addon).toContain('case BluetoothError::ResourceInUse:')
    expect(addon).toContain('case BluetoothError::DeviceNotConnected:')
    expect(addon).toContain('case BluetoothError::OtherError:')
    expect(addon).toContain('case BluetoothError::DisabledByPolicy:')
    expect(addon).toContain('case BluetoothError::NotSupported:')
    expect(addon).toContain('case BluetoothError::DisabledByUser:')
    expect(addon).toContain('case BluetoothError::ConsentRequired:')
    expect(addon).toContain('case BluetoothError::TransportNotSupported:')
    expect(boundary).toContain('kControlIngressQueueCapacity, 1')
  })

  test('correlates watcher Stopped events and suppresses locally requested stops after closing ingress', () => {
    const addon = read('native/electron/winrt/src/addon.cpp')
    const boundary = read('native/electron/winrt/src/winrt-boundary.inc')

    expect(addon).toContain('std::atomic_bool ingress_open{true}')
    expect(addon).toContain('std::atomic_bool local_stop_requested{false}')
    expect(addon).toContain('std::atomic_bool terminal_emitted{false}')
    expect(addon).toContain('void EmitScanTerminal')
    expect(boundary).toContain('const std::string scan_token')
    expect(boundary).toContain('watcher.Stopped(')
    expect(boundary).toContain('event.Error()')
    expect(boundary).toContain('local_stop_requested.load()')
    expect(boundary).toContain('ingress_open.store(false)')
    expect(boundary).toContain('terminal_emitted.exchange(true)')
    expect(boundary).toContain('scan_token')
  })

  test('registers GATT service-change invalidation and revokes the exact native event token', () => {
    const addon = read('native/electron/winrt/src/addon.cpp')
    const boundary = read('native/electron/winrt/src/winrt-boundary.inc')

    expect(addon).toContain('winrt::event_token services_changed_token{}')
    expect(addon).toContain('void ClearGattServices')
    expect(addon).toContain('GattServicesChanged')
    expect(boundary).toContain('services_changed_token')
    expect(boundary).toContain('connection->device.GattServicesChanged(connection->services_changed_token)')
    expect(addon).toContain('connection.services.clear()')
    expect(boundary).toContain('EmitDatabaseChanged(peer, connection->connection_generation)')
  })

  test('gives adapter state precedence over a correlated scan terminal and bounds terminal ingress', () => {
    const addon = read('native/electron/winrt/src/addon.cpp')
    const boundary = read('native/electron/winrt/src/winrt-boundary.inc')
    const terminal = section(addon, 'class ScanTerminalListener', 'struct DescriptorEntry')
    const stopped = section(boundary, 'void BoundaryState::HandleScanStopped', 'void BoundaryState::StopScan')

    expect(stopped).toContain('EmitAdapterState(true)')
    expect(stopped).toContain('EmitScanTerminal')
    expect(stopped.indexOf('EmitAdapterState(true)')).toBeLessThan(stopped.indexOf('EmitScanTerminal'))
    expect(terminal).toContain('function_.BlockingCall(payload')
    expect(terminal).not.toContain('function_.NonBlockingCall(payload')
    expect(terminal).toContain('ReportControlIngressFailure("scan-terminal", delivery_status)')
    expect(addon).toContain('class ControlDeliveryAck final')
    expect(addon).toContain('completion->Signal()')
    expect(addon).toContain('completion->Wait()')
  })

  test('publishes only strict terminal records after the refreshed adapter remains scan-ready', () => {
    const addon = read('native/electron/winrt/src/addon.cpp')
    const boundary = read('native/electron/winrt/src/winrt-boundary.inc')
    const terminal = section(addon, 'class ScanTerminalListener', 'struct DescriptorEntry')
    const stopped = section(boundary, 'void BoundaryState::HandleScanStopped', 'void BoundaryState::StopScan')

    expect(addon).toContain('bool IsAdapterReadyForScanTerminal')
    expect(stopped).toContain('const AdapterView adapter = EmitAdapterState(true)')
    expect(stopped).toContain('if (!IsAdapterReadyForScanTerminal(adapter)) return;')
    expect(stopped.indexOf('EmitAdapterState(true)')).toBeLessThan(stopped.indexOf('EmitScanTerminal'))
    expect(stopped.indexOf('IsAdapterReadyForScanTerminal(adapter)')).toBeLessThan(stopped.indexOf('EmitScanTerminal'))
    expect(terminal).toContain('terminal.Set("scanToken"')
    expect(terminal).toContain('terminal.Set("status"')
    expect(terminal).toContain('terminal.Set("error"')
    expect(terminal).not.toContain('terminal.Set("safeReason"')
    expect(terminal).not.toContain('terminal.Set("generation"')
  })

  test('correlates every queued advertisement with the exact scan token and generation', () => {
    const addon = read('native/electron/winrt/src/addon.cpp')
    const boundary = read('native/electron/winrt/src/winrt-boundary.inc')
    const advertisement = section(addon, 'struct AdvertisementPayload', 'struct ConnectionEventPayload')
    const startScan = section(boundary, 'Napi::Value StartScan', 'Napi::Value StopScan')

    expect(advertisement).toContain('std::string scan_token')
    expect(advertisement).toContain('uint64_t generation')
    expect(advertisement).toContain('advertisement.Set("scanToken"')
    expect(advertisement).toContain('advertisement.Set("generation"')
    expect(startScan).toContain('entry->generation = state->next_scan_generation++')
    expect(startScan).toContain('entry->listener->Emit(entry->scan_token, entry->generation')
  })

  test('guards stale connection callbacks and contains every native delegate exception', () => {
    const addon = read('native/electron/winrt/src/addon.cpp')
    const boundary = read('native/electron/winrt/src/winrt-boundary.inc')
    const connect = section(boundary, 'Napi::Value Connect', 'Napi::Value Disconnect')
    const startScan = section(boundary, 'Napi::Value StartScan', 'Napi::Value StopScan')

    expect(addon).toContain('std::string connection_generation')
    expect(addon).not.toContain('next_connection_generation')
    expect(addon).toContain('services_revision')
    expect(connect).toContain('info.Length() != 2')
    expect(connect).toContain('connection_generation')
    expect(connect).toContain('ReserveConnectingConnection(peer, connection_generation)')
    expect(connect.indexOf('ReserveConnectingConnection(peer, connection_generation)')).toBeLessThan(
      connect.indexOf('BluetoothLEDevice::FromBluetoothAddressAsync(address)')
    )
    expect(connect).toContain('PromoteConnectingConnection(peer, connection)')
    expect(connect).toContain('RetainConnectionForCleanup(peer, connection)')
    expect(boundary).toContain('found->second != expected')
    expect(connect).toContain('std::weak_ptr<ConnectionEntry> weak_connection')
    expect(connect).toContain('RemoveConnection(peer, live_connection)')
    expect(connect).toContain('HandleGattServicesChanged(peer, live_connection)')
    expect(connect).toContain('ReportWinRtDelegateFailure("GattServicesChanged"')
    expect(connect).toContain('ReportWinRtDelegateFailure("connection status"')
    expect(connect).toContain('ReportWinRtDelegateFailure("session status"')
    expect(startScan).toContain('ReportWinRtDelegateFailure("watcher Stopped"')
    expect(startScan).toContain('ReportWinRtDelegateFailure("watcher Received"')
  })

  test('reserves the exact connecting owner through rollback, Disconnect, and Destroy', () => {
    const addon = read('native/electron/winrt/src/addon.cpp')
    const boundary = read('native/electron/winrt/src/winrt-boundary.inc')
    const ownership = read('native/electron/winrt/src/WinRtConnectionOwnership.hpp')
    const nativeHarness = read('native/electron/winrt/tests/WinRtConnectionOwnershipHarness.cpp')
    const packageJson = read('package.json')

    expect(addon).toContain('connecting_connections')
    expect(addon).toContain('bool setup_in_progress{true}')
    expect(addon).toContain('bool disconnect_requested{false}')
    expect(boundary).toContain('connection->disconnect_requested = true')
    expect(boundary).toContain('connection->setup_finished.wait')
    expect(boundary).toContain('ReleaseRetainedConnectionAfterCleanup')
    expect(ownership).toContain('static bool reserve(')
    expect(ownership).toContain('static bool retainForCleanup(')
    expect(ownership).toContain('static bool release(')
    expect(nativeHarness).toContain('second concurrent Connect was admitted')
    expect(nativeHarness).toContain('rollback changed or lost the first owner')
    expect(nativeHarness).toContain('Disconnect retry did not release the first owner')
    expect(packageJson).toContain('test:native-protocol:winrt')
  })

  test('rejects listener registration during teardown and releases every created listener on failure', () => {
    const boundary = read('native/electron/winrt/src/winrt-boundary.inc')
    const nativeHarness = read('native/electron/winrt/tests/WinRtConnectionOwnershipHarness.cpp')
    const addListener = section(
      boundary,
      'template <typename Listener>\n  Napi::Value AddListener',
      '  std::shared_ptr<BoundaryState> state_;'
    )

    expect(addListener).toContain('state->destroying || state->destroyed')
    expect(addListener).toContain('Napi::ThreadSafeFunction function')
    expect(addListener).toContain('function.Release();')
    expect(addListener).toContain('listener->Release();')
    expect(addListener).toContain('WinRT listener creation')
    expect(addListener).toContain('WinRT listener removal function creation')
    expect(addListener).toContain('listeners.push_back(listener)')
    expect(nativeHarness).toContain('listener registration crossed the destroying guard')
    expect(nativeHarness).toContain('listener registration crossed the destroyed guard')
    expect(nativeHarness).toContain('teardown/register race retained a listener')
    expect(nativeHarness).toContain('creation failure did not release its owner')
  })

  test('makes scan cleanup and Destroy retryable without discarding ownership early', () => {
    const addon = read('native/electron/winrt/src/addon.cpp')
    const boundary = read('native/electron/winrt/src/winrt-boundary.inc')
    const destroy = section(boundary, 'void BoundaryState::Destroy', 'class WinRtContractBoundary')
    const cleanup = section(boundary, 'bool CleanupScanEntry', 'bool CleanupNotificationEntry')

    expect(addon).toContain('std::mutex startup_mutex')
    expect(addon).toContain('std::mutex cleanup_mutex')
    expect(addon).toContain('bool cleanup_complete{false}')
    expect(addon).not.toContain('cleanup_started.exchange(true)')
    expect(cleanup).toContain('received_handler_registered')
    expect(cleanup).toContain('stopped_handler_registered')
    expect(cleanup).toContain('watcher_stopped')
    expect(cleanup).toContain('listener_released')
    expect(boundary).toContain('const bool cleanup_complete = CleanupScanEntry(entry, failures, true)')
    expect(destroy).toContain('destroying = true')
    expect(destroy).toContain('destroying = false')
    expect(destroy).toContain('destroyed = true')
    expect(destroy.indexOf('destroyed = true')).toBeGreaterThan(destroy.indexOf('if (!failures.empty())'))
    expect(destroy.indexOf('connections.clear()')).toBeGreaterThan(destroy.indexOf('if (!failures.empty())'))
  })

  test('increments the GATT services revision and publishes discovery only for the same entry and revision', () => {
    const addon = read('native/electron/winrt/src/addon.cpp')
    const boundary = read('native/electron/winrt/src/winrt-boundary.inc')
    const discovery = section(boundary, 'Napi::Value Discover', 'Napi::Value Read')
    const servicesChanged = section(
      boundary,
      'void BoundaryState::HandleGattServicesChanged',
      'void BoundaryState::HandleScanStopped'
    )

    expect(addon).toContain('connection.services_revision.fetch_add(1U)')
    expect(servicesChanged).toContain('ClearGattServices(*connection)')
    expect(discovery).toContain('discovery_revision = connection->services_revision.load()')
    expect(discovery).toContain('std::unique_lock<std::mutex> gatt_guard(connection->gatt_mutex)')
    expect(discovery).toContain('from the initial revision through cache publication')
    expect(discovery).toContain('found->second != connection')
    expect(discovery).toContain('connection->services_revision.load() != discovery_revision')
    expect(discovery).toContain('stale services revision')
  })

  test('uses one deadlock-safe per-connection GATT serialization for CCCD cleanup, direct stop, and discovery', () => {
    const boundary = read('native/electron/winrt/src/winrt-boundary.inc')
    const cleanupNotification = section(boundary, 'bool CleanupNotificationEntry', 'bool CleanupConnectionEntry')
    const startNotify = section(boundary, 'Napi::Value StartNotify', 'Napi::Value StopNotify')
    const stopNotify = section(boundary, 'Napi::Value StopNotify', 'Napi::Value OnConnectionLost')

    expect(cleanupNotification).toContain('std::lock_guard<std::mutex> gatt_guard(entry.connection->gatt_mutex)')
    expect(cleanupNotification).toContain('std::lock_guard<std::mutex> lifecycle_guard(entry.lifecycle->mutex)')
    expect(cleanupNotification.indexOf('gatt_guard')).toBeLessThan(cleanupNotification.indexOf('lifecycle_guard'))
    expect(startNotify).toContain('Lock order is connection GATT followed by notification lifecycle')
    expect(stopNotify).toContain('CleanupNotificationEntry(*notification, cleanup_failures, true)')
    expect(boundary).toContain('BoundaryState::mutex is used only to snapshot/erase entries')
  })

  test('uses one exact cleanup path for connect registration rollback', () => {
    const addon = read('native/electron/winrt/src/addon.cpp')
    const boundary = read('native/electron/winrt/src/winrt-boundary.inc')
    const connect = section(boundary, 'Napi::Value Connect', 'Napi::Value Disconnect')
    const removeConnection = section(boundary, 'bool BoundaryState::RemoveConnection', 'void BoundaryState::Destroy')
    const destroy = section(boundary, 'void BoundaryState::Destroy', 'class WinRtContractBoundary')

    expect(connect).toContain('connection->connection_handler_registered = true')
    expect(connect).toContain('connection->session_handler_registered = true')
    expect(connect).toContain('connection->services_changed_handler_registered = true')
    expect(connect).toContain('CleanupConnectionEntry(connection, cleanup_failures)')
    expect(connect).toContain('state->RetainConnectionForCleanup(peer, connection)')
    expect(addon).toContain('cleanup_pending_connections')
    expect(addon).toContain('bool cleanup_pending{false}')
    expect(removeConnection).toContain('cleanup_pending_connections.find(peer)')
    expect(removeConnection).toContain('cleanup_pending_connections.erase(found)')
    expect(destroy).toContain('cleanup_pending_connections')
    expect(connect).not.toContain('device.ConnectionStatusChanged(connection_token)')
    expect(connect).not.toContain('session.SessionStatusChanged(session_token)')
    expect(connect).not.toContain('device.GattServicesChanged(services_changed_token)')
  })

  test('keeps connection-loss and database-change records strict and semantically distinct', () => {
    const boundary = read('src/backends/winrt/winrt-boundary.ts')
    const loss = section(
      boundary,
      'export function validateWinRtConnectionLossRecord',
      'export function validateWinRtDatabaseChangedRecord'
    )
    const database = boundary.slice(boundary.indexOf('export function validateWinRtDatabaseChangedRecord'))

    expect(boundary).toMatch(/\[\s*'nativePeerId',\s*'connectionGeneration',\s*'safeReason'\s*\]/)
    expect(boundary).toMatch(/\[\s*'nativePeerId',\s*'connectionGeneration'\s*\]/)
    expect(loss).toContain("requiredWinRtConnectionEventField(record, 'connection-loss', 'safeReason')")
    expect(database).not.toContain('safeReason')
  })
})
