// native/electron/winrt/src/addon.cpp

#include <napi.h>
#include <windows.h>
#include <appmodel.h>
#include <winrt/Windows.Devices.Bluetooth.h>
#include <winrt/Windows.Devices.Bluetooth.Advertisement.h>
#include <winrt/Windows.Devices.Bluetooth.GenericAttributeProfile.h>
#include <winrt/Windows.Devices.Radios.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Security.Cryptography.h>
#include <winrt/Windows.Storage.Streams.h>
#include <winrt/base.h>

#include "WinRtConnectionOwnership.hpp"

#include <algorithm>
#include <atomic>
#include <cctype>
#include <cmath>
#include <condition_variable>
#include <cstdio>
#include <cstdint>
#include <functional>
#include <iomanip>
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

template <typename Entry>
using WinRtConnectionOwnership = unified_ble::winrt_boundary::WinRtConnectionOwnership<Entry>;

using winrt::Windows::Devices::Bluetooth::BluetoothAdapter;
using winrt::Windows::Devices::Bluetooth::BluetoothConnectionStatus;
using winrt::Windows::Devices::Bluetooth::BluetoothError;
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
  try {
    winrt::init_apartment(winrt::apartment_type::multi_threaded);
  } catch (const winrt::hresult_error& error) {
    if (error.code().value == RPC_E_CHANGED_MODE) {
      return;
    }
    throw;
  }
}

std::string ToUtf8(const winrt::hstring& value) {
  return winrt::to_string(value);
}

void ReportWinRtDelegateFailure(const char* delegate, const winrt::hresult_error& error) {
  std::fprintf(stderr, "[unified_ble_winrt] %s delegate failed: %s\n", delegate, ToUtf8(error.message()).c_str());
}

void ReportWinRtDelegateFailure(const char* delegate, const std::exception& error) {
  std::fprintf(stderr, "[unified_ble_winrt] %s delegate failed: %s\n", delegate, error.what());
}

void ReportWinRtDelegateFailure(const char* delegate) {
  std::fprintf(stderr, "[unified_ble_winrt] %s delegate failed with a non-standard error\n", delegate);
}

std::string CanonicalUuid(const winrt::guid& value) {
  std::string text = winrt::to_string(winrt::to_hstring(value));
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
  using GetCurrentPackageFullNameFunction = LONG(WINAPI*)(UINT32* package_full_name_length, PWSTR package_full_name);
  const HMODULE kernel32 = GetModuleHandleW(L"kernel32.dll");
  if (kernel32 == nullptr) {
    return false;
  }
  const auto get_current_package_full_name = reinterpret_cast<GetCurrentPackageFullNameFunction>(
      GetProcAddress(kernel32, "GetCurrentPackageFullName"));
  if (get_current_package_full_name == nullptr) {
    return false;
  }
  UINT32 full_name_length = 0;
  return get_current_package_full_name(&full_name_length, nullptr) == ERROR_INSUFFICIENT_BUFFER;
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

bool IsAdapterReadyForScanTerminal(const AdapterView& adapter) {
  return adapter.availability == "available" && adapter.authorization == "granted" && adapter.power == "on";
}

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

struct NativeErrorDetails {
  std::string code;
  std::optional<std::string> hresult;
  std::optional<std::string> gatt_status;
};

std::string HresultCode(const winrt::hresult& value) {
  std::ostringstream stream;
  stream << "0x" << std::hex << std::uppercase << std::setfill('0') << std::setw(8)
         << static_cast<uint32_t>(value.value);
  return stream.str();
}

std::string GattCommunicationStatusCode(GattCommunicationStatus status) {
  switch (status) {
    case GattCommunicationStatus::Success:
      return "success";
    case GattCommunicationStatus::ProtocolError:
      return "protocol-error";
    case GattCommunicationStatus::AccessDenied:
      return "access-denied";
    case GattCommunicationStatus::Unreachable:
      return "unreachable";
    default:
      return "unknown";
  }
}

enum class ScanTerminalError {
  success,
  radio_not_available,
  resource_in_use,
  device_not_connected,
  other,
  disabled_by_policy,
  not_supported,
  disabled_by_user,
  consent_required,
  transport_not_supported
};

ScanTerminalError ScanTerminalErrorFor(BluetoothError error) {
  switch (error) {
    case BluetoothError::Success:
      return ScanTerminalError::success;
    case BluetoothError::RadioNotAvailable:
      return ScanTerminalError::radio_not_available;
    case BluetoothError::ResourceInUse:
      return ScanTerminalError::resource_in_use;
    case BluetoothError::DeviceNotConnected:
      return ScanTerminalError::device_not_connected;
    case BluetoothError::OtherError:
      return ScanTerminalError::other;
    case BluetoothError::DisabledByPolicy:
      return ScanTerminalError::disabled_by_policy;
    case BluetoothError::NotSupported:
      return ScanTerminalError::not_supported;
    case BluetoothError::DisabledByUser:
      return ScanTerminalError::disabled_by_user;
    case BluetoothError::ConsentRequired:
      return ScanTerminalError::consent_required;
    case BluetoothError::TransportNotSupported:
      return ScanTerminalError::transport_not_supported;
    default:
      return ScanTerminalError::other;
  }
}

const char* ScanTerminalErrorCode(ScanTerminalError error) {
  switch (error) {
    case ScanTerminalError::success:
      return "success";
    case ScanTerminalError::radio_not_available:
      return "radio-not-available";
    case ScanTerminalError::resource_in_use:
      return "resource-in-use";
    case ScanTerminalError::device_not_connected:
      return "device-not-connected";
    case ScanTerminalError::other:
      return "other";
    case ScanTerminalError::disabled_by_policy:
      return "disabled-by-policy";
    case ScanTerminalError::not_supported:
      return "not-supported";
    case ScanTerminalError::disabled_by_user:
      return "disabled-by-user";
    case ScanTerminalError::consent_required:
      return "consent-required";
    case ScanTerminalError::transport_not_supported:
      return "transport-not-supported";
  }
  return "other";
}

class WinRtNativeStatusError final : public std::runtime_error {
 public:
  WinRtNativeStatusError(const char* operation, GattCommunicationStatus status)
      : std::runtime_error(std::string(operation) + " was rejected by the Windows GATT stack"),
        status_(GattCommunicationStatusCode(status)) {}

  const std::string& Status() const {
    return status_;
  }

 private:
  std::string status_;
};

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
    } catch (const WinRtNativeStatusError& error) {
      status_->terminal.store(true);
      native_error_details_ = NativeErrorDetails{"gatt-status", std::nullopt, error.Status()};
      SetError(error.what());
    } catch (const winrt::hresult_error& error) {
      status_->terminal.store(true);
      native_error_details_ = NativeErrorDetails{"hresult", HresultCode(error.code()), std::nullopt};
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
    if (native_error_details_.has_value()) {
      const NativeErrorDetails& detail = *native_error_details_;
      Napi::Object error_object = error.Value().As<Napi::Object>();
      error_object.Set("winRtCode", Napi::String::New(Env(), detail.code));
      if (detail.gatt_status.has_value()) {
        error_object.Set("winRtGattStatus", Napi::String::New(Env(), *detail.gatt_status));
      }
      if (detail.hresult.has_value()) {
        error_object.Set("winRtHresult", Napi::String::New(Env(), *detail.hresult));
      }
    }
    deferred_.Reject(error.Value());
  }

 private:
  Napi::Promise::Deferred deferred_;
  std::shared_ptr<OperationStatus> status_;
  std::function<Result()> execute_;
  std::function<Napi::Value(Napi::Env, const Result&)> to_js_;
  std::optional<Result> result_;
  std::optional<NativeErrorDetails> native_error_details_;
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
    throw WinRtNativeStatusError(operation, status);
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
    std::lock_guard<std::mutex> guard(release_mutex_);
    if (released_) return;
    function_.Release();
    released_ = true;
  }

 protected:
  Napi::ThreadSafeFunction function_;

  void NoteIngressRejection(napi_status status) const {
    if (!telemetry_ || !channel_.has_value()) return;
    std::atomic_uint64_t& counter = status == napi_closing
        ? (*channel_ == IngressChannel::notification ? telemetry_->notification_close_drops : telemetry_->advertisement_close_drops)
        : (*channel_ == IngressChannel::notification ? telemetry_->notification_queue_drops : telemetry_->advertisement_queue_drops);
    const uint64_t total = counter.fetch_add(1U) + 1U;
    if (status != napi_closing && (total == 1U || (total & (total - 1U)) == 0U)) {
      std::fprintf(stderr, "[unified_ble_winrt] bounded %s ingress dropped %llu payloads (napi status %d)\n",
                   *channel_ == IngressChannel::notification ? "notification" : "advertisement",
                   static_cast<unsigned long long>(total), static_cast<int>(status));
    }
  }

  void ReportControlIngressFailure(const char* control, napi_status status) const {
    std::fprintf(stderr, "[unified_ble_winrt] control %s delivery failed (napi status %d)\n", control, static_cast<int>(status));
  }

 private:
  std::mutex release_mutex_;
  bool released_{false};
  std::shared_ptr<IngressTelemetry> telemetry_;
  std::optional<IngressChannel> channel_;
};

class ControlDeliveryAck final {
 public:
  void Signal() {
    {
      std::lock_guard<std::mutex> guard(mutex_);
      signaled_ = true;
    }
    condition_.notify_one();
  }

  void Wait() {
    std::unique_lock<std::mutex> guard(mutex_);
    condition_.wait(guard, [this] { return signaled_; });
  }

 private:
  std::condition_variable condition_;
  std::mutex mutex_;
  bool signaled_{false};
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
  std::string scan_token;
  uint64_t generation;
  std::string peer;
  std::string name;
  int16_t rssi;
  std::vector<std::string> service_uuids;
};

class AdvertisementListener final : public ListenerLifecycle {
 public:
  explicit AdvertisementListener(Napi::ThreadSafeFunction function, std::shared_ptr<IngressTelemetry> telemetry)
      : ListenerLifecycle(std::move(function), std::move(telemetry), IngressChannel::advertisement) {}

  void Emit(std::string scan_token, uint64_t generation, std::string peer, std::string name, int16_t rssi, std::vector<std::string> service_uuids) {
    auto* payload = new AdvertisementPayload{std::move(scan_token), generation, std::move(peer), std::move(name), rssi, std::move(service_uuids)};
    const napi_status status = function_.NonBlockingCall(payload, [](Napi::Env env, Napi::Function callback, AdvertisementPayload* value) {
      std::unique_ptr<AdvertisementPayload> owned(value);
      Napi::Object advertisement = Napi::Object::New(env);
      advertisement.Set("scanToken", Napi::String::New(env, value->scan_token));
      advertisement.Set("generation", Napi::String::New(env, std::to_string(value->generation)));
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

struct ConnectionEventPayload {
  std::string peer;
  std::string connection_generation;
  std::optional<std::string> reason;
};

class ConnectionLossListener final : public ListenerLifecycle {
 public:
  explicit ConnectionLossListener(Napi::ThreadSafeFunction function) : ListenerLifecycle(std::move(function)) {}

  void Emit(const std::string& peer, const std::string& connection_generation, const std::optional<std::string>& reason) {
    auto* payload = new ConnectionEventPayload{peer, connection_generation, reason};
    // State-control events apply bounded backpressure rather than silently dropping loss signals.
    const napi_status status = function_.BlockingCall(payload, [](Napi::Env env, Napi::Function callback, ConnectionEventPayload* value) {
      std::unique_ptr<ConnectionEventPayload> owned(value);
      Napi::Object event = Napi::Object::New(env);
      event.Set("nativePeerId", Napi::String::New(env, value->peer));
      event.Set("connectionGeneration", Napi::String::New(env, value->connection_generation));
      event.Set("safeReason", value->reason.has_value() ? Napi::String::New(env, *value->reason) : env.Null());
      callback.Call({event});
    });
    if (status != napi_ok) {
      delete payload;
      ReportControlIngressFailure("connection-loss", status);
    }
  }
};

class DatabaseListener final : public ListenerLifecycle {
 public:
  explicit DatabaseListener(Napi::ThreadSafeFunction function) : ListenerLifecycle(std::move(function)) {}

  void Emit(const std::string& peer, const std::string& connection_generation) {
    auto* payload = new ConnectionEventPayload{peer, connection_generation, std::nullopt};
    // State-control events apply bounded backpressure rather than silently dropping invalidation signals.
    const napi_status status = function_.BlockingCall(payload, [](Napi::Env env, Napi::Function callback, ConnectionEventPayload* value) {
      std::unique_ptr<ConnectionEventPayload> owned(value);
      Napi::Object event = Napi::Object::New(env);
      event.Set("nativePeerId", Napi::String::New(env, value->peer));
      event.Set("connectionGeneration", Napi::String::New(env, value->connection_generation));
      callback.Call({event});
    });
    if (status != napi_ok) {
      delete payload;
      ReportControlIngressFailure("database-changed", status);
    }
  }
};

class AdapterListener final : public ListenerLifecycle {
 public:
  explicit AdapterListener(Napi::ThreadSafeFunction function) : ListenerLifecycle(std::move(function)) {}

  void Emit(const AdapterView& adapter, const std::shared_ptr<ControlDeliveryAck>& completion = nullptr) {
    struct AdapterPayload {
      AdapterView adapter;
      std::shared_ptr<ControlDeliveryAck> completion;
    };
    auto* payload = new AdapterPayload{adapter, completion};
    // State-control events apply bounded backpressure rather than silently dropping adapter state.
    const napi_status status = function_.BlockingCall(payload, [](Napi::Env env, Napi::Function callback, AdapterPayload* value) {
      std::unique_ptr<AdapterPayload> owned(value);
      try {
        callback.Call({ToJsAdapterState(env, value->adapter)});
      } catch (const std::exception& error) {
        std::fprintf(stderr, "[unified_ble_winrt] adapter-state callback failed: %s\n", error.what());
      } catch (...) {
        std::fprintf(stderr, "[unified_ble_winrt] adapter-state callback failed with a non-standard error\n");
      }
      if (value->completion != nullptr) value->completion->Signal();
    });
    if (status != napi_ok) {
      delete payload;
      if (completion != nullptr) completion->Signal();
      ReportControlIngressFailure("adapter-state", status);
    }
  }
};

struct ScanTerminalPayload {
  std::string scan_token;
  std::string status;
  ScanTerminalError error;
};

class ScanTerminalListener final : public ListenerLifecycle {
 public:
  explicit ScanTerminalListener(Napi::ThreadSafeFunction function) : ListenerLifecycle(std::move(function)) {}

  void Emit(const std::string& scan_token, const char* status, BluetoothError error) {
    auto* payload = new ScanTerminalPayload{scan_token, status, ScanTerminalErrorFor(error)};
    // Scan terminals are lifecycle control and must not be dropped when the bounded queue is full.
    const napi_status delivery_status = function_.BlockingCall(payload, [](Napi::Env env, Napi::Function callback, ScanTerminalPayload* value) {
      std::unique_ptr<ScanTerminalPayload> owned(value);
      try {
        Napi::Object terminal = Napi::Object::New(env);
        terminal.Set("scanToken", Napi::String::New(env, value->scan_token));
        terminal.Set("status", Napi::String::New(env, value->status));
        terminal.Set("error", Napi::String::New(env, ScanTerminalErrorCode(value->error)));
        callback.Call({terminal});
      } catch (const std::exception& callback_error) {
        std::fprintf(stderr, "[unified_ble_winrt] scan-terminal callback failed: %s\n", callback_error.what());
      } catch (...) {
        std::fprintf(stderr, "[unified_ble_winrt] scan-terminal callback failed with a non-standard error\n");
      }
    });
    if (delivery_status != napi_ok) {
      delete payload;
      ReportControlIngressFailure("scan-terminal", delivery_status);
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
  ConnectionEntry(BluetoothLEDevice device_value, GattSession session_value, std::string connection_generation_value)
      : device(std::move(device_value)), session(std::move(session_value)), connection_generation(std::move(connection_generation_value)) {}

  // A Connect operation publishes this exact owner before it asks WinRT to
  // open either resource.  The false open flags make its rollback and a
  // concurrent Destroy safe until each resource is attached below.
  explicit ConnectionEntry(std::string connection_generation_value)
      : device(nullptr),
        session(nullptr),
        connection_generation(std::move(connection_generation_value)),
        session_open(false),
        device_open(false) {}

  ConnectionEntry(const ConnectionEntry&) = delete;
  ConnectionEntry& operator=(const ConnectionEntry&) = delete;

  std::mutex gatt_mutex;
  std::mutex lifecycle_mutex;
  BluetoothLEDevice device;
  GattSession session;
  std::string connection_generation;
  winrt::event_token connection_token{};
  winrt::event_token session_token{};
  winrt::event_token services_changed_token{};
  bool connection_handler_registered{false};
  bool session_handler_registered{false};
  bool services_changed_handler_registered{false};
  bool maintenance_enabled{false};
  bool session_open{true};
  bool device_open{true};
  bool removal_claimed{false};
  bool cleanup_pending{false};
  // These are protected by lifecycle_mutex.  A provisional owner stays in the
  // connecting map until setup either promotes it or retains it for cleanup.
  // Disconnect marks a request and Connect observes it after every WinRT
  // await, so no newly acquired resource can outlive the map owner.
  bool setup_in_progress{true};
  bool disconnect_requested{false};
  std::condition_variable setup_finished;
  bool loss_emitted{false};
  std::atomic_uint64_t services_revision{0U};
  std::vector<ServiceEntry> services;
};

struct ScanLifecycle {
  std::mutex startup_mutex;
  std::mutex cleanup_mutex;
  std::atomic_bool ingress_open{true};
  std::atomic_bool local_stop_requested{false};
  std::atomic_bool terminal_emitted{false};
  std::atomic_bool startup_in_progress{false};
  std::atomic_bool deferred_stopped{false};
  std::optional<BluetoothError> deferred_error;
  bool received_handler_registered{false};
  bool stopped_handler_registered{false};
  bool watcher_stopped{false};
  bool listener_released{false};
  bool cleanup_complete{false};
  std::atomic_bool stop_requested{false};
};

struct ScanEntry {
  BluetoothLEAdvertisementWatcher watcher;
  winrt::event_token received_token{};
  winrt::event_token stopped_token{};
  std::string scan_token;
  uint64_t generation{0U};
  std::shared_ptr<AdvertisementListener> listener;
  std::shared_ptr<ScanLifecycle> lifecycle;
};

struct NotificationEntry {
  std::shared_ptr<ConnectionEntry> connection;
  GattCharacteristic characteristic;
  std::shared_ptr<NotificationListener> listener;
  struct Lifecycle {
    std::mutex mutex;
    winrt::event_token value_token{};
    bool value_handler_registered{false};
    bool cccd_enabled{false};
    bool listener_released{false};
  };
  std::shared_ptr<Lifecycle> lifecycle;
};

void ClearGattServices(ConnectionEntry& connection) {
  std::lock_guard<std::mutex> guard(connection.gatt_mutex);
  connection.services.clear();
  connection.services_revision.fetch_add(1U);
}

struct BoundaryState : public std::enable_shared_from_this<BoundaryState> {
  std::mutex mutex;
  bool destroyed = false;
  bool destroying = false;
  std::string selected_adapter;
  uint64_t next_scan_generation{1U};
  std::shared_ptr<ScanEntry> scan;
  std::unordered_map<std::string, std::shared_ptr<ConnectionEntry>> connections;
  // The peer reservation is made before FromBluetoothAddressAsync.  Its value
  // is the exact ConnectionEntry later promoted to active or cleanup-pending;
  // a second Connect can therefore never create a competing native owner.
  std::unordered_map<std::string, std::shared_ptr<ConnectionEntry>> connecting_connections;
  // A Connect rollback may fail after callbacks are registered but before the
  // normal connection map admits the entry. Keep that exact native owner here
  // so Disconnect and Destroy can retry the same teardown.
  std::unordered_map<std::string, std::shared_ptr<ConnectionEntry>> cleanup_pending_connections;
  std::unordered_map<std::string, NotificationEntry> notifications;
  std::vector<std::shared_ptr<ConnectionLossListener>> connection_listeners;
  std::vector<std::shared_ptr<DatabaseListener>> database_listeners;
  std::vector<std::shared_ptr<AdapterListener>> adapter_listeners;
  std::vector<std::shared_ptr<ScanTerminalListener>> scan_terminal_listeners;
  std::shared_ptr<IngressTelemetry> ingress_telemetry = std::make_shared<IngressTelemetry>();
  std::optional<Radio> radio;
  std::optional<winrt::event_token> radio_token;
  bool radio_handler_registered{false};

  void EmitConnectionLoss(const std::string& peer, const std::string& connection_generation, const std::optional<std::string>& reason) {
    std::vector<std::shared_ptr<ConnectionLossListener>> listeners;
    {
      std::lock_guard<std::mutex> guard(mutex);
      listeners = connection_listeners;
    }
    for (const std::shared_ptr<ConnectionLossListener>& listener : listeners) {
      listener->Emit(peer, connection_generation, reason);
    }
  }

  void EmitDatabaseChanged(const std::string& peer, const std::string& connection_generation) {
    std::vector<std::shared_ptr<DatabaseListener>> listeners;
    {
      std::lock_guard<std::mutex> guard(mutex);
      listeners = database_listeners;
    }
    for (const std::shared_ptr<DatabaseListener>& listener : listeners) {
      listener->Emit(peer, connection_generation);
    }
  }

  AdapterView EmitAdapterState(bool wait_for_callbacks = false) {
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
      const std::shared_ptr<ControlDeliveryAck> completion = wait_for_callbacks ? std::make_shared<ControlDeliveryAck>() : nullptr;
      listener->Emit(adapter, completion);
      if (completion != nullptr) completion->Wait();
    }
    return adapter;
  }

  void EmitScanTerminal(const std::string& scan_token, const char* status, BluetoothError error) {
    std::vector<std::shared_ptr<ScanTerminalListener>> listeners;
    {
      std::lock_guard<std::mutex> guard(mutex);
      listeners = scan_terminal_listeners;
    }
    for (const std::shared_ptr<ScanTerminalListener>& listener : listeners) {
      listener->Emit(scan_token, status, error);
    }
  }

  void HandleGattServicesChanged(const std::string& peer, const std::shared_ptr<ConnectionEntry>& expected);

  void HandleScanStopped(const std::shared_ptr<ScanEntry>& entry, BluetoothError error);

  void RetainConnectionForCleanup(const std::string& peer, const std::shared_ptr<ConnectionEntry>& connection);

  std::shared_ptr<ConnectionEntry> ReserveConnectingConnection(
      const std::string& peer,
      const std::string& connection_generation);

  void PromoteConnectingConnection(const std::string& peer, const std::shared_ptr<ConnectionEntry>& connection);

  void ReleaseRetainedConnectionAfterCleanup(const std::string& peer, const std::shared_ptr<ConnectionEntry>& connection);

  void FinishConnectionSetup(const std::shared_ptr<ConnectionEntry>& connection);

  bool RemoveConnection(const std::string& peer, const std::shared_ptr<ConnectionEntry>& expected = nullptr);

  void StopScan(const std::string& scan_token);

  void Destroy();
};

std::shared_ptr<ConnectionEntry> RequiredConnection(const std::shared_ptr<BoundaryState>& state, const std::string& peer) {
  std::lock_guard<std::mutex> guard(state->mutex);
  if (state->destroyed || state->destroying) {
    throw std::runtime_error("The WinRT native boundary is tearing down");
  }
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
