// native/protocol/include/NativeProtocolV1Codec.hpp

#pragma once

#include "../generated/NativeProtocolV1Schema.hpp"

#include <cstddef>
#include <cstdint>
#include <memory>
#include <stdexcept>
#include <string>
#include <variant>
#include <vector>

namespace unified_ble::native_protocol::v1 {

enum class ProtocolFailure {
  incompatibleVersion,
  malformedRecord,
  unknownRecord,
  unknownField,
  duplicateField,
  missingField,
  invalidFieldType,
  invalidEnumValue,
  invalidPath,
  stalePath,
  invalidCorrelation,
  payloadTooLarge,
  detachedPayload,
  alreadyTerminal,
  restorationConsumed,
};

class ProtocolException final : public std::runtime_error {
 public:
  ProtocolException(ProtocolFailure failure, const std::string& message);
  ProtocolFailure failure() const noexcept;

 private:
  ProtocolFailure failure_;
};

struct ProtocolRecord;
using ProtocolRecordReference = std::shared_ptr<ProtocolRecord>;
using ProtocolRecordList = std::vector<ProtocolRecordReference>;
using ProtocolStringList = std::vector<std::string>;
using ProtocolFieldValue = std::variant<
    bool,
    std::int64_t,
    std::uint64_t,
    std::string,
    ProtocolStringList,
    ProtocolRecordReference,
    ProtocolRecordList>;

struct ProtocolField {
  std::uint16_t id;
  ProtocolFieldValue value;
};

struct ProtocolRecord {
  RecordKind kind;
  std::vector<ProtocolField> fields;
};

struct VersionRange {
  std::uint32_t minimum;
  std::uint32_t maximum;
};

struct NegotiatedVersions {
  std::uint32_t nativeProtocol;
  std::uint32_t abi;
  std::uint32_t backendContract;
  std::uint32_t capabilitySchema;
  std::uint32_t eventSchema;
  std::uint32_t traceFormat;
};

class NativeProtocolV1Codec final {
 public:
  std::vector<std::uint8_t> encode(const ProtocolRecord& record) const;
  ProtocolRecord decode(const std::vector<std::uint8_t>& bytes) const;
  void validate(const ProtocolRecord& record) const;

  static NegotiatedVersions negotiate(
      VersionRange nativeProtocol,
      VersionRange abi,
      VersionRange backendContract,
      VersionRange capabilitySchema,
      VersionRange eventSchema,
      VersionRange traceFormat);

 private:
  void validateRecord(const ProtocolRecord& record, std::size_t depth) const;
};

} // namespace unified_ble::native_protocol::v1
