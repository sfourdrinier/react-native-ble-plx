// android/src/main/java/com/sfourdrinier/unifiedblemanager/protocol/ProtocolCommandDecoder.kt

package com.sfourdrinier.unifiedblemanager.protocol

import com.sfourdrinier.unifiedblemanager.protocol.generated.MAXIMUM_CONTROL_RECORD_BYTES
import com.sfourdrinier.unifiedblemanager.protocol.generated.NATIVE_PROTOCOL_FIELDS
import com.sfourdrinier.unifiedblemanager.protocol.generated.NATIVE_PROTOCOL_VERSION
import com.sfourdrinier.unifiedblemanager.protocol.generated.RecordKind
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.charset.StandardCharsets

internal data class ProtocolWireRecord(
  val kind: RecordKind,
  val fields: Map<Int, ProtocolWireValue>
)

internal sealed interface ProtocolWireValue {
  data class BooleanValue(val value: Boolean) : ProtocolWireValue
  data class SignedIntegerValue(val value: Long) : ProtocolWireValue
  data class UnsignedIntegerValue(val value: Long) : ProtocolWireValue
  data class StringValue(val value: String) : ProtocolWireValue
  data class StringListValue(val value: List<String>) : ProtocolWireValue
  data class RecordValue(val value: ProtocolWireRecord) : ProtocolWireValue
  data class RecordListValue(val value: List<ProtocolWireRecord>) : ProtocolWireValue
}

/**
 * Decodes command operands only after the C++ canonical codec has accepted the
 * same bytes at the JSI boundary. It does not convert bytes through JSON/Base64.
 */
internal object ProtocolCommandDecoder {
  private const val MAXIMUM_NESTING_DEPTH = 16
  private const val BOOLEAN_TAG = 1
  private const val SIGNED_INTEGER_TAG = 2
  private const val UNSIGNED_INTEGER_TAG = 3
  private const val STRING_TAG = 4
  private const val STRINGS_TAG = 5
  private const val RECORD_TAG = 6
  private const val RECORDS_TAG = 7
  private val magic = byteArrayOf(0x55, 0x42, 0x4e, 0x31)

  fun decodeCommand(bytes: ByteArray): ProtocolWireRecord {
    require(bytes.size <= MAXIMUM_CONTROL_RECORD_BYTES) { "Native protocol control record exceeds its limit" }
    val command = decodeRecord(bytes, 0)
    require(command.kind == RecordKind.COMMAND) { "Native protocol dispatch requires a command record" }
    return command
  }

  private fun decodeRecord(bytes: ByteArray, depth: Int): ProtocolWireRecord {
    require(depth <= MAXIMUM_NESTING_DEPTH) { "Native protocol record nesting exceeds its limit" }
    val reader = ProtocolReader(bytes)
    for (expected in magic) {
      require(reader.byte() == expected) { "Native protocol record magic is invalid" }
    }
    require(reader.uint32() == NATIVE_PROTOCOL_VERSION.toLong()) { "Native protocol record version is incompatible" }
    val wireKind = reader.uint16()
    val kind = RecordKind.entries.firstOrNull { candidate -> candidate.wireValue == wireKind }
      ?: throw IllegalArgumentException("Native protocol record kind $wireKind is unknown")
    val fieldCount = reader.uint16()
    val fields = mutableMapOf<Int, ProtocolWireValue>()
    repeat(fieldCount) {
      val fieldId = reader.uint16()
      require(!fields.containsKey(fieldId)) { "Native protocol record has duplicate fields" }
      val descriptor = NATIVE_PROTOCOL_FIELDS.firstOrNull { candidate ->
        candidate.record == kind && candidate.fieldId == fieldId
      } ?: throw IllegalArgumentException("Native protocol field is unknown")
      val tag = reader.byte().toInt() and 0xff
      val payload = reader.bytes(reader.uint32().toInt())
      fields[fieldId] = decodeValue(payload, tag, descriptor.type, depth)
    }
    require(reader.exhausted()) { "Native protocol record has trailing bytes" }
    NATIVE_PROTOCOL_FIELDS
      .filter { descriptor -> descriptor.record == kind && descriptor.required }
      .forEach { descriptor ->
        require(fields.containsKey(descriptor.fieldId)) { "Native protocol record is missing a required field" }
      }
    return ProtocolWireRecord(kind, fields)
  }

  private fun decodeValue(
    payload: ByteArray,
    tag: Int,
    expectedType: String,
    depth: Int
  ): ProtocolWireValue {
    val reader = ProtocolReader(payload)
    val value = when {
      expectedType == "boolean" -> {
        require(tag == BOOLEAN_TAG) { "Native protocol boolean wire type is invalid" }
        val raw = reader.byte().toInt() and 0xff
        require(raw == 0 || raw == 1) { "Native protocol boolean is malformed" }
        ProtocolWireValue.BooleanValue(raw == 1)
      }
      expectedType == "int64" -> {
        require(tag == SIGNED_INTEGER_TAG) { "Native protocol signed integer wire type is invalid" }
        ProtocolWireValue.SignedIntegerValue(reader.int64())
      }
      expectedType == "uint64" -> {
        require(tag == UNSIGNED_INTEGER_TAG) { "Native protocol unsigned integer wire type is invalid" }
        val unsigned = reader.int64()
        require(unsigned >= 0) { "Native protocol unsigned integer exceeds Android range" }
        ProtocolWireValue.UnsignedIntegerValue(unsigned)
      }
      expectedType == "string" || expectedType.startsWith("enum:") -> {
        require(tag == STRING_TAG) { "Native protocol string wire type is invalid" }
        ProtocolWireValue.StringValue(reader.string())
      }
      expectedType == "strings" -> {
        require(tag == STRINGS_TAG) { "Native protocol string-list wire type is invalid" }
        val count = reader.uint32().toInt()
        ProtocolWireValue.StringListValue(List(count) { reader.string() })
      }
      expectedType.startsWith("record:") -> {
        require(tag == RECORD_TAG) { "Native protocol nested record wire type is invalid" }
        val nested = decodeRecord(payload, depth + 1)
        require(recordKindSchemaName(nested.kind) == expectedType.removePrefix("record:")) {
          "Native protocol nested record kind is invalid"
        }
        ProtocolWireValue.RecordValue(nested)
      }
      expectedType.startsWith("records:") -> {
        require(tag == RECORDS_TAG) { "Native protocol nested record-list wire type is invalid" }
        val expectedKind = expectedType.removePrefix("records:")
        val count = reader.uint32().toInt()
        val values = List(count) {
          val nested = decodeRecord(reader.bytes(reader.uint32().toInt()), depth + 1)
          require(recordKindSchemaName(nested.kind) == expectedKind) {
            "Native protocol nested record-list kind is invalid"
          }
          nested
        }
        ProtocolWireValue.RecordListValue(values)
      }
      else -> throw IllegalArgumentException("Native protocol field type is unsupported")
    }
    require(reader.exhausted() || expectedType.startsWith("record:")) { "Native protocol field has trailing bytes" }
    return value
  }

  private class ProtocolReader(private val source: ByteArray) {
    private var offset = 0

    fun byte(): Byte {
      requireAvailable(1)
      return source[offset++]
    }

    fun uint16(): Int {
      return ByteBuffer.wrap(bytes(2)).order(ByteOrder.LITTLE_ENDIAN).short.toInt() and 0xffff
    }

    fun uint32(): Long {
      return ByteBuffer.wrap(bytes(4)).order(ByteOrder.LITTLE_ENDIAN).int.toLong() and 0xffffffffL
    }

    fun int64(): Long = ByteBuffer.wrap(bytes(8)).order(ByteOrder.LITTLE_ENDIAN).long

    fun string(): String = String(bytes(uint32().toInt()), StandardCharsets.UTF_8)

    fun bytes(length: Int): ByteArray {
      require(length >= 0) { "Native protocol byte length is invalid" }
      requireAvailable(length)
      val result = source.copyOfRange(offset, offset + length)
      offset += length
      return result
    }

    fun exhausted(): Boolean = offset == source.size

    private fun requireAvailable(length: Int) {
      require(length <= source.size - offset) { "Native protocol record is truncated" }
    }
  }

  private fun recordKindSchemaName(kind: RecordKind): String {
    val segments = kind.name.lowercase().split('_')
    return buildString {
      append(segments.first())
      segments.drop(1).forEach { segment ->
        append(segment.replaceFirstChar { character -> character.uppercase() })
      }
    }
  }
}

internal fun ProtocolWireRecord.requiredRecord(fieldId: Int): ProtocolWireRecord {
  val value = fields[fieldId]
  return if (value is ProtocolWireValue.RecordValue) {
    value.value
  } else {
    throw IllegalArgumentException("Native protocol record field is missing")
  }
}

internal fun ProtocolWireRecord.requiredString(fieldId: Int): String {
  val value = fields[fieldId]
  return if (value is ProtocolWireValue.StringValue && value.value.isNotEmpty()) {
    value.value
  } else {
    throw IllegalArgumentException("Native protocol string field is missing")
  }
}

internal fun ProtocolWireRecord.requiredUnsigned(fieldId: Int): Long {
  val value = fields[fieldId]
  return if (value is ProtocolWireValue.UnsignedIntegerValue && value.value >= 0) {
    value.value
  } else {
    throw IllegalArgumentException("Native protocol unsigned field is missing")
  }
}

internal fun ProtocolWireRecord.optionalRecord(fieldId: Int): ProtocolWireRecord? {
  val value = fields[fieldId]
  return if (value is ProtocolWireValue.RecordValue) value.value else null
}

internal fun ProtocolWireRecord.optionalString(fieldId: Int): String? {
  val value = fields[fieldId]
  return if (value is ProtocolWireValue.StringValue) value.value else null
}
