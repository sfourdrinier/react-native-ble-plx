// native/protocol/src/NativeProtocolV1Codec.cpp

#include "../include/NativeProtocolV1Codec.hpp"

#include <algorithm>
#include <array>
#include <cstring>
#include <limits>
#include <set>
#include <string_view>

namespace unified_ble::native_protocol::v1 {

namespace {

constexpr std::array<std::uint8_t, 4> kMagic{0x55U, 0x42U, 0x4EU, 0x31U};
constexpr std::size_t kMaximumRecordDepth = 16U;

enum class ValueTag : std::uint8_t {
  boolean = 1U,
  signedInteger = 2U,
  unsignedInteger = 3U,
  string = 4U,
  strings = 5U,
  record = 6U,
  records = 7U,
};

const FieldDescriptor* descriptor(RecordKind record, std::uint16_t fieldId) {
  const auto found = std::find_if(
      kFieldDescriptors.begin(),
      kFieldDescriptors.end(),
      [record, fieldId](const FieldDescriptor& candidate) {
        return candidate.record == record && candidate.fieldId == fieldId;
      });
  return found == kFieldDescriptors.end() ? nullptr : &*found;
}

bool enumValueAllowed(std::string_view type, const std::string& value) {
  constexpr std::string_view prefix = "enum:";
  if (!type.starts_with(prefix)) {
    return true;
  }
  const auto enumName = type.substr(prefix.size());
  return std::any_of(
      kEnumValueDescriptors.begin(),
      kEnumValueDescriptors.end(),
      [enumName, &value](const EnumValueDescriptor& descriptorValue) {
        return descriptorValue.type == enumName && descriptorValue.value == value;
      });
}

RecordKind recordKindForName(std::string_view name) {
  const auto found = std::find_if(
      kRecordKindDescriptors.begin(),
      kRecordKindDescriptors.end(),
      [name](const RecordKindDescriptor& descriptorValue) {
        return descriptorValue.name == name;
      });
  if (found != kRecordKindDescriptors.end()) {
    return found->kind;
  }
  throw ProtocolException(ProtocolFailure::unknownRecord, "Native protocol field references an unknown record");
}

void appendBytes(std::vector<std::uint8_t>& output, const void* data, std::size_t size) {
  if (size > kMaximumControlRecordBytes - output.size()) {
    throw ProtocolException(ProtocolFailure::payloadTooLarge, "Native protocol control record exceeds its limit");
  }
  if (size == 0U) {
    return;
  }
  const auto* bytes = static_cast<const std::uint8_t*>(data);
  output.insert(output.end(), bytes, bytes + size);
}

template <typename Integer>
void appendInteger(std::vector<std::uint8_t>& output, Integer value) {
  for (std::size_t byte = 0; byte < sizeof(Integer); byte += 1U) {
    output.push_back(static_cast<std::uint8_t>((static_cast<std::uint64_t>(value) >> (byte * 8U)) & 0xFFU));
  }
}

void appendString(std::vector<std::uint8_t>& output, const std::string& value) {
  if (value.size() > std::numeric_limits<std::uint32_t>::max()) {
    throw ProtocolException(ProtocolFailure::payloadTooLarge, "Native protocol string exceeds its wire range");
  }
  appendInteger(output, static_cast<std::uint32_t>(value.size()));
  appendBytes(output, value.data(), value.size());
}

class Reader final {
 public:
  explicit Reader(const std::vector<std::uint8_t>& bytes) : bytes_(bytes) {}

  template <typename Integer>
  Integer integer() {
    require(sizeof(Integer));
    std::uint64_t value = 0U;
    for (std::size_t byte = 0; byte < sizeof(Integer); byte += 1U) {
      value |= static_cast<std::uint64_t>(bytes_[offset_ + byte]) << (byte * 8U);
    }
    offset_ += sizeof(Integer);
    return static_cast<Integer>(value);
  }

  std::string string() {
    const auto size = integer<std::uint32_t>();
    require(size);
    const auto begin = bytes_.begin() + static_cast<std::ptrdiff_t>(offset_);
    const auto end = begin + static_cast<std::ptrdiff_t>(size);
    offset_ += size;
    return {begin, end};
  }

  std::vector<std::uint8_t> bytes(std::size_t size) {
    require(size);
    const auto begin = bytes_.begin() + static_cast<std::ptrdiff_t>(offset_);
    const auto end = begin + static_cast<std::ptrdiff_t>(size);
    offset_ += size;
    return {begin, end};
  }

  bool empty() const {
    return offset_ == bytes_.size();
  }

 private:
  void require(std::size_t size) const {
    if (size > bytes_.size() - offset_) {
      throw ProtocolException(ProtocolFailure::malformedRecord, "Native protocol record is truncated");
    }
  }

  const std::vector<std::uint8_t>& bytes_;
  std::size_t offset_ = 0U;
};

std::vector<std::uint8_t> encodeRecord(const ProtocolRecord& record);
ProtocolRecord decodeRecord(const std::vector<std::uint8_t>& bytes, std::size_t depth);

void encodeValue(std::vector<std::uint8_t>& output, const ProtocolFieldValue& value) {
  std::vector<std::uint8_t> payload;
  ValueTag tag;
  if (const auto* boolean = std::get_if<bool>(&value)) {
    tag = ValueTag::boolean;
    payload.push_back(*boolean ? 1U : 0U);
  } else if (const auto* signedInteger = std::get_if<std::int64_t>(&value)) {
    tag = ValueTag::signedInteger;
    appendInteger(payload, static_cast<std::uint64_t>(*signedInteger));
  } else if (const auto* unsignedInteger = std::get_if<std::uint64_t>(&value)) {
    tag = ValueTag::unsignedInteger;
    appendInteger(payload, *unsignedInteger);
  } else if (const auto* string = std::get_if<std::string>(&value)) {
    tag = ValueTag::string;
    appendString(payload, *string);
  } else if (const auto* strings = std::get_if<ProtocolStringList>(&value)) {
    tag = ValueTag::strings;
    appendInteger(payload, static_cast<std::uint32_t>(strings->size()));
    for (const auto& string : *strings) {
      appendString(payload, string);
    }
  } else if (const auto* record = std::get_if<ProtocolRecordReference>(&value)) {
    tag = ValueTag::record;
    if (!*record) {
      throw ProtocolException(ProtocolFailure::invalidFieldType, "Native protocol record reference is null");
    }
    payload = encodeRecord(**record);
  } else {
    tag = ValueTag::records;
    const auto& records = std::get<ProtocolRecordList>(value);
    appendInteger(payload, static_cast<std::uint32_t>(records.size()));
    for (const auto& record : records) {
      if (!record) {
        throw ProtocolException(ProtocolFailure::invalidFieldType, "Native protocol record list contains null");
      }
      const auto encoded = encodeRecord(*record);
      appendInteger(payload, static_cast<std::uint32_t>(encoded.size()));
      appendBytes(payload, encoded.data(), encoded.size());
    }
  }
  output.push_back(static_cast<std::uint8_t>(tag));
  appendInteger(output, static_cast<std::uint32_t>(payload.size()));
  appendBytes(output, payload.data(), payload.size());
}

ProtocolFieldValue decodeValue(ValueTag tag, const std::vector<std::uint8_t>& bytes, std::size_t depth) {
  Reader reader(bytes);
  switch (tag) {
    case ValueTag::boolean: {
      const auto value = reader.integer<std::uint8_t>();
      if (value > 1U || !reader.empty()) {
        throw ProtocolException(ProtocolFailure::malformedRecord, "Native protocol boolean is malformed");
      }
      return value == 1U;
    }
    case ValueTag::signedInteger: {
      const auto value = static_cast<std::int64_t>(reader.integer<std::uint64_t>());
      if (!reader.empty()) {
        throw ProtocolException(ProtocolFailure::malformedRecord, "Native protocol signed integer is malformed");
      }
      return value;
    }
    case ValueTag::unsignedInteger: {
      const auto value = reader.integer<std::uint64_t>();
      if (!reader.empty()) {
        throw ProtocolException(ProtocolFailure::malformedRecord, "Native protocol unsigned integer is malformed");
      }
      return value;
    }
    case ValueTag::string: {
      auto value = reader.string();
      if (!reader.empty()) {
        throw ProtocolException(ProtocolFailure::malformedRecord, "Native protocol string is malformed");
      }
      return value;
    }
    case ValueTag::strings: {
      ProtocolStringList values;
      const auto count = reader.integer<std::uint32_t>();
      if (count > kMaximumControlRecordBytes) {
        throw ProtocolException(ProtocolFailure::payloadTooLarge, "Native protocol string list count is invalid");
      }
      values.reserve(count);
      for (std::uint32_t index = 0U; index < count; index += 1U) {
        values.push_back(reader.string());
      }
      if (!reader.empty()) {
        throw ProtocolException(ProtocolFailure::malformedRecord, "Native protocol string list is malformed");
      }
      return values;
    }
    case ValueTag::record:
      return std::make_shared<ProtocolRecord>(decodeRecord(bytes, depth + 1U));
    case ValueTag::records: {
      ProtocolRecordList values;
      const auto count = reader.integer<std::uint32_t>();
      if (count > kMaximumControlRecordBytes) {
        throw ProtocolException(ProtocolFailure::payloadTooLarge, "Native protocol record list count is invalid");
      }
      values.reserve(count);
      for (std::uint32_t index = 0U; index < count; index += 1U) {
        values.push_back(
            std::make_shared<ProtocolRecord>(
                decodeRecord(reader.bytes(reader.integer<std::uint32_t>()), depth + 1U)));
      }
      if (!reader.empty()) {
        throw ProtocolException(ProtocolFailure::malformedRecord, "Native protocol record list is malformed");
      }
      return values;
    }
  }
  throw ProtocolException(ProtocolFailure::invalidFieldType, "Native protocol field has an unknown value tag");
}

std::vector<std::uint8_t> encodeRecord(const ProtocolRecord& record) {
  std::vector<std::uint8_t> output;
  appendBytes(output, kMagic.data(), kMagic.size());
  appendInteger(output, kProtocolVersion);
  appendInteger(output, static_cast<std::uint16_t>(record.kind));
  appendInteger(output, static_cast<std::uint16_t>(record.fields.size()));
  for (const auto& field : record.fields) {
    appendInteger(output, field.id);
    encodeValue(output, field.value);
  }
  return output;
}

ProtocolRecord decodeRecord(const std::vector<std::uint8_t>& bytes, std::size_t depth) {
  if (bytes.size() > kMaximumControlRecordBytes) {
    throw ProtocolException(ProtocolFailure::payloadTooLarge, "Native protocol control record exceeds its limit");
  }
  if (depth > kMaximumRecordDepth) {
    throw ProtocolException(ProtocolFailure::malformedRecord, "Native protocol record nesting exceeds its limit");
  }
  Reader reader(bytes);
  for (const auto expected : kMagic) {
    if (reader.integer<std::uint8_t>() != expected) {
      throw ProtocolException(ProtocolFailure::malformedRecord, "Native protocol record magic is invalid");
    }
  }
  if (reader.integer<std::uint32_t>() != kProtocolVersion) {
    throw ProtocolException(ProtocolFailure::incompatibleVersion, "Native protocol record version is incompatible");
  }
  const auto rawKind = reader.integer<std::uint16_t>();
  const auto knownKind = std::find_if(
      kRecordKindDescriptors.begin(),
      kRecordKindDescriptors.end(),
      [rawKind](const RecordKindDescriptor& descriptor) {
        return static_cast<std::uint16_t>(descriptor.kind) == rawKind;
      });
  if (knownKind == kRecordKindDescriptors.end()) {
    throw ProtocolException(ProtocolFailure::unknownRecord, "Native protocol record kind is unknown");
  }
  ProtocolRecord record{.kind = static_cast<RecordKind>(rawKind), .fields = {}};
  const auto count = reader.integer<std::uint16_t>();
  record.fields.reserve(count);
  for (std::uint16_t index = 0U; index < count; index += 1U) {
    const auto fieldId = reader.integer<std::uint16_t>();
    const auto tag = static_cast<ValueTag>(reader.integer<std::uint8_t>());
    record.fields.push_back(ProtocolField{
        .id = fieldId,
        .value = decodeValue(tag, reader.bytes(reader.integer<std::uint32_t>()), depth),
    });
  }
  if (!reader.empty()) {
    throw ProtocolException(ProtocolFailure::malformedRecord, "Native protocol record has trailing data");
  }
  return record;
}

const ProtocolRecordReference* recordField(const ProtocolRecord& record, std::uint16_t fieldId) {
  const auto found = std::find_if(
      record.fields.begin(),
      record.fields.end(),
      [fieldId](const ProtocolField& field) { return field.id == fieldId; });
  return found == record.fields.end() ? nullptr : std::get_if<ProtocolRecordReference>(&found->value);
}

const std::string* stringField(const ProtocolRecord& record, std::uint16_t fieldId) {
  const auto found = std::find_if(
      record.fields.begin(),
      record.fields.end(),
      [fieldId](const ProtocolField& field) { return field.id == fieldId; });
  return found == record.fields.end() ? nullptr : std::get_if<std::string>(&found->value);
}

const std::uint64_t* unsignedIntegerField(const ProtocolRecord& record, std::uint16_t fieldId) {
  const auto found = std::find_if(
      record.fields.begin(),
      record.fields.end(),
      [fieldId](const ProtocolField& field) { return field.id == fieldId; });
  return found == record.fields.end() ? nullptr : std::get_if<std::uint64_t>(&found->value);
}

bool hasField(const ProtocolRecord& record, std::uint16_t fieldId) {
  return std::any_of(
      record.fields.begin(),
      record.fields.end(),
      [fieldId](const ProtocolField& field) { return field.id == fieldId; });
}

const ProtocolRecord* attachmentFor(const ProtocolRecord& record);
bool attachmentsEqual(const ProtocolRecord& left, const ProtocolRecord& right);

void requireFieldSet(
    const ProtocolRecord& record,
    std::initializer_list<std::uint16_t> required,
    std::initializer_list<std::uint16_t> optional) {
  for (const auto fieldId : required) {
    if (!hasField(record, fieldId)) {
      throw ProtocolException(ProtocolFailure::missingField, "Native protocol semantic field is required");
    }
  }
  for (const auto& field : record.fields) {
    const bool allowed =
        std::find(required.begin(), required.end(), field.id) != required.end() ||
        std::find(optional.begin(), optional.end(), field.id) != optional.end();
    if (!allowed) {
      throw ProtocolException(ProtocolFailure::malformedRecord, "Native protocol field is forbidden for this kind");
    }
  }
}

void requireExactlyOne(const ProtocolRecord& record, std::uint16_t left, std::uint16_t right) {
  if (hasField(record, left) == hasField(record, right)) {
    throw ProtocolException(ProtocolFailure::malformedRecord, "Native protocol requires exactly one path kind");
  }
}

void requireSameAttachment(
    const ProtocolRecord& authority,
    const ProtocolRecord& candidate,
    const char* message) {
  const auto* authorityAttachment = attachmentFor(authority);
  const auto* candidateAttachment = attachmentFor(candidate);
  if (authorityAttachment == nullptr ||
      candidateAttachment == nullptr ||
      !attachmentsEqual(*authorityAttachment, *candidateAttachment)) {
    throw ProtocolException(ProtocolFailure::stalePath, message);
  }
}

void requireBinaryCorrelation(
    const ProtocolRecord& correlation,
    const ProtocolRecord& binaryReference) {
  const auto* nonce = stringField(correlation, 3U);
  const auto* binaryCorrelation = stringField(binaryReference, 5U);
  if (nonce == nullptr || binaryCorrelation == nullptr || *nonce != *binaryCorrelation) {
    throw ProtocolException(ProtocolFailure::invalidCorrelation, "Native binary reference belongs to another operation");
  }
}

void validateCommandSemantics(const ProtocolRecord& record) {
  const auto* kind = stringField(record, 3U);
  if (kind == nullptr) {
    throw ProtocolException(ProtocolFailure::missingField, "Native protocol command kind is missing");
  }
  if (*kind == "scanStart") {
    requireFieldSet(record, {1U, 2U, 3U, 12U}, {});
  } else if (*kind == "scanStop" || *kind == "destroy") {
    requireFieldSet(record, {1U, 2U, 3U}, {});
  } else if (*kind == "connect" || *kind == "disconnect") {
    requireFieldSet(record, {1U, 2U, 3U, 10U}, {});
  } else if (*kind == "discover") {
    requireFieldSet(record, {1U, 2U, 3U, 10U, 11U}, {});
  } else if (*kind == "read") {
    requireFieldSet(record, {1U, 2U, 3U}, {4U, 5U});
    requireExactlyOne(record, 4U, 5U);
  } else if (*kind == "write") {
    requireFieldSet(record, {1U, 2U, 3U, 6U, 13U}, {4U, 5U});
    requireExactlyOne(record, 4U, 5U);
  } else if (*kind == "readDescriptor") {
    requireFieldSet(record, {1U, 2U, 3U, 5U}, {});
  } else if (*kind == "writeDescriptor") {
    requireFieldSet(record, {1U, 2U, 3U, 5U, 6U}, {});
  } else if (*kind == "subscribe" || *kind == "unsubscribe") {
    requireFieldSet(record, {1U, 2U, 3U, 4U, 7U}, {});
  } else if (*kind == "cancel") {
    requireFieldSet(record, {1U, 2U, 3U, 8U}, {});
  } else if (*kind == "adoptRestoration") {
    requireFieldSet(record, {1U, 2U, 3U, 9U}, {});
  }
}

void validateResultSemantics(const ProtocolRecord& record) {
  const auto* kind = stringField(record, 2U);
  const auto* terminalRecord = recordField(record, 3U);
  if (kind == nullptr || terminalRecord == nullptr || !*terminalRecord) {
    throw ProtocolException(ProtocolFailure::missingField, "Native protocol result authority is missing");
  }
  const auto* outcome = stringField(**terminalRecord, 2U);
  if (outcome != nullptr && *outcome == "failed") {
    requireFieldSet(record, {1U, 2U, 3U, 10U}, {});
    return;
  }
  if (*kind == "accepted" || *kind == "scanStarted" || *kind == "write" || *kind == "destroyed") {
    requireFieldSet(record, {1U, 2U, 3U}, {});
  } else if (*kind == "connected") {
    requireFieldSet(record, {1U, 2U, 3U, 11U}, {});
  } else if (*kind == "database") {
    requireFieldSet(record, {1U, 2U, 3U, 4U, 12U}, {});
  } else if (*kind == "read") {
    requireFieldSet(record, {1U, 2U, 3U, 5U, 6U}, {});
  } else if (*kind == "descriptorRead") {
    requireFieldSet(record, {1U, 2U, 3U, 6U, 15U}, {});
  } else if (*kind == "descriptorWrite") {
    requireFieldSet(record, {1U, 2U, 3U, 15U}, {});
  } else if (*kind == "subscribed" || *kind == "unsubscribed") {
    requireFieldSet(record, {1U, 2U, 3U, 5U, 7U}, {});
  } else if (*kind == "cancelled") {
    requireFieldSet(record, {1U, 2U, 3U, 8U}, {});
  } else if (*kind == "restoration") {
    requireFieldSet(record, {1U, 2U, 3U, 9U}, {});
  }
}

void validateEventSemantics(const ProtocolRecord& record) {
  const auto* kind = stringField(record, 3U);
  if (kind == nullptr) {
    throw ProtocolException(ProtocolFailure::missingField, "Native protocol event kind is missing");
  }
  if (*kind == "adapterState") {
    requireFieldSet(record, {1U, 2U, 3U, 4U, 5U, 6U, 15U}, {});
  } else if (*kind == "backendRestarted" || *kind == "restorationAvailable") {
    requireFieldSet(record, {1U, 2U, 3U, 4U, 5U, 6U}, {});
  } else if (*kind == "advertisement") {
    requireFieldSet(record, {1U, 2U, 3U, 4U, 5U, 6U, 12U}, {});
  } else if (*kind == "connectionLost") {
    requireFieldSet(record, {1U, 2U, 3U, 4U, 5U, 6U, 7U, 14U}, {});
  } else if (*kind == "databaseChanged") {
    requireFieldSet(record, {1U, 2U, 3U, 4U, 5U, 6U, 8U}, {});
  } else if (*kind == "notification") {
    requireFieldSet(record, {1U, 2U, 3U, 4U, 5U, 6U, 9U, 11U, 13U}, {10U});
  } else if (*kind == "diagnostic") {
    requireFieldSet(record, {1U, 2U, 3U, 4U, 5U, 6U, 14U}, {10U});
  }
}

void validateRestorationRecordSemantics(const ProtocolRecord& record) {
  const auto* kind = stringField(record, 6U);
  if (kind == nullptr) {
    throw ProtocolException(ProtocolFailure::missingField, "Native restoration kind is missing");
  }
  if (*kind == "adapter") {
    requireFieldSet(record, {1U, 2U, 3U, 4U, 5U, 6U}, {});
  } else if (*kind == "connection") {
    requireFieldSet(record, {1U, 2U, 3U, 4U, 5U, 6U, 7U, 8U}, {});
  } else if (*kind == "subscription") {
    requireFieldSet(record, {1U, 2U, 3U, 4U, 5U, 6U, 7U, 8U, 9U, 10U}, {});
  } else if (*kind == "event") {
    requireFieldSet(record, {1U, 2U, 3U, 4U, 5U, 6U, 11U}, {});
  }
}

const ProtocolRecord* attachmentFor(const ProtocolRecord& record) {
  switch (record.kind) {
    case RecordKind::attachment:
      return &record;
    case RecordKind::connectionPath:
    case RecordKind::operationCorrelation: {
      const auto* nested = recordField(record, 1U);
      return nested != nullptr && *nested ? attachmentFor(**nested) : nullptr;
    }
    case RecordKind::databasePath:
    case RecordKind::servicePath:
    case RecordKind::characteristicPath:
    case RecordKind::descriptorPath: {
      const auto* nested = recordField(record, 1U);
      return nested != nullptr && *nested ? attachmentFor(**nested) : nullptr;
    }
    default:
      return nullptr;
  }
}

bool attachmentsEqual(const ProtocolRecord& left, const ProtocolRecord& right) {
  if (left.kind != RecordKind::attachment || right.kind != RecordKind::attachment) {
    return false;
  }
  for (std::uint16_t fieldId = 1U; fieldId <= 5U; fieldId += 1U) {
    const auto* leftValue = stringField(left, fieldId);
    const auto* rightValue = stringField(right, fieldId);
    if (leftValue == nullptr || rightValue == nullptr || *leftValue != *rightValue) {
      return false;
    }
  }
  return true;
}

std::uint32_t selectVersion(VersionRange range, std::uint32_t supported, const char* axis) {
  if (range.minimum == 0U || range.minimum > range.maximum || range.minimum > supported || range.maximum < supported) {
    throw ProtocolException(ProtocolFailure::incompatibleVersion, std::string("Incompatible native protocol axis: ") + axis);
  }
  return supported;
}

} // namespace

ProtocolException::ProtocolException(ProtocolFailure failure, const std::string& message)
    : std::runtime_error(message), failure_(failure) {}

ProtocolFailure ProtocolException::failure() const noexcept {
  return failure_;
}

std::vector<std::uint8_t> NativeProtocolV1Codec::encode(const ProtocolRecord& record) const {
  validate(record);
  return encodeRecord(record);
}

ProtocolRecord NativeProtocolV1Codec::decode(const std::vector<std::uint8_t>& bytes) const {
  auto record = decodeRecord(bytes, 0U);
  validate(record);
  return record;
}

void NativeProtocolV1Codec::validate(const ProtocolRecord& record) const {
  validateRecord(record, 0U);
}

void NativeProtocolV1Codec::validateRecord(const ProtocolRecord& record, std::size_t depth) const {
  if (depth > kMaximumRecordDepth) {
    throw ProtocolException(ProtocolFailure::malformedRecord, "Native protocol record nesting exceeds its limit");
  }
  std::set<std::uint16_t> observed;
  for (const auto& field : record.fields) {
    const auto* definition = descriptor(record.kind, field.id);
    if (definition == nullptr) {
      throw ProtocolException(ProtocolFailure::unknownField, "Native protocol record contains an unknown field");
    }
    if (!observed.insert(field.id).second) {
      throw ProtocolException(ProtocolFailure::duplicateField, "Native protocol record contains a duplicate field");
    }
    const auto type = definition->type;
    const bool validScalar =
        (type == "boolean" && std::holds_alternative<bool>(field.value)) ||
        (type == "int64" && std::holds_alternative<std::int64_t>(field.value)) ||
        (type == "uint64" && std::holds_alternative<std::uint64_t>(field.value)) ||
        ((type == "string" || type.starts_with("enum:")) && std::holds_alternative<std::string>(field.value)) ||
        (type == "strings" && std::holds_alternative<ProtocolStringList>(field.value));
    if (validScalar) {
      if (const auto* value = std::get_if<std::string>(&field.value);
          value != nullptr && (value->empty() || !enumValueAllowed(type, *value))) {
        throw ProtocolException(
            type.starts_with("enum:") ? ProtocolFailure::invalidEnumValue : ProtocolFailure::invalidFieldType,
            "Native protocol string or enum field is invalid");
      }
      continue;
    }
    constexpr std::string_view recordPrefix = "record:";
    constexpr std::string_view recordsPrefix = "records:";
    if (type.starts_with(recordPrefix)) {
      const auto* nested = std::get_if<ProtocolRecordReference>(&field.value);
      if (nested == nullptr || !*nested || (*nested)->kind != recordKindForName(type.substr(recordPrefix.size()))) {
        throw ProtocolException(ProtocolFailure::invalidFieldType, "Native protocol nested record kind is invalid");
      }
      validateRecord(**nested, depth + 1U);
      continue;
    }
    if (type.starts_with(recordsPrefix)) {
      const auto* nested = std::get_if<ProtocolRecordList>(&field.value);
      const auto expected = recordKindForName(type.substr(recordsPrefix.size()));
      if (nested == nullptr) {
        throw ProtocolException(ProtocolFailure::invalidFieldType, "Native protocol record list type is invalid");
      }
      for (const auto& item : *nested) {
        if (!item || item->kind != expected) {
          throw ProtocolException(ProtocolFailure::invalidFieldType, "Native protocol record list item is invalid");
        }
        validateRecord(*item, depth + 1U);
      }
      continue;
    }
    throw ProtocolException(ProtocolFailure::invalidFieldType, "Native protocol field type does not match schema");
  }
  for (const auto& definition : kFieldDescriptors) {
    if (definition.record == record.kind && definition.required && !observed.contains(definition.fieldId)) {
      throw ProtocolException(ProtocolFailure::missingField, "Native protocol record is missing a required field");
    }
  }

  if (record.kind == RecordKind::terminal) {
    const auto* outcome = stringField(record, 2U);
    const auto* cause = stringField(record, 3U);
    if (outcome == nullptr || ((*outcome == "succeeded") != (cause == nullptr))) {
      throw ProtocolException(ProtocolFailure::malformedRecord, "Native protocol terminal outcome and cause disagree");
    }
  }
  if (record.kind == RecordKind::command ||
      record.kind == RecordKind::result ||
      record.kind == RecordKind::event ||
      record.kind == RecordKind::restorationRecord) {
    const auto* version = unsignedIntegerField(record, 1U);
    if (version == nullptr || *version != kProtocolVersion) {
      throw ProtocolException(ProtocolFailure::incompatibleVersion, "Native protocol payload version is incompatible");
    }
  }
  if (record.kind == RecordKind::command) {
    const auto* correlation = recordField(record, 2U);
    const ProtocolRecord* commandAttachment =
        correlation != nullptr && *correlation ? attachmentFor(**correlation) : nullptr;
    for (const auto fieldId : {4U, 5U, 10U, 11U}) {
      const auto* path = recordField(record, fieldId);
      const ProtocolRecord* pathAttachment = path != nullptr && *path ? attachmentFor(**path) : nullptr;
      if (pathAttachment != nullptr &&
          (commandAttachment == nullptr || !attachmentsEqual(*commandAttachment, *pathAttachment))) {
        throw ProtocolException(ProtocolFailure::stalePath, "Native protocol command path attachment is stale");
      }
    }
    const auto* cancellation = recordField(record, 8U);
    if (cancellation != nullptr && *cancellation && commandAttachment != nullptr) {
      requireSameAttachment(**correlation, **cancellation, "Native cancellation correlation is stale");
    }
    const auto* binary = recordField(record, 6U);
    if (binary != nullptr && *binary && correlation != nullptr && *correlation) {
      requireBinaryCorrelation(**correlation, **binary);
    }
    validateCommandSemantics(record);
  }
  if (record.kind == RecordKind::result) {
    validateResultSemantics(record);
    const auto* terminalRecord = recordField(record, 3U);
    if (terminalRecord != nullptr && *terminalRecord) {
      const auto* terminalCorrelation = recordField(**terminalRecord, 1U);
      for (const auto fieldId : {4U, 5U, 11U}) {
        const auto* path = recordField(record, fieldId);
        if (path != nullptr && *path && terminalCorrelation != nullptr && *terminalCorrelation) {
          requireSameAttachment(**terminalCorrelation, **path, "Native result path is stale");
        }
      }
      const auto* binary = recordField(record, 6U);
      if (binary != nullptr && *binary && terminalCorrelation != nullptr && *terminalCorrelation) {
        requireBinaryCorrelation(**terminalCorrelation, **binary);
      }
    }
  }
  if (record.kind == RecordKind::event) {
    validateEventSemantics(record);
    const auto* attachment = recordField(record, 4U);
    if (attachment != nullptr && *attachment) {
      for (const auto fieldId : {7U, 8U, 9U, 10U}) {
        const auto* path = recordField(record, fieldId);
        if (path != nullptr && *path) {
          requireSameAttachment(**attachment, **path, "Native event path or correlation is stale");
        }
      }
    }
    const auto* operation = recordField(record, 10U);
    const auto* binary = recordField(record, 13U);
    if (operation != nullptr && *operation && binary != nullptr && *binary) {
      requireBinaryCorrelation(**operation, **binary);
    }
  }
  if (record.kind == RecordKind::binaryReference) {
    const auto* offset = unsignedIntegerField(record, 2U);
    const auto* length = unsignedIntegerField(record, 3U);
    if (offset == nullptr ||
        length == nullptr ||
        *offset > kMaximumBinaryPayloadBytes ||
        *length > kMaximumBinaryPayloadBytes - *offset) {
      throw ProtocolException(ProtocolFailure::payloadTooLarge, "Native binary reference range exceeds its limit");
    }
  }
  if (record.kind == RecordKind::operationCorrelation) {
    const auto* epoch = unsignedIntegerField(record, 2U);
    if (epoch == nullptr || *epoch == 0U) {
      throw ProtocolException(ProtocolFailure::invalidCorrelation, "Native operation dispatch epoch must be positive");
    }
  }
  if (record.kind == RecordKind::restorationRecord) {
    validateRestorationRecordSemantics(record);
    const auto* authority = recordField(record, 3U);
    if (authority != nullptr && *authority) {
      for (const auto fieldId : {8U, 9U, 11U}) {
        const auto* nested = recordField(record, fieldId);
        if (nested != nullptr && *nested) {
          requireSameAttachment(**authority, **nested, "Native restoration nested path is stale");
        }
      }
    }
  }
  if (record.kind == RecordKind::restorationAdoptionRequest) {
    const auto* minimum = unsignedIntegerField(record, 5U);
    const auto* maximum = unsignedIntegerField(record, 6U);
    if (minimum == nullptr ||
        maximum == nullptr ||
        *minimum == 0U ||
        *minimum > *maximum ||
        *minimum > kProtocolVersion ||
        *maximum < kProtocolVersion) {
      throw ProtocolException(ProtocolFailure::incompatibleVersion, "Restoration protocol range is incompatible");
    }
  }
  if (record.kind == RecordKind::restorationAdoptionResult) {
    const auto* outcome = stringField(record, 6U);
    const auto* receipt = stringField(record, 2U);
    const auto recordsField = std::find_if(
        record.fields.begin(),
        record.fields.end(),
        [](const ProtocolField& field) { return field.id == 7U; });
    const auto* records =
        recordsField == record.fields.end() ? nullptr : std::get_if<ProtocolRecordList>(&recordsField->value);
    const bool adopted = outcome != nullptr && *outcome == "adopted";
    if (receipt == nullptr || records == nullptr || (!adopted && !records->empty())) {
      throw ProtocolException(ProtocolFailure::malformedRecord, "Restoration adoption result authority is invalid");
    }
  }
}

NegotiatedVersions NativeProtocolV1Codec::negotiate(
    VersionRange nativeProtocol,
    VersionRange abi,
    VersionRange backendContract,
    VersionRange capabilitySchema,
    VersionRange eventSchema,
    VersionRange traceFormat) {
  return {
      .nativeProtocol = selectVersion(nativeProtocol, kProtocolVersion, "native-protocol"),
      .abi = selectVersion(abi, kAbiVersion, "abi"),
      .backendContract = selectVersion(backendContract, 1U, "backend-contract"),
      .capabilitySchema = selectVersion(capabilitySchema, 1U, "capability-schema"),
      .eventSchema = selectVersion(eventSchema, 1U, "event-schema"),
      .traceFormat = selectVersion(traceFormat, 1U, "trace-format"),
  };
}

} // namespace unified_ble::native_protocol::v1
