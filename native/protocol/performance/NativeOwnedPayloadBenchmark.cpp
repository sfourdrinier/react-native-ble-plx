// native/protocol/performance/NativeOwnedPayloadBenchmark.cpp

#include "OwnedBinaryPayloadStore.hpp"

#include <algorithm>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <iomanip>
#include <iostream>
#include <string>
#include <vector>

namespace {

using unified_ble::native_protocol::v1::BorrowedByteView;
using unified_ble::native_protocol::v1::OwnedBinaryPayloadStore;

constexpr std::size_t kSampleCount = 9U;
constexpr std::size_t kTargetBytesPerSample = 4U * 1024U * 1024U;
constexpr std::size_t kMaximumIterations = 4096U;

struct Measurement final {
  std::size_t payloadBytes;
  std::size_t iterations;
  std::vector<double> samples;
  double p50Nanoseconds;
  double p95Nanoseconds;
};

std::size_t iterationsForPayload(std::size_t payloadBytes) {
  const std::size_t denominator = std::max<std::size_t>(payloadBytes, 1U);
  return std::max<std::size_t>(1U, std::min(kMaximumIterations, kTargetBytesPerSample / denominator));
}

double measureRoundTrip(std::size_t payloadBytes, std::size_t iterations) {
  std::vector<std::uint8_t> payload(payloadBytes, 0x5aU);
  OwnedBinaryPayloadStore store(std::max<std::size_t>(payloadBytes, 1U));
  const auto started = std::chrono::steady_clock::now();
  for (std::size_t iteration = 0U; iteration < iterations; ++iteration) {
    const auto reference = store.retainCopy(
        "native-host-benchmark",
        BorrowedByteView{.data = payload.empty() ? nullptr : payload.data(), .size = payload.size()});
    const auto retained = store.take(reference);
    if (retained != payload || store.retainedBytes() != 0U || store.retainedPayloads() != 0U) {
      throw std::runtime_error("Native payload benchmark observed incorrect ownership settlement");
    }
  }
  const auto elapsed = std::chrono::duration_cast<std::chrono::nanoseconds>(
      std::chrono::steady_clock::now() - started);
  if (elapsed.count() <= 0) {
    throw std::runtime_error("Native payload benchmark clock did not advance");
  }
  return static_cast<double>(elapsed.count()) / static_cast<double>(iterations);
}

Measurement measurePayload(std::size_t payloadBytes) {
  const std::size_t iterations = iterationsForPayload(payloadBytes);
  std::vector<double> samples;
  samples.reserve(kSampleCount);
  static_cast<void>(measureRoundTrip(payloadBytes, std::min<std::size_t>(iterations, 8U)));
  for (std::size_t sample = 0U; sample < kSampleCount; ++sample) {
    samples.push_back(measureRoundTrip(payloadBytes, iterations));
  }
  auto sorted = samples;
  std::sort(sorted.begin(), sorted.end());
  return Measurement{
      .payloadBytes = payloadBytes,
      .iterations = iterations,
      .samples = std::move(samples),
      .p50Nanoseconds = sorted[sorted.size() / 2U],
      .p95Nanoseconds = sorted[sorted.size() - 1U],
  };
}

const char* platformName() {
#if defined(_WIN32)
  return "windows";
#elif defined(__APPLE__)
  return "darwin";
#elif defined(__linux__)
  return "linux";
#else
  return "unknown";
#endif
}

const char* architectureName() {
#if defined(_M_ARM64) || defined(__aarch64__)
  return "arm64";
#elif defined(_M_X64) || defined(__x86_64__)
  return "x64";
#elif defined(_M_IX86) || defined(__i386__)
  return "x86";
#else
  return "unknown";
#endif
}

void writeNumberOrNull(double value, bool present) {
  if (present) {
    std::cout << value;
  } else {
    std::cout << "null";
  }
}

void writeMeasurement(const Measurement& measurement, bool first) {
  if (!first) std::cout << ',';
  const double operationsPerSecond = 1'000'000'000.0 / measurement.p50Nanoseconds;
  const double bytesPerSecond = operationsPerSecond * static_cast<double>(measurement.payloadBytes);
  std::cout << "{\"id\":\"native-owned-payload-roundtrip-" << measurement.payloadBytes
            << "\",\"category\":\"native-owned-payload\",\"payloadBytes\":" << measurement.payloadBytes
            << ",\"ownership\":\"native retained copy followed by exact take and settlement\",\"iterationsPerSample\":"
            << measurement.iterations << ",\"samplesNanosecondsPerOperation\":[";
  for (std::size_t index = 0U; index < measurement.samples.size(); ++index) {
    if (index > 0U) std::cout << ',';
    std::cout << measurement.samples[index];
  }
  std::cout << "],\"nanosecondsPerOperation\":" << measurement.p50Nanoseconds
            << ",\"p95NanosecondsPerOperation\":" << measurement.p95Nanoseconds
            << ",\"operationsPerSecond\":" << operationsPerSecond << ",\"bytesPerSecond\":";
  writeNumberOrNull(bytesPerSecond, measurement.payloadBytes > 0U);
  std::cout << '}';
}

} // namespace

int main() {
  try {
    const std::vector<std::size_t> payloadSizes{0U, 20U, 244U, 4096U, 65536U};
    std::vector<Measurement> measurements;
    measurements.reserve(payloadSizes.size());
    for (const std::size_t payloadBytes : payloadSizes) {
      measurements.push_back(measurePayload(payloadBytes));
    }
    std::cout << std::setprecision(12)
              << "{\"schema\":\"unified-ble-native-host-performance/v1\",\"runtime\":{\"platform\":\""
              << platformName() << "\",\"architecture\":\"" << architectureName()
              << "\"},\"methodology\":{\"clock\":\"std::chrono::steady_clock\",\"samples\":"
              << kSampleCount << ",\"targetBytesPerSample\":" << kTargetBytesPerSample
              << "},\"measurements\":[";
    for (std::size_t index = 0U; index < measurements.size(); ++index) {
      writeMeasurement(measurements[index], index == 0U);
    }
    std::cout << "]}\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "[native-owned-payload-benchmark] " << error.what() << '\n';
    return 1;
  }
}
