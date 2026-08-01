// native/electron/winrt/src/winrt-boundary.inc

template <typename Cleanup>
bool ContinueWinRtTeardown(std::vector<std::string>& failures, const char* operation, Cleanup&& cleanup) {
  try {
    std::forward<Cleanup>(cleanup)();
    return true;
  } catch (const winrt::hresult_error& error) {
    const std::string detail = ToUtf8(error.message());
    std::fprintf(stderr, "[unified_ble_winrt] Destroy %s failed: %s\n", operation, detail.c_str());
    failures.push_back(std::string(operation) + ": " + detail);
  } catch (const std::exception& error) {
    std::fprintf(stderr, "[unified_ble_winrt] Destroy %s failed: %s\n", operation, error.what());
    failures.push_back(std::string(operation) + ": " + error.what());
  } catch (...) {
    std::fprintf(stderr, "[unified_ble_winrt] Destroy %s failed with a non-standard error\n", operation);
    failures.push_back(std::string(operation) + ": non-standard error");
    return false;
  }
  return false;
}

[[noreturn]] void ThrowWinRtCleanupFailures(const char* operation, const std::vector<std::string>& failures) {
  std::ostringstream message;
  message << operation << " retained retryable cleanup ownership";
  for (const std::string& failure : failures) {
    message << "; " << failure;
  }
  throw std::runtime_error(message.str());
}

bool CleanupScanEntry(const std::shared_ptr<ScanEntry>& entry, std::vector<std::string>& failures, bool stop_watcher) {
  if (entry == nullptr) return true;
  if (stop_watcher) entry->lifecycle->stop_requested.store(true);
  std::lock_guard<std::mutex> startup_guard(entry->lifecycle->startup_mutex);
  std::lock_guard<std::mutex> cleanup_guard(entry->lifecycle->cleanup_mutex);
  entry->lifecycle->ingress_open.store(false);
  bool complete = true;
  if (entry->lifecycle->received_handler_registered) {
    if (ContinueWinRtTeardown(failures, "scan advertisement event deregistration", [&] {
          entry->watcher.Received(entry->received_token);
        })) {
      entry->lifecycle->received_handler_registered = false;
    } else {
      complete = false;
    }
  }
  if (entry->lifecycle->stopped_handler_registered) {
    if (ContinueWinRtTeardown(failures, "scan stopped event deregistration", [&] {
          entry->watcher.Stopped(entry->stopped_token);
        })) {
      entry->lifecycle->stopped_handler_registered = false;
    } else {
      complete = false;
    }
  }
  if (!entry->lifecycle->watcher_stopped) {
    if (!entry->lifecycle->stop_requested.load()) {
      entry->lifecycle->watcher_stopped = true;
    } else if (ContinueWinRtTeardown(failures, "scan stop", [&] { entry->watcher.Stop(); })) {
      entry->lifecycle->watcher_stopped = true;
    } else {
      complete = false;
    }
  }
  if (!entry->lifecycle->listener_released) {
    if (ContinueWinRtTeardown(failures, "scan listener release", [&] { entry->listener->Release(); })) {
      entry->lifecycle->listener_released = true;
    } else {
      complete = false;
    }
  }
  complete = complete && !entry->lifecycle->received_handler_registered &&
      !entry->lifecycle->stopped_handler_registered && entry->lifecycle->watcher_stopped &&
      entry->lifecycle->listener_released;
  entry->lifecycle->cleanup_complete = complete;
  return complete;
}

bool CleanupNotificationEntry(NotificationEntry& entry, std::vector<std::string>& failures, bool disable_cccd) {
  if (entry.connection == nullptr || entry.lifecycle == nullptr) {
    failures.push_back("notification cleanup ownership is incomplete");
    return false;
  }
  // GATT serialization is always acquired before a notification lifecycle lock.
  // BoundaryState::mutex is used only to snapshot/erase entries and is never held
  // while this helper waits on GATT, so disconnect, destroy, read/write, and CCCD
  // cleanup cannot form a state->GATT inversion.
  std::lock_guard<std::mutex> gatt_guard(entry.connection->gatt_mutex);
  std::lock_guard<std::mutex> lifecycle_guard(entry.lifecycle->mutex);
  bool complete = true;
  if (disable_cccd && entry.lifecycle->cccd_enabled) {
    if (ContinueWinRtTeardown(failures, "notification CCCD disable", [&] {
          RequireSuccess(
              AwaitWinRt(entry.characteristic.WriteClientCharacteristicConfigurationDescriptorAsync(
                  GattClientCharacteristicConfigurationDescriptorValue::None)),
              "Gatt CCCD disable");
        })) {
      entry.lifecycle->cccd_enabled = false;
    } else {
      complete = false;
    }
  }
  if (entry.lifecycle->value_handler_registered) {
    if (ContinueWinRtTeardown(failures, "notification event deregistration", [&] { entry.characteristic.ValueChanged(entry.lifecycle->value_token); })) {
      entry.lifecycle->value_handler_registered = false;
    } else {
      complete = false;
    }
  }
  if (!entry.lifecycle->listener_released) {
    if (ContinueWinRtTeardown(failures, "notification listener release", [&] { entry.listener->Release(); })) {
      entry.lifecycle->listener_released = true;
    } else {
      complete = false;
    }
  }
  return complete && (!disable_cccd || !entry.lifecycle->cccd_enabled) &&
      !entry.lifecycle->value_handler_registered && entry.lifecycle->listener_released;
}

bool CleanupConnectionEntry(const std::shared_ptr<ConnectionEntry>& connection, std::vector<std::string>& failures) {
  std::lock_guard<std::mutex> guard(connection->lifecycle_mutex);
  std::lock_guard<std::mutex> gatt_guard(connection->gatt_mutex);
  bool complete = true;
  if (connection->connection_handler_registered) {
    if (ContinueWinRtTeardown(failures, "connection event deregistration", [&] {
          connection->device.ConnectionStatusChanged(connection->connection_token);
        })) {
      connection->connection_handler_registered = false;
    } else {
      complete = false;
    }
  }
  if (connection->session_handler_registered) {
    if (ContinueWinRtTeardown(failures, "session event deregistration", [&] {
          connection->session.SessionStatusChanged(connection->session_token);
        })) {
      connection->session_handler_registered = false;
    } else {
      complete = false;
    }
  }
  if (connection->services_changed_handler_registered) {
    if (ContinueWinRtTeardown(failures, "services-changed event deregistration", [&] {
          connection->device.GattServicesChanged(connection->services_changed_token);
        })) {
      connection->services_changed_handler_registered = false;
    } else {
      complete = false;
    }
  }
  if (connection->maintenance_enabled) {
    if (ContinueWinRtTeardown(failures, "connection maintenance release", [&] { connection->session.MaintainConnection(false); })) {
      connection->maintenance_enabled = false;
    } else {
      complete = false;
    }
  }
  if (connection->session_open) {
    if (ContinueWinRtTeardown(failures, "session close", [&] { connection->session.Close(); })) {
      connection->session_open = false;
    } else {
      complete = false;
    }
  }
  if (connection->device_open) {
    if (ContinueWinRtTeardown(failures, "device close", [&] { connection->device.Close(); })) {
      connection->device_open = false;
    } else {
      complete = false;
    }
  }
  return complete && !connection->connection_handler_registered && !connection->session_handler_registered &&
      !connection->services_changed_handler_registered && !connection->maintenance_enabled &&
      !connection->session_open && !connection->device_open;
}

void BoundaryState::HandleGattServicesChanged(const std::string& peer, const std::shared_ptr<ConnectionEntry>& expected) {
  std::shared_ptr<ConnectionEntry> connection;
  {
    std::lock_guard<std::mutex> guard(mutex);
    if (destroyed || destroying) return;
    const auto found = connections.find(peer);
    if (found == connections.end() || found->second != expected) return;
    connection = found->second;
  }
  ClearGattServices(*connection);
  {
    std::lock_guard<std::mutex> guard(mutex);
    const auto found = connections.find(peer);
    if (destroyed || destroying || found == connections.end() || found->second != connection) return;
  }
  EmitDatabaseChanged(peer, connection->connection_generation);
}

void BoundaryState::HandleScanStopped(const std::shared_ptr<ScanEntry>& entry, BluetoothError error) {
  bool emit_terminal = false;
  bool locally_requested = false;
  if (entry == nullptr || entry->lifecycle == nullptr) return;
  {
    std::lock_guard<std::mutex> guard(mutex);
    if (destroyed || destroying || scan == nullptr || scan->lifecycle != entry->lifecycle) return;
    if (entry->lifecycle->startup_in_progress.load()) {
      std::lock_guard<std::mutex> cleanup_guard(entry->lifecycle->cleanup_mutex);
      entry->lifecycle->deferred_error = error;
      entry->lifecycle->deferred_stopped.store(true);
      entry->lifecycle->ingress_open.store(false);
      entry->lifecycle->watcher_stopped = true;
      return;
    }
    locally_requested = entry->lifecycle->local_stop_requested.load();
    entry->lifecycle->ingress_open.store(false);
    if (!locally_requested) {
      emit_terminal = !entry->lifecycle->terminal_emitted.exchange(true);
    }
  }

  std::vector<std::string> failures;
  const bool cleanup_complete = CleanupScanEntry(entry, failures, false);
  if (cleanup_complete) {
    std::lock_guard<std::mutex> guard(mutex);
    if (scan != nullptr && scan->lifecycle == entry->lifecycle) scan.reset();
  }
  if (!failures.empty()) {
    std::fprintf(stderr, "[unified_ble_winrt] Correlated scan terminal cleanup encountered failures\n");
  }
  if (!emit_terminal) {
    return;
  }
  const AdapterView adapter = EmitAdapterState(true);
  if (!IsAdapterReadyForScanTerminal(adapter)) return;
  EmitScanTerminal(entry->scan_token, error == BluetoothError::Success ? "stopped" : "aborted", error);
}

void BoundaryState::StopScan(const std::string& scan_token) {
  std::shared_ptr<ScanEntry> entry;
  {
    std::lock_guard<std::mutex> guard(mutex);
    if (destroyed || destroying) throw std::runtime_error("The WinRT native boundary is tearing down");
    if (scan == nullptr) {
      return;
    }
    if (scan->scan_token != scan_token) {
      throw std::runtime_error("The WinRT scan token does not identify the active physical scan");
    }
    entry = scan;
    entry->lifecycle->local_stop_requested.store(true);
    entry->lifecycle->ingress_open.store(false);
    entry->lifecycle->stop_requested.store(true);
  }
  std::vector<std::string> failures;
  const bool cleanup_complete = CleanupScanEntry(entry, failures, true);
  if (cleanup_complete) {
    std::lock_guard<std::mutex> guard(mutex);
    if (scan != nullptr && scan->lifecycle == entry->lifecycle) scan.reset();
  }
  if (!failures.empty()) {
    std::ostringstream message;
    message << "WinRT scan stop encountered teardown failures";
    for (const std::string& failure : failures) {
      message << "; " << failure;
    }
    throw std::runtime_error(message.str());
  }
}

std::shared_ptr<ConnectionEntry> BoundaryState::ReserveConnectingConnection(
    const std::string& peer,
    const std::string& connection_generation) {
  std::lock_guard<std::mutex> guard(mutex);
  if (
      destroyed ||
      destroying) {
    throw std::runtime_error("The WinRT peer connection is no longer admissible");
  }
  const std::shared_ptr<ConnectionEntry> connection = std::make_shared<ConnectionEntry>(connection_generation);
  if (!WinRtConnectionOwnership<ConnectionEntry>::reserve(
          connections,
          connecting_connections,
          cleanup_pending_connections,
          peer,
          connection)) {
    throw std::runtime_error("The WinRT peer connection is no longer admissible");
  }
  return connection;
}

void BoundaryState::PromoteConnectingConnection(
    const std::string& peer,
    const std::shared_ptr<ConnectionEntry>& connection) {
  std::lock_guard<std::mutex> guard(mutex);
  if (
      destroyed ||
      destroying ||
      !connecting_connections.contains(peer)) {
    throw std::runtime_error("The WinRT connecting owner is no longer admissible for activation");
  }
  {
    std::lock_guard<std::mutex> lifecycle_guard(connection->lifecycle_mutex);
    if (connection->disconnect_requested) {
      throw std::runtime_error("The WinRT connecting owner was disconnected before activation");
    }
    connection->cleanup_pending = false;
    connection->setup_in_progress = false;
  }
  if (!WinRtConnectionOwnership<ConnectionEntry>::promote(
          connections,
          connecting_connections,
          cleanup_pending_connections,
          peer,
          connection)) {
    throw std::runtime_error("The WinRT connecting owner is no longer admissible for activation");
  }
  connection->setup_finished.notify_all();
}

void BoundaryState::ReleaseRetainedConnectionAfterCleanup(
    const std::string& peer,
    const std::shared_ptr<ConnectionEntry>& connection) {
  std::lock_guard<std::mutex> guard(mutex);
  if (!WinRtConnectionOwnership<ConnectionEntry>::release(
          connections,
          connecting_connections,
          cleanup_pending_connections,
          peer,
          connection)) {
    throw std::runtime_error("WinRT cleaned connection owner is no longer retained by its peer");
  }
  {
    std::lock_guard<std::mutex> lifecycle_guard(connection->lifecycle_mutex);
    connection->cleanup_pending = false;
    connection->removal_claimed = false;
    connection->setup_in_progress = false;
  }
  connection->setup_finished.notify_all();
}

void BoundaryState::FinishConnectionSetup(const std::shared_ptr<ConnectionEntry>& connection) {
  {
    std::lock_guard<std::mutex> lifecycle_guard(connection->lifecycle_mutex);
    connection->setup_in_progress = false;
  }
  connection->setup_finished.notify_all();
}

void BoundaryState::RetainConnectionForCleanup(
    const std::string& peer,
    const std::shared_ptr<ConnectionEntry>& connection) {
  std::lock_guard<std::mutex> guard(mutex);
  const auto active = connections.find(peer);
  if (active != connections.end() && active->second != connection) {
    throw std::runtime_error("WinRT cleanup rollback conflicts with an active connection owner");
  }
  const auto connecting = connecting_connections.find(peer);
  if (connecting != connecting_connections.end() && connecting->second != connection) {
    throw std::runtime_error("WinRT cleanup rollback conflicts with a connecting connection owner");
  }
  const auto pending = cleanup_pending_connections.find(peer);
  if (pending != cleanup_pending_connections.end() && pending->second != connection) {
    throw std::runtime_error("WinRT cleanup rollback conflicts with a retained connection owner");
  }
  if (!WinRtConnectionOwnership<ConnectionEntry>::retainForCleanup(
          connections,
          connecting_connections,
          cleanup_pending_connections,
          peer,
          connection)) {
    throw std::runtime_error("WinRT cleanup rollback could not retain the exact connection owner");
  }
  {
    std::lock_guard<std::mutex> lifecycle_guard(connection->lifecycle_mutex);
    connection->cleanup_pending = true;
    connection->removal_claimed = true;
  }
}

bool BoundaryState::RemoveConnection(const std::string& peer, const std::shared_ptr<ConnectionEntry>& expected) {
  std::shared_ptr<ConnectionEntry> connection;
  std::vector<NotificationEntry> notifications_for_peer;
  bool cleanup_pending = false;
  bool connecting = false;
  std::string peer_prefix = peer;
  peer_prefix.push_back('\0');
  {
    std::lock_guard<std::mutex> guard(mutex);
    if (destroyed || destroying) return false;
    const auto found = connections.find(peer);
    if (found != connections.end()) {
      if (expected != nullptr && found->second != expected) return false;
      connection = found->second;
    } else {
      const auto pending = cleanup_pending_connections.find(peer);
      if (pending != cleanup_pending_connections.end()) {
        if (expected != nullptr && pending->second != expected) return false;
        connection = pending->second;
        cleanup_pending = true;
      } else {
        const auto provisional = connecting_connections.find(peer);
        if (provisional == connecting_connections.end() || (expected != nullptr && provisional->second != expected)) return false;
        connection = provisional->second;
        connecting = true;
      }
    }
    {
      std::lock_guard<std::mutex> lifecycle_guard(connection->lifecycle_mutex);
      if (connection->removal_claimed) return false;
      if (connecting && connection->setup_in_progress) {
        // Preserve the provisional owner until Connect sees the request after
        // its current WinRT await and rolls back the exact same entry.
        connection->disconnect_requested = true;
        return true;
      }
      connection->removal_claimed = true;
    }
    for (const auto& notification : notifications) {
      if (notification.first.rfind(peer_prefix, 0) == 0) notifications_for_peer.push_back(notification.second);
    }
  }

  std::vector<std::string> failures;
  for (NotificationEntry& notification : notifications_for_peer) {
    if (!CleanupNotificationEntry(notification, failures, true)) {
      failures.push_back("notification cleanup incomplete");
    }
  }
  if (!CleanupConnectionEntry(connection, failures)) {
    failures.push_back("connection cleanup incomplete");
  }
  if (!failures.empty()) {
    {
      std::lock_guard<std::mutex> lifecycle_guard(connection->lifecycle_mutex);
      // Retain the exact map entries, then reopen the claim so Disconnect (or a
      // link-loss-triggered retry) can run the same cleanup again.
      connection->removal_claimed = false;
    }
    ThrowWinRtCleanupFailures("WinRT connection teardown", failures);
  }

  {
    std::lock_guard<std::mutex> guard(mutex);
    if (cleanup_pending) {
      const auto found = cleanup_pending_connections.find(peer);
      if (found != cleanup_pending_connections.end() && found->second == connection) cleanup_pending_connections.erase(found);
    } else if (connecting) {
      const auto found = connecting_connections.find(peer);
      if (found != connecting_connections.end() && found->second == connection) connecting_connections.erase(found);
    } else {
      const auto found = connections.find(peer);
      if (found != connections.end() && found->second == connection) connections.erase(found);
    }
    {
      std::lock_guard<std::mutex> lifecycle_guard(connection->lifecycle_mutex);
      connection->cleanup_pending = false;
      connection->setup_in_progress = false;
    }
    connection->setup_finished.notify_all();
    for (auto notification = notifications.begin(); notification != notifications.end();) {
      if (notification->first.rfind(peer_prefix, 0) == 0) {
        notification = notifications.erase(notification);
      } else {
        ++notification;
      }
    }
  }
  return true;
}

void BoundaryState::Destroy() {
  std::vector<std::shared_ptr<ConnectionEntry>> live_connections;
  std::vector<std::shared_ptr<ConnectionEntry>> connecting_owners;
  std::vector<NotificationEntry> live_notifications;
  std::shared_ptr<ScanEntry> active_scan;
  std::optional<Radio> active_radio;
  std::optional<winrt::event_token> active_radio_token;
  bool active_radio_handler_registered = false;
  std::vector<std::shared_ptr<ConnectionLossListener>> loss_listeners;
  std::vector<std::shared_ptr<DatabaseListener>> changed_listeners;
  std::vector<std::shared_ptr<AdapterListener>> state_listeners;
  std::vector<std::shared_ptr<ScanTerminalListener>> scan_terminal_listeners;
  {
    std::lock_guard<std::mutex> guard(mutex);
    if (destroyed) {
      return;
    }
    if (destroying) throw std::runtime_error("WinRT native boundary teardown is already in progress");
    destroying = true;
    active_scan = scan;
    if (active_scan != nullptr) {
      active_scan->lifecycle->local_stop_requested.store(true);
      active_scan->lifecycle->ingress_open.store(false);
      active_scan->lifecycle->stop_requested.store(true);
    }
    for (const auto& pair : connections) {
      live_connections.push_back(pair.second);
    }
    for (const auto& pair : cleanup_pending_connections) {
      live_connections.push_back(pair.second);
    }
    for (const auto& pair : connecting_connections) {
      {
        std::lock_guard<std::mutex> lifecycle_guard(pair.second->lifecycle_mutex);
        pair.second->disconnect_requested = true;
      }
      connecting_owners.push_back(pair.second);
      live_connections.push_back(pair.second);
    }
    for (const auto& pair : notifications) {
      live_notifications.push_back(pair.second);
    }
    active_radio = radio;
    active_radio_token = radio_token;
    active_radio_handler_registered = radio_handler_registered;
    loss_listeners = connection_listeners;
    changed_listeners = database_listeners;
    state_listeners = adapter_listeners;
    scan_terminal_listeners = this->scan_terminal_listeners;
  }

  // A resource-owning WinRT await can still be active when Destroy begins.
  // Keep its peer reservation in the snapshot until Connect has observed the
  // destroy request and finished rollback; otherwise a late device/session
  // assignment would escape every native owner map.
  for (const std::shared_ptr<ConnectionEntry>& connection : connecting_owners) {
    std::unique_lock<std::mutex> lifecycle_lock(connection->lifecycle_mutex);
    connection->setup_finished.wait(lifecycle_lock, [&connection] { return !connection->setup_in_progress; });
  }

  std::vector<std::string> failures;
  if (!CleanupScanEntry(active_scan, failures, true)) {
    failures.push_back("scan cleanup incomplete");
  }
    if (active_radio_handler_registered && active_radio.has_value() && active_radio_token.has_value()) {
      if (ContinueWinRtTeardown(failures, "radio event deregistration", [&] { active_radio->StateChanged(*active_radio_token); })) {
        std::lock_guard<std::mutex> guard(mutex);
        radio_handler_registered = false;
      }
  }
  for (NotificationEntry& notification : live_notifications) {
    if (!CleanupNotificationEntry(notification, failures, true)) failures.push_back("notification cleanup incomplete");
  }
  for (const std::shared_ptr<ConnectionEntry>& connection : live_connections) {
    if (!CleanupConnectionEntry(connection, failures)) failures.push_back("connection cleanup incomplete");
  }
  for (const std::shared_ptr<ConnectionLossListener>& listener : loss_listeners) {
    ContinueWinRtTeardown(failures, "connection-loss listener release", [&] { listener->Release(); });
  }
  for (const std::shared_ptr<DatabaseListener>& listener : changed_listeners) {
    ContinueWinRtTeardown(failures, "database-change listener release", [&] { listener->Release(); });
  }
  for (const std::shared_ptr<AdapterListener>& listener : state_listeners) {
    ContinueWinRtTeardown(failures, "adapter-state listener release", [&] { listener->Release(); });
  }
  for (const std::shared_ptr<ScanTerminalListener>& listener : scan_terminal_listeners) {
    ContinueWinRtTeardown(failures, "scan-terminal listener release", [&] { listener->Release(); });
  }
  if (!failures.empty()) {
    std::lock_guard<std::mutex> guard(mutex);
    destroying = false;
    std::ostringstream message;
    message << "WinRT destroy encountered teardown failures";
    for (const std::string& failure : failures) {
      message << "; " << failure;
    }
    throw std::runtime_error(message.str());
  }
  {
    std::lock_guard<std::mutex> guard(mutex);
    scan.reset();
    connections.clear();
    connecting_connections.clear();
    cleanup_pending_connections.clear();
    notifications.clear();
    radio.reset();
    radio_token.reset();
    radio_handler_registered = false;
    connection_listeners.clear();
    database_listeners.clear();
    adapter_listeners.clear();
    scan_terminal_listeners.clear();
    destroyed = true;
    destroying = false;
  }
}

class WinRtContractBoundary final : public Napi::ObjectWrap<WinRtContractBoundary> {
 public:
  static Napi::FunctionReference constructor;

  static Napi::Object Init(Napi::Env env, Napi::Object exports) {
    Napi::Function type = DefineClass(env, "WinRtContractBoundary", {
      InstanceMethod("listAdapters", &WinRtContractBoundary::ListAdapters),
      InstanceMethod("selectAdapter", &WinRtContractBoundary::SelectAdapter),
      InstanceMethod("adapterSnapshot", &WinRtContractBoundary::AdapterSnapshot),
      InstanceMethod("startScan", &WinRtContractBoundary::StartScan),
      InstanceMethod("stopScan", &WinRtContractBoundary::StopScan),
      InstanceMethod("connect", &WinRtContractBoundary::Connect),
      InstanceMethod("disconnect", &WinRtContractBoundary::Disconnect),
      InstanceMethod("discover", &WinRtContractBoundary::Discover),
      InstanceMethod("read", &WinRtContractBoundary::Read),
      InstanceMethod("write", &WinRtContractBoundary::Write),
      InstanceMethod("readDescriptor", &WinRtContractBoundary::ReadDescriptor),
      InstanceMethod("writeDescriptor", &WinRtContractBoundary::WriteDescriptor),
      InstanceMethod("startNotify", &WinRtContractBoundary::StartNotify),
      InstanceMethod("stopNotify", &WinRtContractBoundary::StopNotify),
      InstanceMethod("onConnectionLost", &WinRtContractBoundary::OnConnectionLost),
      InstanceMethod("onDatabaseChanged", &WinRtContractBoundary::OnDatabaseChanged),
      InstanceMethod("onAdapterState", &WinRtContractBoundary::OnAdapterState),
      InstanceMethod("onScanTerminal", &WinRtContractBoundary::OnScanTerminal),
      InstanceMethod("ingressTelemetry", &WinRtContractBoundary::IngressTelemetrySnapshot),
      InstanceMethod("destroy", &WinRtContractBoundary::Destroy)
    });
    constructor = Napi::Persistent(type);
    constructor.SuppressDestruct();
    exports.Set("WinRtContractBoundary", type);
    return exports;
  }

  explicit WinRtContractBoundary(const Napi::CallbackInfo& info) : Napi::ObjectWrap<WinRtContractBoundary>(info), state_(std::make_shared<BoundaryState>()) {
    EnsureWinRtApartment();
  }

  ~WinRtContractBoundary() override {
    try {
      state_->Destroy();
    } catch (const std::exception& error) {
      std::fprintf(stderr, "[unified_ble_winrt] WinRtContractBoundary destructor teardown failed: %s\n", error.what());
    } catch (...) {
      std::fprintf(stderr, "[unified_ble_winrt] WinRtContractBoundary destructor teardown failed with a non-standard error\n");
    }
  }

 private:
  Napi::Value ListAdapters(const Napi::CallbackInfo& info) {
    return StartOperation<std::vector<AdapterView>>(info.Env(), [] {
      return ReadAdapters();
    }, [](Napi::Env env, const std::vector<AdapterView>& adapters) {
      Napi::Array result = Napi::Array::New(env, adapters.size());
      for (uint32_t index = 0; index < adapters.size(); ++index) result.Set(index, ToJsAdapter(env, adapters[index]));
      return result;
    });
  }

  Napi::Value SelectAdapter(const Napi::CallbackInfo& info) {
    if (info.Length() != 1 || !info[0].IsString()) throw Napi::TypeError::New(info.Env(), "WinRT adapter selection requires a native adapter identifier");
    const std::string requested = info[0].As<Napi::String>().Utf8Value();
    const std::shared_ptr<BoundaryState> state = state_;
    return StartOperation<VoidResult>(info.Env(), [state, requested] {
      const std::vector<AdapterView> adapters = ReadAdapters();
      const auto selected = std::find_if(adapters.begin(), adapters.end(), [&requested](const AdapterView& adapter) {
        return adapter.native_id == requested;
      });
      if (selected == adapters.end()) throw std::runtime_error("The selected Windows Bluetooth adapter is unavailable");
      const BluetoothAdapter native_adapter = AwaitWinRt(BluetoothAdapter::FromIdAsync(winrt::to_hstring(requested)));
      if (native_adapter == nullptr) throw std::runtime_error("The selected Windows Bluetooth adapter could not be opened");
      std::optional<Radio> radio;
      if (selected->authorization == "granted") {
        const Radio native_radio = AwaitWinRt(native_adapter.GetRadioAsync());
        if (native_radio == nullptr) throw std::runtime_error("The selected Windows Bluetooth adapter has no associated radio");
        radio = native_radio;
      }
      std::lock_guard<std::mutex> guard(state->mutex);
      if (state->destroyed || state->destroying) throw std::runtime_error("The WinRT native boundary has been destroyed or is tearing down");
      if (state->radio_handler_registered && state->radio.has_value() && state->radio_token.has_value()) {
        std::vector<std::string> failures;
        if (!ContinueWinRtTeardown(failures, "previous radio event deregistration", [&] { state->radio->StateChanged(*state->radio_token); })) {
          throw std::runtime_error("The previous WinRT adapter state subscription could not be revoked");
        }
        state->radio_handler_registered = false;
        state->radio.reset();
        state->radio_token.reset();
      } else {
        state->radio.reset();
        state->radio_token.reset();
      }
      state->selected_adapter = requested;
      state->radio = radio;
      if (radio.has_value()) {
        const std::weak_ptr<BoundaryState> weak_state = state;
        state->radio_token = radio->StateChanged([weak_state](const Radio&, const winrt::Windows::Foundation::IInspectable&) {
          if (const std::shared_ptr<BoundaryState> live_state = weak_state.lock()) live_state->EmitAdapterState();
        });
        state->radio_handler_registered = true;
      } else {
        state->radio_token.reset();
        state->radio_handler_registered = false;
      }
      return VoidResult{};
    }, ToJsVoid);
  }

  Napi::Value AdapterSnapshot(const Napi::CallbackInfo& info) {
    try {
      std::string selected_adapter;
      {
        std::lock_guard<std::mutex> guard(state_->mutex);
        selected_adapter = state_->selected_adapter;
      }
      return ToJsAdapterState(info.Env(), ReadAdapter(selected_adapter));
    } catch (const winrt::hresult_error& error) {
      return ToJsAdapterState(info.Env(), {"", "", "unavailable", "unavailable", "unknown", ToUtf8(error.message()), IsPackagedProcess() ? "packaged" : "unpackaged"});
    } catch (const std::exception& error) {
      return ToJsAdapterState(info.Env(), {"", "", "unavailable", "unavailable", "unknown", error.what(), IsPackagedProcess() ? "packaged" : "unpackaged"});
    }
  }

  Napi::Value StartScan(const Napi::CallbackInfo& info) {
    if (info.Length() != 3 || !info[0].IsString() || !info[1].IsArray() || !info[2].IsFunction()) throw Napi::TypeError::New(info.Env(), "WinRT scan requires scanToken, service UUIDs, and an advertisement callback");
    const std::string scan_token = info[0].As<Napi::String>().Utf8Value();
    if (scan_token.empty()) throw Napi::TypeError::New(info.Env(), "WinRT scan requires a non-empty scanToken");
    std::vector<std::string> service_uuids;
    const Napi::Array requested = info[1].As<Napi::Array>();
    for (uint32_t index = 0; index < requested.Length(); ++index) {
      if (!requested.Get(index).IsString()) throw Napi::TypeError::New(info.Env(), "WinRT scan service UUIDs must be strings");
      service_uuids.push_back(requested.Get(index).As<Napi::String>().Utf8Value());
    }
    const std::shared_ptr<BoundaryState> state = state_;
    const std::shared_ptr<AdvertisementListener> listener = std::make_shared<AdvertisementListener>(
        Napi::ThreadSafeFunction::New(info.Env(), info[2].As<Napi::Function>(), "winrt-advertisement", kAdvertisementIngressQueueCapacity, 1),
        state->ingress_telemetry);
    return StartOperation<VoidResult>(info.Env(), [state, scan_token, service_uuids, listener] {
      const std::shared_ptr<ScanEntry> entry = std::make_shared<ScanEntry>();
      entry->scan_token = scan_token;
      entry->listener = listener;
      entry->lifecycle = std::make_shared<ScanLifecycle>();
      try {
        EnsureWinRtApartment();
        ThrowIfCurrentOperationWasCancelled();
        entry->watcher = BluetoothLEAdvertisementWatcher{};
        for (const std::string& service_uuid : service_uuids) entry->watcher.AdvertisementFilter().Advertisement().ServiceUuids().Append(ParseUuid(service_uuid));
        entry->received_token = entry->watcher.Received([entry](const BluetoothLEAdvertisementWatcher&, const BluetoothLEAdvertisementReceivedEventArgs& event) {
          if (!entry->lifecycle->ingress_open.load()) return;
          try {
            const auto advertisement = event.Advertisement();
            const std::string peer = AddressKey(event.BluetoothAddress());
            const std::string name = ToUtf8(advertisement.LocalName());
            std::vector<std::string> services;
            const auto advertised_service_uuids = advertisement.ServiceUuids();
            for (uint32_t index = 0; index < advertised_service_uuids.Size(); ++index) {
              services.push_back(CanonicalUuid(advertised_service_uuids.GetAt(index)));
            }
            entry->listener->Emit(entry->scan_token, entry->generation, peer, name, event.RawSignalStrengthInDBm(), std::move(services));
          } catch (const winrt::hresult_error& error) {
            ReportWinRtDelegateFailure("watcher Received", error);
          } catch (const std::exception& error) {
            ReportWinRtDelegateFailure("watcher Received", error);
          } catch (...) {
            ReportWinRtDelegateFailure("watcher Received");
          }
        });
        entry->lifecycle->received_handler_registered = true;
        entry->stopped_token = entry->watcher.Stopped([state, entry](const BluetoothLEAdvertisementWatcher&, const winrt::Windows::Devices::Bluetooth::Advertisement::BluetoothLEAdvertisementWatcherStoppedEventArgs& event) {
          try {
            state->HandleScanStopped(entry, event.Error());
          } catch (const winrt::hresult_error& error) {
            ReportWinRtDelegateFailure("watcher Stopped", error);
          } catch (const std::exception& error) {
            ReportWinRtDelegateFailure("watcher Stopped", error);
          } catch (...) {
            ReportWinRtDelegateFailure("watcher Stopped");
          }
        });
        entry->lifecycle->stopped_handler_registered = true;
        {
          std::lock_guard<std::mutex> guard(state->mutex);
          if (state->destroyed || state->destroying || state->scan != nullptr) throw std::runtime_error("A WinRT physical scan is already active or destroyed");
          entry->generation = state->next_scan_generation++;
          state->scan = entry;
        }
        try {
          std::lock_guard<std::mutex> startup_guard(entry->lifecycle->startup_mutex);
          entry->lifecycle->startup_in_progress.store(true);
          ThrowIfCurrentOperationWasCancelled();
          entry->watcher.Start();
          entry->lifecycle->startup_in_progress.store(false);
        } catch (...) {
          entry->lifecycle->startup_in_progress.store(false);
          throw;
        }
        {
          std::optional<BluetoothError> deferred_error;
          {
            std::lock_guard<std::mutex> cleanup_guard(entry->lifecycle->cleanup_mutex);
            if (entry->lifecycle->deferred_stopped.load() && entry->lifecycle->deferred_error.has_value()) {
              deferred_error = entry->lifecycle->deferred_error;
              entry->lifecycle->deferred_error.reset();
              entry->lifecycle->deferred_stopped.store(false);
            }
          }
          if (deferred_error.has_value()) state->HandleScanStopped(entry, *deferred_error);
        }
        {
          std::lock_guard<std::mutex> guard(state->mutex);
          if (state->destroyed || state->destroying || state->scan == nullptr || state->scan->lifecycle != entry->lifecycle || entry->lifecycle->local_stop_requested.load()) {
            throw std::runtime_error("The WinRT scan was stopped or destroyed while it was starting");
          }
        }
        ThrowIfCurrentOperationWasCancelled();
        if (entry->lifecycle->terminal_emitted.load()) throw std::runtime_error("The WinRT scan stopped while it was starting");
        return VoidResult{};
      } catch (...) {
        entry->lifecycle->stop_requested.store(true);
        entry->lifecycle->ingress_open.store(false);
        std::vector<std::string> failures;
        const bool cleanup_complete = CleanupScanEntry(entry, failures, true);
        if (cleanup_complete) {
          std::lock_guard<std::mutex> guard(state->mutex);
          if (state->scan != nullptr && state->scan->lifecycle == entry->lifecycle) state->scan.reset();
        }
        if (!failures.empty()) {
          // Keep `state->scan` intact when any watcher/handler/listener cleanup
          // fails.  The exact scan token remains callable through stopScan for a
          // retry; returning only the start failure would otherwise orphan it.
          ThrowWinRtCleanupFailures("WinRT scan start rollback", failures);
        }
        throw;
      }
    }, ToJsVoid);
  }

  Napi::Value StopScan(const Napi::CallbackInfo& info) {
    if (info.Length() != 1 || !info[0].IsString()) throw Napi::TypeError::New(info.Env(), "WinRT scan stop requires the active scanToken");
    const std::string scan_token = info[0].As<Napi::String>().Utf8Value();
    if (scan_token.empty()) throw Napi::TypeError::New(info.Env(), "WinRT scan stop requires a non-empty active scanToken");
    const std::shared_ptr<BoundaryState> state = state_;
    return StartOperation<VoidResult>(info.Env(), [state, scan_token] { state->StopScan(scan_token); return VoidResult{}; }, ToJsVoid);
  }

  Napi::Value Connect(const Napi::CallbackInfo& info) {
    if (info.Length() != 2 || !info[0].IsString() || !info[1].IsString()) throw Napi::TypeError::New(info.Env(), "WinRT connect requires a native peer identifier and connectionGeneration");
    const std::string peer = info[0].As<Napi::String>().Utf8Value();
    const std::string connection_generation = info[1].As<Napi::String>().Utf8Value();
    if (connection_generation.empty()) throw Napi::TypeError::New(info.Env(), "WinRT connect requires a non-empty connectionGeneration");
    const std::shared_ptr<BoundaryState> state = state_;
    return StartOperation<VoidResult>(info.Env(), [state, peer, connection_generation] {
      EnsureWinRtApartment();
      const uint64_t address = ParseAddress(peer);
      // Claim this peer before the first resource-owning WinRT call.  Every
      // later rollback, Disconnect, and Destroy branch handles this exact
      // ConnectionEntry rather than a best-effort replacement owner.
      const std::shared_ptr<ConnectionEntry> connection = state->ReserveConnectingConnection(peer, connection_generation);
      bool connection_owner_released = false;
      try {
        const BluetoothLEDevice device = AwaitWinRt(BluetoothLEDevice::FromBluetoothAddressAsync(address));
        if (device == nullptr) throw std::runtime_error("Windows could not open the selected BLE peer");
        {
          std::lock_guard<std::mutex> lifecycle_guard(connection->lifecycle_mutex);
          connection->device = device;
          connection->device_open = true;
          if (connection->disconnect_requested) {
            throw std::runtime_error("The WinRT connecting owner was disconnected while opening the BLE device");
          }
        }
        ThrowIfCurrentOperationWasCancelled();
        const GattSession session = AwaitWinRt(GattSession::FromDeviceIdAsync(device.BluetoothDeviceId()));
        if (session == nullptr) throw std::runtime_error("Windows could not open a GATT session for the selected BLE peer");
        {
          std::lock_guard<std::mutex> lifecycle_guard(connection->lifecycle_mutex);
          connection->session = session;
          connection->session_open = true;
          if (connection->disconnect_requested) {
            throw std::runtime_error("The WinRT connecting owner was disconnected while opening the GATT session");
          }
        }
        ThrowIfCurrentOperationWasCancelled();
        session.MaintainConnection(true);
        {
          std::lock_guard<std::mutex> lifecycle_guard(connection->lifecycle_mutex);
          connection->maintenance_enabled = true;
          if (connection->disconnect_requested) {
            throw std::runtime_error("The WinRT connecting owner was disconnected while enabling connection maintenance");
          }
        }
        const auto confirmation = AwaitWinRt(device.GetGattServicesAsync(winrt::Windows::Devices::Bluetooth::BluetoothCacheMode::Uncached));
        RequireSuccess(confirmation.Status(), "WinRT connection confirmation");
        ThrowIfCurrentOperationWasCancelled();
        {
          std::lock_guard<std::mutex> lifecycle_guard(connection->lifecycle_mutex);
          if (connection->disconnect_requested) {
            throw std::runtime_error("The WinRT connecting owner was disconnected during GATT confirmation");
          }
        }
        if (device.ConnectionStatus() != BluetoothConnectionStatus::Connected) {
          throw std::runtime_error("Windows did not confirm an active BLE link after GATT connection probing");
        }
        const std::weak_ptr<BoundaryState> weak_state = state;
        const std::weak_ptr<ConnectionEntry> weak_connection = connection;
        connection->connection_token = device.ConnectionStatusChanged([weak_state, weak_connection, peer](const BluetoothLEDevice& source, const winrt::Windows::Foundation::IInspectable&) {
          try {
            if (source.ConnectionStatus() == BluetoothConnectionStatus::Disconnected) {
              if (const std::shared_ptr<BoundaryState> live_state = weak_state.lock()) {
                if (const std::shared_ptr<ConnectionEntry> live_connection = weak_connection.lock(); live_connection != nullptr) {
                  bool removed = false;
                  try {
                    removed = live_state->RemoveConnection(peer, live_connection);
                  } catch (const std::exception& error) {
                    // The radio loss is terminal even if native event/CCCD
                    // cleanup needs another attempt.  Keep the map owner for
                    // retry, but notify TypeScript so it can drive Disconnect
                    // again rather than stranding that ownership forever.
                    ReportWinRtDelegateFailure("connection status cleanup", error);
                    removed = true;
                  }
                  if (!removed) return;
                  bool emit_loss = false;
                  {
                    std::lock_guard<std::mutex> guard(live_connection->lifecycle_mutex);
                    if (!live_connection->loss_emitted) {
                      live_connection->loss_emitted = true;
                      emit_loss = true;
                    }
                  }
                  if (emit_loss) live_state->EmitConnectionLoss(peer, live_connection->connection_generation, std::string("Windows reported BLE link loss"));
                }
              }
            }
          } catch (const winrt::hresult_error& error) {
            ReportWinRtDelegateFailure("connection status", error);
          } catch (const std::exception& error) {
            ReportWinRtDelegateFailure("connection status", error);
          } catch (...) {
            ReportWinRtDelegateFailure("connection status");
          }
        });
        connection->connection_handler_registered = true;
        connection->session_token = session.SessionStatusChanged([weak_state, weak_connection, peer](const GattSession& source, const winrt::Windows::Foundation::IInspectable&) {
          try {
            if (source.SessionStatus() == GattSessionStatus::Closed) {
              if (const std::shared_ptr<BoundaryState> live_state = weak_state.lock()) {
                if (const std::shared_ptr<ConnectionEntry> live_connection = weak_connection.lock(); live_connection != nullptr) {
                  bool removed = false;
                  try {
                    removed = live_state->RemoveConnection(peer, live_connection);
                  } catch (const std::exception& error) {
                    // Preserve the retryable native owner while still making
                    // the physical GATT loss observable to TypeScript.
                    ReportWinRtDelegateFailure("session status cleanup", error);
                    removed = true;
                  }
                  if (!removed) return;
                  live_state->EmitDatabaseChanged(peer, live_connection->connection_generation);
                  bool emit_loss = false;
                  {
                    std::lock_guard<std::mutex> guard(live_connection->lifecycle_mutex);
                    if (!live_connection->loss_emitted) {
                      live_connection->loss_emitted = true;
                      emit_loss = true;
                    }
                  }
                  if (emit_loss) live_state->EmitConnectionLoss(peer, live_connection->connection_generation, std::string("Windows reported GATT session loss"));
                }
              }
            }
          } catch (const winrt::hresult_error& error) {
            ReportWinRtDelegateFailure("session status", error);
          } catch (const std::exception& error) {
            ReportWinRtDelegateFailure("session status", error);
          } catch (...) {
            ReportWinRtDelegateFailure("session status");
          }
        });
        connection->session_handler_registered = true;
        connection->services_changed_token = device.GattServicesChanged([weak_state, weak_connection, peer](const BluetoothLEDevice&, const winrt::Windows::Foundation::IInspectable&) {
          try {
            if (const std::shared_ptr<BoundaryState> live_state = weak_state.lock()) {
              if (const std::shared_ptr<ConnectionEntry> live_connection = weak_connection.lock(); live_connection != nullptr) {
                live_state->HandleGattServicesChanged(peer, live_connection);
              }
            }
          } catch (const winrt::hresult_error& error) {
            ReportWinRtDelegateFailure("GattServicesChanged", error);
          } catch (const std::exception& error) {
            ReportWinRtDelegateFailure("GattServicesChanged", error);
          } catch (...) {
            ReportWinRtDelegateFailure("GattServicesChanged");
          }
        });
        connection->services_changed_handler_registered = true;
        state->PromoteConnectingConnection(peer, connection);
        if (device.ConnectionStatus() != BluetoothConnectionStatus::Connected) {
          connection_owner_released = state->RemoveConnection(peer, connection);
          throw std::runtime_error("Windows lost the BLE link while finalizing the confirmed connection");
        }
        return VoidResult{};
      } catch (...) {
        if (connection_owner_released) throw;
        std::vector<std::string> cleanup_failures;
        try {
          // Atomically move the same provisional or active owner into the
          // retryable map before cleanup.  A concurrent Connect now rejects,
          // while Disconnect and Destroy can retry any failed teardown.
          state->RetainConnectionForCleanup(peer, connection);
          if (CleanupConnectionEntry(connection, cleanup_failures)) {
            state->ReleaseRetainedConnectionAfterCleanup(peer, connection);
          } else {
            {
              std::lock_guard<std::mutex> lifecycle_guard(connection->lifecycle_mutex);
              connection->removal_claimed = false;
            }
            state->FinishConnectionSetup(connection);
            std::fprintf(stderr, "[unified_ble_winrt] Connect rollback retained after cleanup failures\n");
          }
          if (!cleanup_failures.empty()) {
            std::fprintf(stderr, "[unified_ble_winrt] Connect rollback cleanup encountered failures\n");
          }
        } catch (const std::exception& cleanup_error) {
          state->FinishConnectionSetup(connection);
          std::fprintf(stderr, "[unified_ble_winrt] Connect rollback ownership finalization failed: %s\n", cleanup_error.what());
        } catch (...) {
          state->FinishConnectionSetup(connection);
          std::fprintf(stderr, "[unified_ble_winrt] Connect rollback ownership finalization failed with a non-standard error\n");
        }
        throw;
      }
    }, ToJsVoid);
  }

  Napi::Value Disconnect(const Napi::CallbackInfo& info) {
    if (info.Length() != 1 || !info[0].IsString()) throw Napi::TypeError::New(info.Env(), "WinRT disconnect requires a native peer identifier");
    const std::string peer = info[0].As<Napi::String>().Utf8Value();
    const std::shared_ptr<BoundaryState> state = state_;
    return StartOperation<VoidResult>(info.Env(), [state, peer] { state->RemoveConnection(peer); return VoidResult{}; }, ToJsVoid);
  }

  Napi::Value Discover(const Napi::CallbackInfo& info) {
    if (info.Length() != 1 || !info[0].IsString()) throw Napi::TypeError::New(info.Env(), "WinRT discovery requires a native peer identifier");
    const std::string peer = info[0].As<Napi::String>().Utf8Value();
    const std::shared_ptr<BoundaryState> state = state_;
    return StartOperation<DiscoveryView>(info.Env(), [state, peer] {
      std::shared_ptr<ConnectionEntry> connection = RequiredConnection(state, peer);
      // Discovery replaces the characteristic cache.  Hold the same per-peer
      // GATT serialization used by reads, writes, CCCD transitions, and cleanup
      // from the initial revision through cache publication.
      std::unique_lock<std::mutex> gatt_guard(connection->gatt_mutex);
      const uint64_t discovery_revision = connection->services_revision.load();
      const auto services_result = AwaitWinRt(connection->device.GetGattServicesAsync(winrt::Windows::Devices::Bluetooth::BluetoothCacheMode::Uncached));
      RequireSuccess(services_result.Status(), "Gatt service discovery");
      std::vector<ServiceEntry> services;
      DiscoveryView view;
      std::unordered_map<std::string, uint32_t> service_occurrences;
      const auto native_services = services_result.Services();
      for (uint32_t service_index = 0; service_index < native_services.Size(); ++service_index) {
        const GattDeviceService native_service = native_services.GetAt(service_index);
        const std::string service_uuid = CanonicalUuid(native_service.Uuid());
        ServiceEntry service{service_uuid, service_occurrences[service_uuid]++, native_service, {}};
        ServiceView service_view{service.uuid, service.occurrence, {}};
        const auto characteristics_result = AwaitWinRt(native_service.GetCharacteristicsAsync(winrt::Windows::Devices::Bluetooth::BluetoothCacheMode::Uncached));
        RequireSuccess(characteristics_result.Status(), "Gatt characteristic discovery");
        std::unordered_map<std::string, uint32_t> characteristic_occurrences;
        const auto native_characteristics = characteristics_result.Characteristics();
        for (uint32_t characteristic_index = 0; characteristic_index < native_characteristics.Size(); ++characteristic_index) {
          const GattCharacteristic native_characteristic = native_characteristics.GetAt(characteristic_index);
          const std::string characteristic_uuid = CanonicalUuid(native_characteristic.Uuid());
          CharacteristicEntry characteristic{
              characteristic_uuid,
              characteristic_occurrences[characteristic_uuid]++,
              native_characteristic,
              {}};
          const GattCharacteristicProperties properties = native_characteristic.CharacteristicProperties();
          CharacteristicView characteristic_view{
              characteristic.uuid,
              characteristic.occurrence,
              (properties & GattCharacteristicProperties::Read) == GattCharacteristicProperties::Read,
              (properties & GattCharacteristicProperties::Write) == GattCharacteristicProperties::Write,
              (properties & GattCharacteristicProperties::WriteWithoutResponse) == GattCharacteristicProperties::WriteWithoutResponse,
              (properties & GattCharacteristicProperties::Notify) == GattCharacteristicProperties::Notify,
              (properties & GattCharacteristicProperties::Indicate) == GattCharacteristicProperties::Indicate,
              {}};
          const auto descriptors_result = AwaitWinRt(native_characteristic.GetDescriptorsAsync(winrt::Windows::Devices::Bluetooth::BluetoothCacheMode::Uncached));
          RequireSuccess(descriptors_result.Status(), "Gatt descriptor discovery");
          std::unordered_map<std::string, uint32_t> descriptor_occurrences;
          const auto native_descriptors = descriptors_result.Descriptors();
          for (uint32_t descriptor_index = 0; descriptor_index < native_descriptors.Size(); ++descriptor_index) {
            const GattDescriptor native_descriptor = native_descriptors.GetAt(descriptor_index);
            const std::string descriptor_uuid = CanonicalUuid(native_descriptor.Uuid());
            DescriptorEntry descriptor{
                descriptor_uuid,
                descriptor_occurrences[descriptor_uuid]++,
                native_descriptor};
            characteristic_view.descriptors.push_back({descriptor.uuid, descriptor.occurrence});
            characteristic.descriptors.push_back(std::move(descriptor));
          }
          service_view.characteristics.push_back(characteristic_view);
          service.characteristics.push_back(std::move(characteristic));
        }
        view.services.push_back(service_view);
        services.push_back(std::move(service));
      }
      {
        std::lock_guard<std::mutex> state_guard(state->mutex);
        const auto found = state->connections.find(peer);
        if (state->destroyed || state->destroying || found == state->connections.end() || found->second != connection) {
          throw std::runtime_error("The WinRT connection was lost during discovery");
        }
        if (connection->services_revision.load() != discovery_revision) {
          throw std::runtime_error("The WinRT GATT discovery result belongs to a stale services revision");
        }
        connection->services = std::move(services);
      }
      return view;
    }, ToJsDiscovery);
  }

  Napi::Value Read(const Napi::CallbackInfo& info) {
    const CharacteristicAddress address = ReadCharacteristicAddress(info[0]);
    const std::shared_ptr<BoundaryState> state = state_;
    return StartOperation<std::vector<uint8_t>>(info.Env(), [state, address] {
      std::shared_ptr<ConnectionEntry> connection = RequiredConnection(state, address.peer);
      std::lock_guard<std::mutex> gatt_guard(connection->gatt_mutex);
      const auto result = AwaitWinRt(RequiredCharacteristic(*connection, address).characteristic.ReadValueAsync(winrt::Windows::Devices::Bluetooth::BluetoothCacheMode::Uncached));
      RequireSuccess(result.Status(), "Gatt characteristic read");
      return BufferBytes(result.Value());
    }, [](Napi::Env env, const std::vector<uint8_t>& bytes) {
      Napi::Uint8Array result = Napi::Uint8Array::New(env, bytes.size());
      std::copy(bytes.begin(), bytes.end(), result.Data());
      return result;
    });
  }

  Napi::Value Write(const Napi::CallbackInfo& info) {
    const CharacteristicAddress address = ReadCharacteristicAddress(info[0]);
    const std::vector<uint8_t> bytes = ReadBytesArgument(info[1]);
    if (info.Length() != 3 || !info[2].IsString()) throw Napi::TypeError::New(info.Env(), "WinRT write requires an explicit response mode");
    const std::string mode = info[2].As<Napi::String>().Utf8Value();
    if (mode != "with-response" && mode != "without-response") throw Napi::TypeError::New(info.Env(), "WinRT write response mode is invalid");
    const std::shared_ptr<BoundaryState> state = state_;
    return StartOperation<VoidResult>(info.Env(), [state, address, bytes, mode] {
      std::shared_ptr<ConnectionEntry> connection = RequiredConnection(state, address.peer);
      std::lock_guard<std::mutex> guard(connection->gatt_mutex);
      const GattWriteOption option = mode == "with-response" ? GattWriteOption::WriteWithResponse : GattWriteOption::WriteWithoutResponse;
      RequireSuccess(AwaitWinRt(RequiredCharacteristic(*connection, address).characteristic.WriteValueAsync(ToBuffer(bytes), option)), "Gatt characteristic write");
      return VoidResult{};
    }, ToJsVoid);
  }

  Napi::Value ReadDescriptor(const Napi::CallbackInfo& info) {
    const DescriptorAddress address = ReadDescriptorAddress(info[0]);
    const std::shared_ptr<BoundaryState> state = state_;
    return StartOperation<std::vector<uint8_t>>(info.Env(), [state, address] {
      std::shared_ptr<ConnectionEntry> connection = RequiredConnection(state, address.peer);
      std::lock_guard<std::mutex> guard(connection->gatt_mutex);
      const auto result = AwaitWinRt(RequiredDescriptor(*connection, address).descriptor.ReadValueAsync(winrt::Windows::Devices::Bluetooth::BluetoothCacheMode::Uncached));
      RequireSuccess(result.Status(), "Gatt descriptor read");
      return BufferBytes(result.Value());
    }, [](Napi::Env env, const std::vector<uint8_t>& bytes) {
      Napi::Uint8Array result = Napi::Uint8Array::New(env, bytes.size());
      std::copy(bytes.begin(), bytes.end(), result.Data());
      return result;
    });
  }

  Napi::Value WriteDescriptor(const Napi::CallbackInfo& info) {
    const DescriptorAddress address = ReadDescriptorAddress(info[0]);
    const std::vector<uint8_t> bytes = ReadBytesArgument(info[1]);
    if (info.Length() != 3 || !info[2].IsString()) throw Napi::TypeError::New(info.Env(), "WinRT descriptor write requires an explicit response mode");
    const std::string mode = info[2].As<Napi::String>().Utf8Value();
    if (mode != "with-response") throw Napi::Error::New(info.Env(), "Windows GATT descriptors do not support write-without-response");
    const std::shared_ptr<BoundaryState> state = state_;
    return StartOperation<VoidResult>(info.Env(), [state, address, bytes] {
      std::shared_ptr<ConnectionEntry> connection = RequiredConnection(state, address.peer);
      std::lock_guard<std::mutex> guard(connection->gatt_mutex);
      RequireSuccess(AwaitWinRt(RequiredDescriptor(*connection, address).descriptor.WriteValueAsync(ToBuffer(bytes))), "Gatt descriptor write");
      return VoidResult{};
    }, ToJsVoid);
  }

  Napi::Value StartNotify(const Napi::CallbackInfo& info) {
    const CharacteristicAddress address = ReadCharacteristicAddress(info[0]);
    if (info.Length() != 3 || !info[1].IsString() || !info[2].IsFunction()) throw Napi::TypeError::New(info.Env(), "WinRT notify requires a mode and value callback");
    const std::string mode = info[1].As<Napi::String>().Utf8Value();
    if (mode != "notify" && mode != "indicate") throw Napi::TypeError::New(info.Env(), "WinRT notify mode is invalid");
    const std::shared_ptr<BoundaryState> state = state_;
    const std::shared_ptr<NotificationListener> listener = std::make_shared<NotificationListener>(
        Napi::ThreadSafeFunction::New(info.Env(), info[2].As<Napi::Function>(), "winrt-notification", kNotificationIngressQueueCapacity, 1),
        state->ingress_telemetry);
    return StartOperation<VoidResult>(info.Env(), [state, address, mode, listener] {
      std::shared_ptr<ConnectionEntry> connection;
      GattCharacteristic characteristic{nullptr};
      const std::shared_ptr<NotificationEntry::Lifecycle> notification_lifecycle = std::make_shared<NotificationEntry::Lifecycle>();
      std::optional<NotificationEntry> provisional;
      bool provisional_published = false;
      try {
        connection = RequiredConnection(state, address.peer);
        {
          std::lock_guard<std::mutex> gatt_guard(connection->gatt_mutex);
          CharacteristicEntry& entry = RequiredCharacteristic(*connection, address);
          characteristic = entry.characteristic;
        }
        provisional.emplace(NotificationEntry{connection, characteristic, listener, notification_lifecycle});
        const std::string key = CharacteristicKey(address);
        {
          // Publish the exact cleanup owner before registering a ValueChanged
          // handler or enabling CCCD.  A concurrent disconnect/destroy can now
          // retry any partially-created subscription through this same entry.
          std::lock_guard<std::mutex> state_guard(state->mutex);
          const auto found = state->connections.find(address.peer);
          if (state->destroyed || state->destroying || found == state->connections.end() || found->second != connection || state->notifications.contains(key)) {
            throw std::runtime_error("The WinRT notification subscription is no longer admissible");
          }
          state->notifications.emplace(key, *provisional);
          provisional_published = true;
        }
        {
          // Lock order is connection GATT followed by notification lifecycle.
          // No BoundaryState mutex is held while waiting for this GATT lock.
          std::lock_guard<std::mutex> gatt_guard(connection->gatt_mutex);
          std::lock_guard<std::mutex> lifecycle_guard(notification_lifecycle->mutex);
          if (notification_lifecycle->listener_released) {
            throw std::runtime_error("The WinRT notification subscription was cancelled before CCCD enablement");
          }
          const GattClientCharacteristicConfigurationDescriptorValue cccd = mode == "indicate"
              ? GattClientCharacteristicConfigurationDescriptorValue::Indicate
              : GattClientCharacteristicConfigurationDescriptorValue::Notify;
          notification_lifecycle->value_token = characteristic.ValueChanged([listener](const GattCharacteristic&, const winrt::Windows::Devices::Bluetooth::GenericAttributeProfile::GattValueChangedEventArgs& event) {
            listener->Emit(BufferBytes(event.CharacteristicValue()));
          });
          notification_lifecycle->value_handler_registered = true;
          RequireSuccess(AwaitWinRt(characteristic.WriteClientCharacteristicConfigurationDescriptorAsync(cccd)), "Gatt CCCD enable");
          notification_lifecycle->cccd_enabled = true;
        }
        return VoidResult{};
      } catch (...) {
        std::vector<std::string> cleanup_failures;
        if (provisional_published && provisional.has_value()) {
          const bool cleanup_complete = CleanupNotificationEntry(*provisional, cleanup_failures, true);
          if (cleanup_complete && cleanup_failures.empty()) {
            std::lock_guard<std::mutex> state_guard(state->mutex);
            const auto found = state->notifications.find(CharacteristicKey(address));
            if (found != state->notifications.end() && found->second.lifecycle == provisional->lifecycle) {
              state->notifications.erase(found);
            }
          } else {
            // The provisional map entry remains the retryable native owner.
            cleanup_failures.push_back("notification provisional rollback incomplete");
          }
        } else {
          ContinueWinRtTeardown(cleanup_failures, "notification listener release before ownership publication", [&] { listener->Release(); });
        }
        if (!cleanup_failures.empty()) {
          ThrowWinRtCleanupFailures("WinRT notification start rollback", cleanup_failures);
        }
        throw;
      }
    }, ToJsVoid);
  }

  Napi::Value StopNotify(const Napi::CallbackInfo& info) {
    const CharacteristicAddress address = ReadCharacteristicAddress(info[0]);
    const std::shared_ptr<BoundaryState> state = state_;
    return StartOperation<VoidResult>(info.Env(), [state, address] {
      const std::string key = CharacteristicKey(address);
      std::optional<NotificationEntry> notification;
      {
        std::lock_guard<std::mutex> guard(state->mutex);
        const auto found = state->notifications.find(key);
        if (found == state->notifications.end()) return VoidResult{};
        notification.emplace(found->second);
      }
      std::vector<std::string> cleanup_failures;
      const bool cleanup_complete = CleanupNotificationEntry(*notification, cleanup_failures, true);
      if (!cleanup_complete || !cleanup_failures.empty()) {
        ThrowWinRtCleanupFailures("WinRT notification stop", cleanup_failures);
      }
      {
        std::lock_guard<std::mutex> guard(state->mutex);
        const auto found = state->notifications.find(key);
        if (found != state->notifications.end() && found->second.lifecycle == notification->lifecycle) {
          state->notifications.erase(found);
        }
      }
      return VoidResult{};
    }, ToJsVoid);
  }

  Napi::Value OnConnectionLost(const Napi::CallbackInfo& info) {
    return AddListener<ConnectionLossListener>(info, state_->connection_listeners, "winrt-connection-loss");
  }

  Napi::Value OnDatabaseChanged(const Napi::CallbackInfo& info) {
    return AddListener<DatabaseListener>(info, state_->database_listeners, "winrt-database-changed");
  }

  Napi::Value OnAdapterState(const Napi::CallbackInfo& info) {
    return AddListener<AdapterListener>(info, state_->adapter_listeners, "winrt-adapter-state");
  }

  Napi::Value OnScanTerminal(const Napi::CallbackInfo& info) {
    return AddListener<ScanTerminalListener>(info, state_->scan_terminal_listeners, "winrt-scan-terminal");
  }

  Napi::Value IngressTelemetrySnapshot(const Napi::CallbackInfo& info) {
    const std::shared_ptr<IngressTelemetry> telemetry = state_->ingress_telemetry;
    Napi::Object result = Napi::Object::New(info.Env());
    result.Set("notificationQueueDrops", Napi::Number::New(info.Env(), static_cast<double>(telemetry->notification_queue_drops.load())));
    result.Set("advertisementQueueDrops", Napi::Number::New(info.Env(), static_cast<double>(telemetry->advertisement_queue_drops.load())));
    result.Set("notificationCloseDrops", Napi::Number::New(info.Env(), static_cast<double>(telemetry->notification_close_drops.load())));
    result.Set("advertisementCloseDrops", Napi::Number::New(info.Env(), static_cast<double>(telemetry->advertisement_close_drops.load())));
    return result;
  }

  Napi::Value Destroy(const Napi::CallbackInfo& info) {
    const std::shared_ptr<BoundaryState> state = state_;
    return StartOperation<VoidResult>(info.Env(), [state] { state->Destroy(); return VoidResult{}; }, ToJsVoid);
  }

  template <typename Listener>
  Napi::Value AddListener(const Napi::CallbackInfo& info, std::vector<std::shared_ptr<Listener>>& listeners, const char* resource_name) {
    if (info.Length() != 1 || !info[0].IsFunction()) throw Napi::TypeError::New(info.Env(), "WinRT event registration requires a callback");
    Napi::ThreadSafeFunction function;
    try {
      function = Napi::ThreadSafeFunction::New(info.Env(), info[0].As<Napi::Function>(), resource_name, kControlIngressQueueCapacity, 1);
    } catch (const std::exception& error) {
      ReportWinRtDelegateFailure("WinRT listener creation", error);
      throw;
    } catch (...) {
      ReportWinRtDelegateFailure("WinRT listener creation");
      throw;
    }
    std::shared_ptr<Listener> listener;
    try {
      listener = std::make_shared<Listener>(function);
    } catch (const std::exception& error) {
      function.Release();
      ReportWinRtDelegateFailure("WinRT listener creation", error);
      throw;
    } catch (...) {
      function.Release();
      ReportWinRtDelegateFailure("WinRT listener creation");
      throw;
    }
    const std::shared_ptr<BoundaryState> state = state_;
    Napi::Function remove_listener;
    try {
      remove_listener = Napi::Function::New(info.Env(), [state, listener](const Napi::CallbackInfo& callback) {
        std::lock_guard<std::mutex> guard(state->mutex);
        auto erase_from = [listener](auto& entries) {
          entries.erase(std::remove(entries.begin(), entries.end(), listener), entries.end());
        };
        if constexpr (std::is_same_v<Listener, ConnectionLossListener>) erase_from(state->connection_listeners);
        if constexpr (std::is_same_v<Listener, DatabaseListener>) erase_from(state->database_listeners);
        if constexpr (std::is_same_v<Listener, AdapterListener>) erase_from(state->adapter_listeners);
        if constexpr (std::is_same_v<Listener, ScanTerminalListener>) erase_from(state->scan_terminal_listeners);
        listener->Release();
        return callback.Env().Undefined();
      });
    } catch (const std::exception& error) {
      listener->Release();
      ReportWinRtDelegateFailure("WinRT listener removal function creation", error);
      throw;
    } catch (...) {
      listener->Release();
      ReportWinRtDelegateFailure("WinRT listener removal function creation");
      throw;
    }
    {
      try {
        std::lock_guard<std::mutex> guard(state->mutex);
        if (state->destroying || state->destroyed) {
          listener->Release();
          throw Napi::Error::New(info.Env(), "The WinRT native boundary has been destroyed or is tearing down");
        }
        listeners.push_back(listener);
      } catch (const std::exception& error) {
        listener->Release();
        ReportWinRtDelegateFailure("WinRT listener registration", error);
        throw;
      } catch (...) {
        listener->Release();
        ReportWinRtDelegateFailure("WinRT listener registration");
        throw;
      }
    }
    return remove_listener;
  }

  std::shared_ptr<BoundaryState> state_;
};

Napi::FunctionReference WinRtContractBoundary::constructor;

Napi::Value CreateContractBoundary(const Napi::CallbackInfo& info) {
  return WinRtContractBoundary::constructor.New({});
}

Napi::Object Initialize(Napi::Env env, Napi::Object exports) {
  WinRtContractBoundary::Init(env, exports);
  exports.Set("boundaryVersion", Napi::Number::New(env, 2));
  exports.Set("createContractBoundary", Napi::Function::New(env, CreateContractBoundary));
  return exports;
}

}  // namespace

NODE_API_MODULE(unified_ble_winrt, Initialize)
