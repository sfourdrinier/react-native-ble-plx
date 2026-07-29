// native/electron/winrt/src/addon.cpp

#include <napi.h>
#include <windows.h>
#include <winrt/Windows.Devices.Bluetooth.h>
#include <winrt/Windows.Devices.Bluetooth.Advertisement.h>
#include <winrt/Windows.Devices.Bluetooth.GenericAttributeProfile.h>
#include <winrt/Windows.Devices.Radios.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Security.Cryptography.h>
#include <winrt/Windows.Storage.Streams.h>
#include <winrt/base.h>

#include <algorithm>
#include <atomic>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <unordered_map>
#include <utility>
#include <vector>

namespace {

using winrt::Windows::Devices::Bluetooth::BluetoothAdapter;
using winrt::Windows::Devices::Bluetooth::BluetoothConnectionStatus;
using winrt::Windows::Devices::Bluetooth::BluetoothLEDevice;
using winrt::Windows::Devices::Bluetooth::Advertisement::BluetoothLEAdvertisementReceivedEventArgs;
using winrt::Windows::Devices::Bluetooth::Advertisement::BluetoothLEAdvertisementWatcher;
using winrt::Windows::Devices::Bluetooth::GenericAttributeProfile::GattCharacteristic;
using winrt::Windows::Devices::Bluetooth::GenericAttributeProfile::GattCharacteristicProperties;
using winrt::Windows::Devices::Bluetooth::GenericAttributeProfile::GattClientCharacteristicConfigurationDescriptorValue;
using winrt::Windows::Devices::Bluetooth::GenericAttributeProfile::GattCommunicationStatus;
using winrt::Windows::Devices::Bluetooth::GenericAttributeProfile::GattDescriptor;
using winrt::Windows::Devices::Bluetooth::GenericAttributeProfile::GattDeviceService;
using winrt::Windows::Devices::Bluetooth::GenericAttributeProfile::GattSession;
using winrt::Windows::Devices::Bluetooth::GenericAttributeProfile::GattSessionStatus;
using winrt::Windows::Devices::Bluetooth::GenericAttributeProfile::GattWriteOption;
using winrt::Windows::Devices::Radios::Radio;
using winrt::Windows::Devices::Radios::RadioState;
using winrt::Windows::Security::Cryptography::CryptographicBuffer;
using winrt::Windows::Storage::Streams::DataReader;

void EnsureWinRtApartment() {
  winrt::init_apartment(winrt::apartment_type::multi_threaded);
}

std::string ToUtf8(const winrt::hstring& value) {
  return winrt::to_string(value);
}

std::string CanonicalUuid(const winrt::guid& value) {
  std::string text = winrt::to_string(value);
  if (text.size() == 38 && text.front() == '{' && text.back() == '}') {
    text = text.substr(1, text.size() - 2);
  }
  std::transform(text.begin(), text.end(), text.begin(), [](unsigned char character) {
    return static_cast<char>(std::tolower(character));
  });
  return text;
}

winrt::guid ParseUuid(const std::string& text) {
  return winrt::guid{winrt::to_hstring(text)};
}

std::string AddressKey(uint64_t address) {
  std::ostringstream stream;
  stream << std::hex << std::uppercase << address;
  return stream.str();
}

uint64_t ParseAddress(const std::string& address) {
  std::size_t parsed = 0;
  const uint64_t value = std::stoull(address, &parsed, 16);
  if (parsed != address.size() || value > 0xFFFFFFFFFFFFULL) {
    throw std::runtime_error("The WinRT peer identifier is not a Bluetooth address");
  }
  return value;
}

bool IsPackagedProcess() {
  UINT32 full_name_length = 0;
  return GetCurrentPackageFullName(&full_name_length, nullptr) == ERROR_INSUFFICIENT_BUFFER;
}

std::string RadioPower(const Radio& radio) {
  switch (radio.State()) {
    case RadioState::On:
      return "on";
    case RadioState::Off:
    case RadioState::Disabled:
      return "off";
    default:
      return "unknown";
  }
}

struct AdapterView {
  std::string native_id;
  std::string display_name;
  std::string availability;
  std::string authorization;
  std::string power;
  std::optional<std::string> safe_reason;
  std::string deployment;
};

AdapterView ReadAdapter() {
  EnsureWinRtApartment();
  const BluetoothAdapter adapter = BluetoothAdapter::GetDefaultAsync().get();
  if (adapter == nullptr) {
    return {"", "", "unavailable", "unavailable", "unknown", "No Windows Bluetooth adapter is available", IsPackagedProcess() ? "packaged" : "unpackaged"};
  }
  const Radio radio = adapter.GetRadioAsync().get();
  return {
      ToUtf8(adapter.DeviceId()),
      "Windows Bluetooth Adapter",
      "available",
      "granted",
      RadioPower(radio),
      std::nullopt,
      IsPackagedProcess() ? "packaged" : "unpackaged"};
}

Napi::Object ToJsAdapterState(Napi::Env env, const AdapterView& view) {
  Napi::Object state = Napi::Object::New(env);
  state.Set("availability", Napi::String::New(env, view.availability));
  state.Set("authorization", Napi::String::New(env, view.authorization));
  state.Set("power", Napi::String::New(env, view.power));
  state.Set("safeReason", view.safe_reason.has_value() ? Napi::String::New(env, *view.safe_reason) : env.Null());
  return state;
}

Napi::Object ToJsAdapter(Napi::Env env, const AdapterView& view) {
  Napi::Object record = Napi::Object::New(env);
  record.Set("nativeAdapterId", Napi::String::New(env, view.native_id));
  record.Set("displayName", view.display_name.empty() ? env.Null() : Napi::String::New(env, view.display_name));
  record.Set("state", ToJsAdapterState(env, view));
  record.Set("deployment", Napi::String::New(env, view.deployment));
  return record;
}

struct OperationStatus {
  std::atomic_bool terminal{false};
  std::atomic_bool cancellation_requested{false};
  std::mutex cancellation_mutex;
  std::function<void()> cancel_native;
};

thread_local std::shared_ptr<OperationStatus> current_operation_status;

void ThrowIfCurrentOperationWasCancelled() {
  if (current_operation_status != nullptr && current_operation_status->cancellation_requested.load()) {
    throw std::runtime_error("The WinRT native operation was cancelled");
  }
}

template <typename Result>
Result AwaitWinRt(const winrt::Windows::Foundation::IAsyncOperation<Result>& operation) {
  const std::shared_ptr<OperationStatus> status = current_operation_status;
  if (status == nullptr) {
    return operation.get();
  }
  std::function<void()> cancellation;
  {
    std::lock_guard<std::mutex> guard(status->cancellation_mutex);
    status->cancel_native = [operation] { operation.Cancel(); };
    if (status->cancellation_requested.load()) cancellation = status->cancel_native;
  }
  if (cancellation) cancellation();
  try {
    Result result = operation.get();
    std::lock_guard<std::mutex> guard(status->cancellation_mutex);
    status->cancel_native = nullptr;
    return result;
  } catch (...) {
    std::lock_guard<std::mutex> guard(status->cancellation_mutex);
    status->cancel_native = nullptr;
    throw;
  }
}

template <typename Result>
class PromiseWorker final : public Napi::AsyncWorker {
 public:
  PromiseWorker(
      Napi::Env env,
      std::shared_ptr<OperationStatus> status,
      std::function<Result()> execute,
      std::function<Napi::Value(Napi::Env, const Result&)> to_js)
      : Napi::AsyncWorker(env),
        deferred_(Napi::Promise::Deferred::New(env)),
        status_(std::move(status)),
        execute_(std::move(execute)),
        to_js_(std::move(to_js)) {}

  Napi::Promise Promise() const {
    return deferred_.Promise();
  }

  void Execute() override {
    try {
      EnsureWinRtApartment();
      current_operation_status = status_;
      result_ = execute_();
      status_->terminal.store(true);
    } catch (const winrt::hresult_error& error) {
      status_->terminal.store(true);
      SetError(ToUtf8(error.message()));
    } catch (const std::exception& error) {
      status_->terminal.store(true);
      SetError(error.what());
    }
    current_operation_status.reset();
  }

  void OnOK() override {
    status_->terminal.store(true);
    deferred_.Resolve(to_js_(Env(), *result_));
  }

  void OnError(const Napi::Error& error) override {
    status_->terminal.store(true);
    deferred_.Reject(error.Value());
  }

 private:
  Napi::Promise::Deferred deferred_;
  std::shared_ptr<OperationStatus> status_;
  std::function<Result()> execute_;
  std::function<Napi::Value(Napi::Env, const Result&)> to_js_;
  std::optional<Result> result_;
};

template <typename Result>
Napi::Object StartOperation(
    Napi::Env env,
    std::function<Result()> execute,
    std::function<Napi::Value(Napi::Env, const Result&)> to_js) {
  const std::shared_ptr<OperationStatus> status = std::make_shared<OperationStatus>();
  auto* worker = new PromiseWorker<Result>(env, status, std::move(execute), std::move(to_js));
  Napi::Object operation = Napi::Object::New(env);
  operation.Set("completion", worker->Promise());
  operation.Set("cancel", Napi::Function::New(env, [status](const Napi::CallbackInfo& info) {
    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(info.Env());
    if (status->terminal.load()) {
      deferred.Resolve(Napi::String::New(info.Env(), "already-terminal"));
      return deferred.Promise();
    }
    try {
      std::lock_guard<std::mutex> guard(status->cancellation_mutex);
      status->cancellation_requested.store(true);
      if (!status->cancel_native) {
        deferred.Resolve(Napi::String::New(info.Env(), "cancellation-requested"));
        return deferred.Promise();
      }
      status->cancel_native();
      deferred.Resolve(Napi::String::New(info.Env(), "cancellation-requested"));
    } catch (const std::exception& error) {
      deferred.Reject(Napi::Error::New(info.Env(), error.what()).Value());
    }
    return deferred.Promise();
  }));
  worker->Queue();
  return operation;
}

struct VoidResult {};

Napi::Value ToJsVoid(Napi::Env env, const VoidResult&) {
  return env.Undefined();
}

std::vector<uint8_t> BufferBytes(const winrt::Windows::Storage::Streams::IBuffer& buffer) {
  DataReader reader = DataReader::FromBuffer(buffer);
  winrt::com_array<uint8_t> bytes(buffer.Length());
  reader.ReadBytes(bytes);
  return {bytes.begin(), bytes.end()};
}

winrt::Windows::Storage::Streams::IBuffer ToBuffer(const std::vector<uint8_t>& bytes) {
  return CryptographicBuffer::CreateFromByteArray(bytes);
}

void RequireSuccess(GattCommunicationStatus status, const char* operation) {
  if (status != GattCommunicationStatus::Success) {
    throw std::runtime_error(std::string(operation) + " was rejected by the Windows GATT stack");
  }
}

struct CharacteristicAddress {
  std::string peer;
  std::string service_uuid;
  uint32_t service_occurrence;
  std::string characteristic_uuid;
  uint32_t characteristic_occurrence;
};

struct DescriptorAddress : CharacteristicAddress {
  std::string descriptor_uuid;
  uint32_t descriptor_occurrence;
};

std::string RequiredString(const Napi::Object& object, const char* field) {
  const Napi::Value value = object.Get(field);
  if (!value.IsString()) {
    throw std::runtime_error(std::string("WinRT boundary address is missing string field ") + field);
  }
  return value.As<Napi::String>().Utf8Value();
}

uint32_t RequiredOccurrence(const Napi::Object& object, const char* field) {
  const Napi::Value value = object.Get(field);
  if (!value.IsNumber()) {
    throw std::runtime_error(std::string("WinRT boundary address is missing number field ") + field);
  }
  const double raw = value.As<Napi::Number>().DoubleValue();
  if (raw < 0 || raw != std::floor(raw) || raw > static_cast<double>(UINT32_MAX)) {
    throw std::runtime_error(std::string("WinRT boundary occurrence is invalid: ") + field);
  }
  return static_cast<uint32_t>(raw);
}

CharacteristicAddress ReadCharacteristicAddress(const Napi::Value& value) {
  if (!value.IsObject()) {
    throw std::runtime_error("WinRT characteristic address must be an object");
  }
  const Napi::Object object = value.As<Napi::Object>();
  return {
      RequiredString(object, "nativePeerId"),
      RequiredString(object, "serviceUuid"),
      RequiredOccurrence(object, "serviceOccurrence"),
      RequiredString(object, "characteristicUuid"),
      RequiredOccurrence(object, "characteristicOccurrence")};
}

DescriptorAddress ReadDescriptorAddress(const Napi::Value& value) {
  if (!value.IsObject()) {
    throw std::runtime_error("WinRT descriptor address must be an object");
  }
  const Napi::Object object = value.As<Napi::Object>();
  CharacteristicAddress characteristic = ReadCharacteristicAddress(value);
  return {
      {characteristic.peer,
       characteristic.service_uuid,
       characteristic.service_occurrence,
       characteristic.characteristic_uuid,
       characteristic.characteristic_occurrence},
      RequiredString(object, "descriptorUuid"),
      RequiredOccurrence(object, "descriptorOccurrence")};
}

std::vector<uint8_t> ReadBytesArgument(const Napi::Value& value) {
  if (!value.IsTypedArray()) {
    throw std::runtime_error("WinRT GATT write requires a Uint8Array");
  }
  const Napi::TypedArray typed = value.As<Napi::TypedArray>();
  if (typed.TypedArrayType() != napi_uint8_array) {
    throw std::runtime_error("WinRT GATT write requires a Uint8Array");
  }
  const Napi::Uint8Array bytes = value.As<Napi::Uint8Array>();
  const uint8_t* start = bytes.Data();
  return {start, start + bytes.ElementLength()};
}

constexpr std::size_t kNotificationIngressQueueCapacity = 128U;
constexpr std::size_t kAdvertisementIngressQueueCapacity = 256U;
constexpr std::size_t kControlIngressQueueCapacity = 32U;

enum class IngressChannel { notification, advertisement };

struct IngressTelemetry {
  std::atomic_uint64_t notification_queue_drops{0U};
  std::atomic_uint64_t advertisement_queue_drops{0U};
  std::atomic_uint64_t notification_close_drops{0U};
  std::atomic_uint64_t advertisement_close_drops{0U};
};

class ListenerLifecycle {
 public:
  explicit ListenerLifecycle(
      Napi::ThreadSafeFunction function,
      std::shared_ptr<IngressTelemetry> telemetry = nullptr,
      std::optional<IngressChannel> channel = std::nullopt)
      : function_(std::move(function)), telemetry_(std::move(telemetry)), channel_(channel) {}

  void Release() {
    bool expected = false;
    if (released_.compare_exchange_strong(expected, true)) {
      function_.Release();
    }
  }

 protected:
  Napi::ThreadSafeFunction function_;

  void NoteIngressRejection(napi_status status) const {
    if (!telemetry_ || !channel.has_value()) return;
    std::atomic_uint64_t& counter = status == napi_closing
        ? (*channel == IngressChannel::notification ? telemetry_->notification_close_drops : telemetry_->advertisement_close_drops)
        : (*channel == IngressChannel::notification ? telemetry_->notification_queue_drops : telemetry_->advertisement_queue_drops);
    const uint64_t total = counter.fetch_add(1U) + 1U;
    if (status != napi_closing && (total == 1U || (total & (total - 1U)) == 0U)) {
      std::fprintf(stderr, "[unified_ble_winrt] bounded %s ingress dropped %llu payloads (napi status %d)\n",
                   *channel == IngressChannel::notification ? "notification" : "advertisement",
                   static_cast<unsigned long long>(total), static_cast<int>(status));
    }
  }

 private:
  std::atomic_bool released_{false};
  std::shared_ptr<IngressTelemetry> telemetry_;
  std::optional<IngressChannel> channel_;
};

struct NotificationPayload {
  std::vector<uint8_t> bytes;
};

class NotificationListener final : public ListenerLifecycle {
 public:
  explicit NotificationListener(Napi::ThreadSafeFunction function, std::shared_ptr<IngressTelemetry> telemetry)
      : ListenerLifecycle(std::move(function), std::move(telemetry), IngressChannel::notification) {}

  void Emit(std::vector<uint8_t> bytes) {
    auto* payload = new NotificationPayload{std::move(bytes)};
    const napi_status status = function_.NonBlockingCall(payload, [](Napi::Env env, Napi::Function callback, NotificationPayload* value) {
      std::unique_ptr<NotificationPayload> owned(value);
      Napi::Uint8Array bytes = Napi::Uint8Array::New(env, value->bytes.size());
      std::copy(value->bytes.begin(), value->bytes.end(), bytes.Data());
      callback.Call({bytes});
    });
    if (status != napi_ok) {
      delete payload;
      NoteIngressRejection(status);
    }
  }
};

struct AdvertisementPayload {
  std::string peer;
  std::string name;
  int16_t rssi;
  std::vector<std::string> service_uuids;
};

class AdvertisementListener final : public ListenerLifecycle {
 public:
  explicit AdvertisementListener(Napi::ThreadSafeFunction function, std::shared_ptr<IngressTelemetry> telemetry)
      : ListenerLifecycle(std::move(function), std::move(telemetry), IngressChannel::advertisement) {}

  void Emit(std::string peer, std::string name, int16_t rssi, std::vector<std::string> service_uuids) {
    auto* payload = new AdvertisementPayload{std::move(peer), std::move(name), rssi, std::move(service_uuids)};
    const napi_status status = function_.NonBlockingCall(payload, [](Napi::Env env, Napi::Function callback, AdvertisementPayload* value) {
      std::unique_ptr<AdvertisementPayload> owned(value);
      Napi::Object advertisement = Napi::Object::New(env);
      advertisement.Set("nativePeerId", Napi::String::New(env, value->peer));
      advertisement.Set("localName", value->name.empty() ? env.Null() : Napi::String::New(env, value->name));
      advertisement.Set("rssi", Napi::Number::New(env, value->rssi));
      Napi::Array service_uuids = Napi::Array::New(env, value->service_uuids.size());
      for (uint32_t index = 0; index < value->service_uuids.size(); ++index) {
        service_uuids.Set(index, Napi::String::New(env, value->service_uuids[index]));
      }
      advertisement.Set("serviceUuids", service_uuids);
      advertisement.Set("connectable", env.Null());
      callback.Call({advertisement});
    });
    if (status != napi_ok) {
      delete payload;
      NoteIngressRejection(status);
    }
  }
};

struct ConnectionLossPayload {
  std::string peer;
  std::optional<std::string> reason;
};

class ConnectionLossListener final : public ListenerLifecycle {
 public:
  explicit ConnectionLossListener(Napi::ThreadSafeFunction function) : ListenerLifecycle(std::move(function)) {}

  void Emit(const std::string& peer, const std::optional<std::string>& reason) {
    auto* payload = new ConnectionLossPayload{peer, reason};
    const napi_status status = function_.NonBlockingCall(payload, [](Napi::Env env, Napi::Function callback, ConnectionLossPayload* value) {
      callback.Call({Napi::String::New(env, value->peer), value->reason.has_value() ? Napi::String::New(env, *value->reason) : env.Null()});
      delete value;
    });
    if (status != napi_ok) {
      delete payload;
    }
  }
};

class DatabaseListener final : public ListenerLifecycle {
 public:
  explicit DatabaseListener(Napi::ThreadSafeFunction function) : ListenerLifecycle(std::move(function)) {}

  void Emit(const std::string& peer) {
    auto* payload = new std::string(peer);
    const napi_status status = function_.NonBlockingCall(payload, [](Napi::Env env, Napi::Function callback, std::string* value) {
      callback.Call({Napi::String::New(env, *value)});
      delete value;
    });
    if (status != napi_ok) {
      delete payload;
    }
  }
};

class AdapterListener final : public ListenerLifecycle {
 public:
  explicit AdapterListener(Napi::ThreadSafeFunction function) : ListenerLifecycle(std::move(function)) {}

  void Emit(const AdapterView& adapter) {
    auto* payload = new AdapterView(adapter);
    const napi_status status = function_.NonBlockingCall(payload, [](Napi::Env env, Napi::Function callback, AdapterView* value) {
      callback.Call({ToJsAdapterState(env, *value)});
      delete value;
    });
    if (status != napi_ok) {
      delete payload;
    }
  }
};

struct DescriptorEntry {
  std::string uuid;
  uint32_t occurrence;
  GattDescriptor descriptor;
};

struct CharacteristicEntry {
  std::string uuid;
  uint32_t occurrence;
  GattCharacteristic characteristic;
  std::vector<DescriptorEntry> descriptors;
};

struct ServiceEntry {
  std::string uuid;
  uint32_t occurrence;
  GattDeviceService service;
  std::vector<CharacteristicEntry> characteristics;
};

struct ConnectionEntry {
  ConnectionEntry(
      BluetoothLEDevice device_value,
      GattSession session_value,
      winrt::event_token connection_event_token,
      winrt::event_token session_event_token)
      : device(std::move(device_value)),
        session(std::move(session_value)),
        connection_token(connection_event_token),
        session_token(session_event_token) {}

  ConnectionEntry(const ConnectionEntry&) = delete;
  ConnectionEntry& operator=(const ConnectionEntry&) = delete;

  std::mutex gatt_mutex;
  BluetoothLEDevice device;
  GattSession session;
  winrt::event_token connection_token{};
  winrt::event_token session_token{};
  std::vector<ServiceEntry> services;
};

struct ScanEntry {
  BluetoothLEAdvertisementWatcher watcher;
  winrt::event_token received_token{};
  std::shared_ptr<AdvertisementListener> listener;
};

struct NotificationEntry {
  GattCharacteristic characteristic;
  winrt::event_token value_token{};
  std::shared_ptr<NotificationListener> listener;
};

struct BoundaryState : public std::enable_shared_from_this<BoundaryState> {
  std::mutex mutex;
  bool destroyed = false;
  std::string selected_adapter;
  std::optional<ScanEntry> scan;
  std::unordered_map<std::string, std::shared_ptr<ConnectionEntry>> connections;
  std::unordered_map<std::string, NotificationEntry> notifications;
  std::vector<std::shared_ptr<ConnectionLossListener>> connection_listeners;
  std::vector<std::shared_ptr<DatabaseListener>> database_listeners;
  std::vector<std::shared_ptr<AdapterListener>> adapter_listeners;
  std::shared_ptr<IngressTelemetry> ingress_telemetry = std::make_shared<IngressTelemetry>();
  std::optional<Radio> radio;
  std::optional<winrt::event_token> radio_token;

  void EmitConnectionLoss(const std::string& peer, const std::optional<std::string>& reason) {
    std::vector<std::shared_ptr<ConnectionLossListener>> listeners;
    {
      std::lock_guard<std::mutex> guard(mutex);
      listeners = connection_listeners;
    }
    for (const std::shared_ptr<ConnectionLossListener>& listener : listeners) {
      listener->Emit(peer, reason);
    }
  }

  void EmitDatabaseChanged(const std::string& peer) {
    std::vector<std::shared_ptr<DatabaseListener>> listeners;
    {
      std::lock_guard<std::mutex> guard(mutex);
      listeners = database_listeners;
    }
    for (const std::shared_ptr<DatabaseListener>& listener : listeners) {
      listener->Emit(peer);
    }
  }

  void EmitAdapterState() {
    AdapterView adapter;
    try {
      adapter = ReadAdapter();
    } catch (const std::exception& error) {
      adapter = {"", "", "unavailable", "unavailable", "unknown", error.what(), IsPackagedProcess() ? "packaged" : "unpackaged"};
    }
    std::vector<std::shared_ptr<AdapterListener>> listeners;
    {
      std::lock_guard<std::mutex> guard(mutex);
      listeners = adapter_listeners;
    }
    for (const std::shared_ptr<AdapterListener>& listener : listeners) {
      listener->Emit(adapter);
    }
  }

  void RemoveConnection(const std::string& peer) {
    std::shared_ptr<ConnectionEntry> connection;
    std::vector<std::pair<std::string, NotificationEntry>> notifications_for_peer;
    std::string peer_prefix = peer;
    peer_prefix.push_back('\0');
    {
      std::lock_guard<std::mutex> guard(mutex);
      const auto found = connections.find(peer);
      if (found == connections.end()) {
        return;
      }
      connection = found->second;
      for (const auto& entry : notifications) {
        if (entry.first.rfind(peer_prefix, 0) == 0) {
          notifications_for_peer.push_back(entry);
        }
      }
    }
    for (const auto& entry : notifications_for_peer) {
      entry.second.characteristic.ValueChanged(entry.second.value_token);
      entry.second.listener->Release();
    }
    connection->device.ConnectionStatusChanged(connection->connection_token);
    connection->session.SessionStatusChanged(connection->session_token);
    connection->session.MaintainConnection(false);
    connection->session.Close();
    connection->device.Close();
    {
      std::lock_guard<std::mutex> guard(mutex);
      for (const auto& entry : notifications_for_peer) {
        notifications.erase(entry.first);
      }
      connections.erase(peer);
    }
  }

  void StopScan() {
    std::optional<ScanEntry> entry;
    {
      std::lock_guard<std::mutex> guard(mutex);
      if (!scan.has_value()) {
        return;
      }
      entry = std::move(scan);
      scan.reset();
    }
    entry->watcher.Received(entry->received_token);
    entry->watcher.Stop();
    entry->listener->Release();
  }

  void Destroy() {
    std::vector<std::shared_ptr<ConnectionEntry>> live_connections;
    std::vector<NotificationEntry> live_notifications;
    std::optional<ScanEntry> active_scan;
    std::optional<Radio> active_radio;
    std::optional<winrt::event_token> active_radio_token;
    std::vector<std::shared_ptr<ConnectionLossListener>> loss_listeners;
    std::vector<std::shared_ptr<DatabaseListener>> changed_listeners;
    std::vector<std::shared_ptr<AdapterListener>> state_listeners;
    {
      std::lock_guard<std::mutex> guard(mutex);
      if (destroyed) {
        return;
      }
      destroyed = true;
      active_scan = std::move(scan);
      scan.reset();
      for (const auto& pair : connections) {
        live_connections.push_back(pair.second);
      }
      connections.clear();
      for (auto& pair : notifications) {
        live_notifications.push_back(std::move(pair.second));
      }
      notifications.clear();
      active_radio = std::move(radio);
      active_radio_token = radio_token;
      radio.reset();
      radio_token.reset();
      loss_listeners = std::move(connection_listeners);
      changed_listeners = std::move(database_listeners);
      state_listeners = std::move(adapter_listeners);
    }
    if (active_scan.has_value()) {
      active_scan->watcher.Received(active_scan->received_token);
      active_scan->watcher.Stop();
      active_scan->listener->Release();
    }
    if (active_radio.has_value() && active_radio_token.has_value()) {
      active_radio->StateChanged(*active_radio_token);
    }
    for (NotificationEntry& notification : live_notifications) {
      notification.characteristic.ValueChanged(notification.value_token);
      notification.listener->Release();
    }
    for (const std::shared_ptr<ConnectionEntry>& connection : live_connections) {
      connection->device.ConnectionStatusChanged(connection->connection_token);
      connection->session.SessionStatusChanged(connection->session_token);
      connection->session.MaintainConnection(false);
      connection->session.Close();
      connection->device.Close();
    }
    for (const auto& listener : loss_listeners) listener->Release();
    for (const auto& listener : changed_listeners) listener->Release();
    for (const auto& listener : state_listeners) listener->Release();
  }
};

std::shared_ptr<ConnectionEntry> RequiredConnection(const std::shared_ptr<BoundaryState>& state, const std::string& peer) {
  std::lock_guard<std::mutex> guard(state->mutex);
  const auto found = state->connections.find(peer);
  if (found == state->connections.end()) {
    throw std::runtime_error("The WinRT peer is not connected");
  }
  return found->second;
}

CharacteristicEntry& RequiredCharacteristic(ConnectionEntry& connection, const CharacteristicAddress& address) {
  for (ServiceEntry& service : connection.services) {
    if (service.uuid != address.service_uuid || service.occurrence != address.service_occurrence) continue;
    for (CharacteristicEntry& characteristic : service.characteristics) {
      if (characteristic.uuid == address.characteristic_uuid && characteristic.occurrence == address.characteristic_occurrence) {
        return characteristic;
      }
    }
  }
  throw std::runtime_error("The WinRT characteristic occurrence is not in the current discovery generation");
}

DescriptorEntry& RequiredDescriptor(ConnectionEntry& connection, const DescriptorAddress& address) {
  CharacteristicEntry& characteristic = RequiredCharacteristic(connection, address);
  for (DescriptorEntry& descriptor : characteristic.descriptors) {
    if (descriptor.uuid == address.descriptor_uuid && descriptor.occurrence == address.descriptor_occurrence) return descriptor;
  }
  throw std::runtime_error("The WinRT descriptor occurrence is not in the current discovery generation");
}

struct DescriptorView {
  std::string uuid;
  uint32_t occurrence;
};

struct CharacteristicView {
  std::string uuid;
  uint32_t occurrence;
  bool readable;
  bool writable_with_response;
  bool writable_without_response;
  bool notifiable;
  bool indicatable;
  std::vector<DescriptorView> descriptors;
};

struct ServiceView {
  std::string uuid;
  uint32_t occurrence;
  std::vector<CharacteristicView> characteristics;
};

struct DiscoveryView {
  std::vector<ServiceView> services;
};

Napi::Value ToJsDiscovery(Napi::Env env, const DiscoveryView& discovery) {
  Napi::Object result = Napi::Object::New(env);
  Napi::Array services = Napi::Array::New(env, discovery.services.size());
  for (uint32_t service_index = 0; service_index < discovery.services.size(); ++service_index) {
    const ServiceView& source_service = discovery.services[service_index];
    Napi::Object service = Napi::Object::New(env);
    service.Set("uuid", Napi::String::New(env, source_service.uuid));
    service.Set("occurrence", Napi::Number::New(env, source_service.occurrence));
    Napi::Array characteristics = Napi::Array::New(env, source_service.characteristics.size());
    for (uint32_t characteristic_index = 0; characteristic_index < source_service.characteristics.size(); ++characteristic_index) {
      const CharacteristicView& source_characteristic = source_service.characteristics[characteristic_index];
      Napi::Object characteristic = Napi::Object::New(env);
      characteristic.Set("uuid", Napi::String::New(env, source_characteristic.uuid));
      characteristic.Set("occurrence", Napi::Number::New(env, source_characteristic.occurrence));
      characteristic.Set("readable", Napi::Boolean::New(env, source_characteristic.readable));
      characteristic.Set("writableWithResponse", Napi::Boolean::New(env, source_characteristic.writable_with_response));
      characteristic.Set("writableWithoutResponse", Napi::Boolean::New(env, source_characteristic.writable_without_response));
      characteristic.Set("notifiable", Napi::Boolean::New(env, source_characteristic.notifiable));
      characteristic.Set("indicatable", Napi::Boolean::New(env, source_characteristic.indicatable));
      Napi::Array descriptors = Napi::Array::New(env, source_characteristic.descriptors.size());
      for (uint32_t descriptor_index = 0; descriptor_index < source_characteristic.descriptors.size(); ++descriptor_index) {
        const DescriptorView& source_descriptor = source_characteristic.descriptors[descriptor_index];
        Napi::Object descriptor = Napi::Object::New(env);
        descriptor.Set("uuid", Napi::String::New(env, source_descriptor.uuid));
        descriptor.Set("occurrence", Napi::Number::New(env, source_descriptor.occurrence));
        descriptors.Set(descriptor_index, descriptor);
      }
      characteristic.Set("descriptors", descriptors);
      characteristics.Set(characteristic_index, characteristic);
    }
    service.Set("characteristics", characteristics);
    services.Set(service_index, service);
  }
  result.Set("services", services);
  result.Set("cacheMode", Napi::String::New(env, "uncached"));
  return result;
}

std::string CharacteristicKey(const CharacteristicAddress& address) {
  std::string key = address.peer;
  key.push_back('\0');
  key.append(address.service_uuid);
  key.push_back('\0');
  key.append(std::to_string(address.service_occurrence));
  key.push_back('\0');
  key.append(address.characteristic_uuid);
  key.push_back('\0');
  key.append(std::to_string(address.characteristic_occurrence));
  return key;
}

#include "winrt-boundary.inc"
