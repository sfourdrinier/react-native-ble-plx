// native/electron/winrt/src/winrt-boundary.inc

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
    state_->Destroy();
  }

 private:
  Napi::Value ListAdapters(const Napi::CallbackInfo& info) {
    return StartOperation<std::vector<AdapterView>>(info.Env(), [] {
      const AdapterView adapter = ReadAdapter();
      return adapter.native_id.empty() ? std::vector<AdapterView>{} : std::vector<AdapterView>{adapter};
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
      const AdapterView adapter = ReadAdapter();
      if (adapter.native_id != requested) throw std::runtime_error("The selected Windows Bluetooth adapter is unavailable");
      const BluetoothAdapter native_adapter = AwaitWinRt(BluetoothAdapter::GetDefaultAsync());
      const Radio radio = AwaitWinRt(native_adapter.GetRadioAsync());
      std::lock_guard<std::mutex> guard(state->mutex);
      if (state->destroyed) throw std::runtime_error("The WinRT native boundary has been destroyed");
      state->selected_adapter = requested;
      state->radio = radio;
      const std::weak_ptr<BoundaryState> weak_state = state;
      state->radio_token = radio.StateChanged([weak_state](const Radio&, const winrt::Windows::Foundation::IInspectable&) {
        if (const std::shared_ptr<BoundaryState> live_state = weak_state.lock()) live_state->EmitAdapterState();
      });
      return VoidResult{};
    }, ToJsVoid);
  }

  Napi::Value AdapterSnapshot(const Napi::CallbackInfo& info) {
    try {
      return ToJsAdapterState(info.Env(), ReadAdapter());
    } catch (const winrt::hresult_error& error) {
      return ToJsAdapterState(info.Env(), {"", "", "unavailable", "unavailable", "unknown", ToUtf8(error.message()), "not-applicable", IsPackagedProcess() ? "packaged" : "unpackaged"});
    } catch (const std::exception& error) {
      return ToJsAdapterState(info.Env(), {"", "", "unavailable", "unavailable", "unknown", error.what(), "not-applicable", IsPackagedProcess() ? "packaged" : "unpackaged"});
    }
  }

  Napi::Value StartScan(const Napi::CallbackInfo& info) {
    if (info.Length() != 2 || !info[0].IsArray() || !info[1].IsFunction()) throw Napi::TypeError::New(info.Env(), "WinRT scan requires service UUIDs and an advertisement callback");
    std::vector<std::string> service_uuids;
    const Napi::Array requested = info[0].As<Napi::Array>();
    for (uint32_t index = 0; index < requested.Length(); ++index) {
      if (!requested.Get(index).IsString()) throw Napi::TypeError::New(info.Env(), "WinRT scan service UUIDs must be strings");
      service_uuids.push_back(requested.Get(index).As<Napi::String>().Utf8Value());
    }
    const std::shared_ptr<BoundaryState> state = state_;
    const std::shared_ptr<AdvertisementListener> listener = std::make_shared<AdvertisementListener>(
        Napi::ThreadSafeFunction::New(info.Env(), info[1].As<Napi::Function>(), "winrt-advertisement", kAdvertisementIngressQueueCapacity, 1),
        state->ingress_telemetry);
    return StartOperation<VoidResult>(info.Env(), [state, service_uuids, listener] {
      EnsureWinRtApartment();
      BluetoothLEAdvertisementWatcher watcher;
      for (const std::string& service_uuid : service_uuids) watcher.AdvertisementFilter().Advertisement().ServiceUuids().Append(ParseUuid(service_uuid));
      const std::weak_ptr<BoundaryState> weak_state = state;
      const winrt::event_token received_token = watcher.Received([weak_state, listener](const BluetoothLEAdvertisementWatcher&, const BluetoothLEAdvertisementReceivedEventArgs& event) {
        if (weak_state.expired()) return;
        const auto advertisement = event.Advertisement();
        const std::string peer = AddressKey(event.BluetoothAddress());
        const std::string name = ToUtf8(advertisement.LocalName());
        std::vector<std::string> services;
        for (const winrt::guid& uuid : advertisement.ServiceUuids()) services.push_back(CanonicalUuid(uuid));
        listener->Emit(peer, name, event.RawSignalStrengthInDBm(), std::move(services));
      });
      std::lock_guard<std::mutex> guard(state->mutex);
      if (state->destroyed || state->scan.has_value()) throw std::runtime_error("A WinRT physical scan is already active or destroyed");
      watcher.Start();
      state->scan = ScanEntry{watcher, received_token, listener};
      return VoidResult{};
    }, ToJsVoid);
  }

  Napi::Value StopScan(const Napi::CallbackInfo& info) {
    const std::shared_ptr<BoundaryState> state = state_;
    return StartOperation<VoidResult>(info.Env(), [state] { state->StopScan(); return VoidResult{}; }, ToJsVoid);
  }

  Napi::Value Connect(const Napi::CallbackInfo& info) {
    if (info.Length() != 1 || !info[0].IsString()) throw Napi::TypeError::New(info.Env(), "WinRT connect requires a native peer identifier");
    const std::string peer = info[0].As<Napi::String>().Utf8Value();
    const std::shared_ptr<BoundaryState> state = state_;
    return StartOperation<VoidResult>(info.Env(), [state, peer] {
      EnsureWinRtApartment();
      const BluetoothLEDevice device = AwaitWinRt(BluetoothLEDevice::FromBluetoothAddressAsync(ParseAddress(peer)));
      if (device == nullptr) throw std::runtime_error("Windows could not open the selected BLE peer");
      const GattSession session = AwaitWinRt(GattSession::FromDeviceIdAsync(device.BluetoothDeviceId()));
      if (session == nullptr) throw std::runtime_error("Windows could not open a GATT session for the selected BLE peer");
      bool handlers_registered = false;
      bool connection_registered = false;
      winrt::event_token connection_token{};
      winrt::event_token session_token{};
      try {
        ThrowIfCurrentOperationWasCancelled();
        session.MaintainConnection(true);
        const auto confirmation = AwaitWinRt(device.GetGattServicesAsync(winrt::Windows::Devices::Bluetooth::BluetoothCacheMode::Uncached));
        RequireSuccess(confirmation.Status(), "WinRT connection confirmation");
        ThrowIfCurrentOperationWasCancelled();
        if (device.ConnectionStatus() != BluetoothConnectionStatus::Connected) {
          throw std::runtime_error("Windows did not confirm an active BLE link after GATT connection probing");
        }
        const std::weak_ptr<BoundaryState> weak_state = state;
        connection_token = device.ConnectionStatusChanged([weak_state, peer](const BluetoothLEDevice& source, const winrt::Windows::Foundation::IInspectable&) {
          if (source.ConnectionStatus() == BluetoothConnectionStatus::Disconnected) {
            if (const std::shared_ptr<BoundaryState> live_state = weak_state.lock()) {
              live_state->RemoveConnection(peer);
              live_state->EmitConnectionLoss(peer, std::string("Windows reported BLE link loss"));
            }
          }
        });
        session_token = session.SessionStatusChanged([weak_state, peer](const GattSession& source, const winrt::Windows::Foundation::IInspectable&) {
          if (source.SessionStatus() == GattSessionStatus::Closed) {
            if (const std::shared_ptr<BoundaryState> live_state = weak_state.lock()) {
              live_state->EmitDatabaseChanged(peer);
              live_state->RemoveConnection(peer);
              live_state->EmitConnectionLoss(peer, std::string("Windows reported GATT session loss"));
            }
          }
        });
        handlers_registered = true;
        {
          std::lock_guard<std::mutex> guard(state->mutex);
          if (state->destroyed || state->connections.contains(peer)) {
            throw std::runtime_error("The WinRT peer connection is no longer admissible");
          }
          state->connections.emplace(peer, std::make_shared<ConnectionEntry>(device, session, connection_token, session_token));
          connection_registered = true;
        }
        if (device.ConnectionStatus() != BluetoothConnectionStatus::Connected) {
          state->RemoveConnection(peer);
          connection_registered = false;
          handlers_registered = false;
          throw std::runtime_error("Windows lost the BLE link while finalizing the confirmed connection");
        }
        return VoidResult{};
      } catch (...) {
        if (connection_registered) {
          state->RemoveConnection(peer);
        } else {
          if (handlers_registered) {
            device.ConnectionStatusChanged(connection_token);
            session.SessionStatusChanged(session_token);
          }
          session.MaintainConnection(false);
          session.Close();
          device.Close();
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
      const auto services_result = AwaitWinRt(connection->device.GetGattServicesAsync(winrt::Windows::Devices::Bluetooth::BluetoothCacheMode::Uncached));
      RequireSuccess(services_result.Status(), "Gatt service discovery");
      std::vector<ServiceEntry> services;
      DiscoveryView view;
      std::unordered_map<std::string, uint32_t> service_occurrences;
      for (const GattDeviceService& native_service : services_result.Services()) {
        const std::string service_uuid = CanonicalUuid(native_service.Uuid());
        ServiceEntry service{service_uuid, service_occurrences[service_uuid]++, native_service, {}};
        ServiceView service_view{service.uuid, service.occurrence, {}};
        const auto characteristics_result = AwaitWinRt(native_service.GetCharacteristicsAsync(winrt::Windows::Devices::Bluetooth::BluetoothCacheMode::Uncached));
        RequireSuccess(characteristics_result.Status(), "Gatt characteristic discovery");
        std::unordered_map<std::string, uint32_t> characteristic_occurrences;
        for (const GattCharacteristic& native_characteristic : characteristics_result.Characteristics()) {
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
          for (const GattDescriptor& native_descriptor : descriptors_result.Descriptors()) {
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
        std::lock_guard<std::mutex> gatt_guard(connection->gatt_mutex);
        connection->services = std::move(services);
      }
      {
        std::lock_guard<std::mutex> state_guard(state->mutex);
        if (state->destroyed || !state->connections.contains(peer)) {
          throw std::runtime_error("The WinRT connection was lost during discovery");
        }
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
      std::shared_ptr<ConnectionEntry> connection = RequiredConnection(state, address.peer);
      GattCharacteristic characteristic;
      winrt::event_token token{};
      {
        std::lock_guard<std::mutex> gatt_guard(connection->gatt_mutex);
        CharacteristicEntry& entry = RequiredCharacteristic(*connection, address);
        characteristic = entry.characteristic;
        const GattClientCharacteristicConfigurationDescriptorValue cccd = mode == "indicate"
            ? GattClientCharacteristicConfigurationDescriptorValue::Indicate
            : GattClientCharacteristicConfigurationDescriptorValue::Notify;
        token = characteristic.ValueChanged([listener](const GattCharacteristic&, const winrt::Windows::Devices::Bluetooth::GenericAttributeProfile::GattValueChangedEventArgs& event) {
          listener->Emit(BufferBytes(event.CharacteristicValue()));
        });
        try {
          RequireSuccess(AwaitWinRt(characteristic.WriteClientCharacteristicConfigurationDescriptorAsync(cccd)), "Gatt CCCD enable");
        } catch (...) {
          characteristic.ValueChanged(token);
          listener->Release();
          throw;
        }
      }
      const std::string key = CharacteristicKey(address);
      bool requires_rollback = false;
      {
        std::lock_guard<std::mutex> state_guard(state->mutex);
        if (state->destroyed || state->notifications.contains(key)) {
          requires_rollback = true;
        } else {
          state->notifications.emplace(key, NotificationEntry{characteristic, token, listener});
        }
      }
      if (requires_rollback) {
        try {
          std::lock_guard<std::mutex> gatt_guard(connection->gatt_mutex);
          RequireSuccess(
              AwaitWinRt(characteristic.WriteClientCharacteristicConfigurationDescriptorAsync(
                  GattClientCharacteristicConfigurationDescriptorValue::None)),
              "Gatt CCCD rollback");
        } catch (...) {
          characteristic.ValueChanged(token);
          listener->Release();
          throw;
        }
        characteristic.ValueChanged(token);
        listener->Release();
        throw std::runtime_error("The WinRT notification subscription is no longer admissible");
      }
      return VoidResult{};
    }, ToJsVoid);
  }

  Napi::Value StopNotify(const Napi::CallbackInfo& info) {
    const CharacteristicAddress address = ReadCharacteristicAddress(info[0]);
    const std::shared_ptr<BoundaryState> state = state_;
    return StartOperation<VoidResult>(info.Env(), [state, address] {
      const std::string key = CharacteristicKey(address);
      NotificationEntry notification;
      {
        std::lock_guard<std::mutex> guard(state->mutex);
        const auto found = state->notifications.find(key);
        if (found == state->notifications.end()) return VoidResult{};
        notification = found->second;
      }
      RequireSuccess(AwaitWinRt(notification.characteristic.WriteClientCharacteristicConfigurationDescriptorAsync(GattClientCharacteristicConfigurationDescriptorValue::None)), "Gatt CCCD disable");
      notification.characteristic.ValueChanged(notification.value_token);
      {
        std::lock_guard<std::mutex> guard(state->mutex);
        state->notifications.erase(key);
      }
      notification.listener->Release();
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
    const std::shared_ptr<Listener> listener = std::make_shared<Listener>(Napi::ThreadSafeFunction::New(info.Env(), info[0].As<Napi::Function>(), resource_name, kControlIngressQueueCapacity, 1));
    const std::shared_ptr<BoundaryState> state = state_;
    {
      std::lock_guard<std::mutex> guard(state->mutex);
      if (state->destroyed) {
        listener->Release();
        throw Napi::Error::New(info.Env(), "The WinRT native boundary has been destroyed");
      }
      listeners.push_back(listener);
    }
    return Napi::Function::New(info.Env(), [state, listener](const Napi::CallbackInfo& callback) {
      std::lock_guard<std::mutex> guard(state->mutex);
      auto erase_from = [listener](auto& entries) {
        entries.erase(std::remove(entries.begin(), entries.end(), listener), entries.end());
      };
      if constexpr (std::is_same_v<Listener, ConnectionLossListener>) erase_from(state->connection_listeners);
      if constexpr (std::is_same_v<Listener, DatabaseListener>) erase_from(state->database_listeners);
      if constexpr (std::is_same_v<Listener, AdapterListener>) erase_from(state->adapter_listeners);
      listener->Release();
      return callback.Env().Undefined();
    });
  }

  std::shared_ptr<BoundaryState> state_;
};

Napi::FunctionReference WinRtContractBoundary::constructor;

Napi::Value CreateContractBoundary(const Napi::CallbackInfo& info) {
  return WinRtContractBoundary::constructor.New({});
}

Napi::Object Initialize(Napi::Env env, Napi::Object exports) {
  WinRtContractBoundary::Init(env, exports);
  exports.Set("nativeProtocolVersion", Napi::Number::New(env, 1));
  exports.Set("createContractBoundary", Napi::Function::New(env, CreateContractBoundary));
  return exports;
}

}  // namespace

NODE_API_MODULE(unified_ble_winrt, Initialize)
