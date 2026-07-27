// android/src/main/java/com/sfourdrinier/unifiedblemanager/protocol/ProtocolWireEncoder.kt

package com.sfourdrinier.unifiedblemanager.protocol

import com.sfourdrinier.unifiedblemanager.protocol.generated.MAXIMUM_CONTROL_RECORD_BYTES
import com.sfourdrinier.unifiedblemanager.protocol.generated.NATIVE_PROTOCOL_FIELDS
import com.sfourdrinier.unifiedblemanager.protocol.generated.NATIVE_PROTOCOL_VERSION
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.charset.StandardCharsets

/** Canonical Android record encoder used only for metadata records; radio bytes stay native-owned. */
internal object ProtocolWireEncoder {
  private const val BOOLEAN_TAG = 1
  private const val SIGNED_INTEGER_TAG = 2
  private const val UNSIGNED_INTEGER_TAG = 3
  private const val STRING_TAG = 4
  private const val STRINGS_TAG = 5
  private const val RECORD_TAG = 6
  private const val RECORDS_TAG = 7
  private val magic = byteArrayOf(0x55, 0x42, 0x4e, 0x31)

  fun encode(record: ProtocolWireRecord): ByteArray = encodeRecord(record, 0)

  private fun encodeRecord(record: ProtocolWireRecord, depth: Int): ByteArray {
    require(depth <= 16) { "Native protocol record nesting exceeds its limit" }
    val output = ProtocolWriter()
    output.bytes(magic)
    output.uint32(NATIVE_PROTOCOL_VERSION.toLong())
    output.uint16(record.kind.wireValue)
    output.uint16(record.fields.size)
    record.fields.toSortedMap().forEach { (fieldId, value) ->
      val descriptor = NATIVE_PROTOCOL_FIELDS.firstOrNull { candidate ->
        candidate.record == record.kind && candidate.fieldId == fieldId
      } ?: throw IllegalArgumentException("Native protocol field is unknown")
      output.uint16(fieldId)
      output.bytes(encodeValue(value, descriptor.type, depth))
    }
    return output.result()
  }

  private fun encodeValue(value: ProtocolWireValue, expectedType: String, depth: Int): ByteArray {
    val payload = ProtocolWriter()
    val tag = when {
      expectedType == "boolean" && value is ProtocolWireValue.BooleanValue -> {
        payload.byte(if (value.value) 1 else 0)
        BOOLEAN_TAG
      }
      expectedType == "int64" && value is ProtocolWireValue.SignedIntegerValue -> {
        payload.int64(value.value)
        SIGNED_INTEGER_TAG
      }
      expectedType == "uint64" && value is ProtocolWireValue.UnsignedIntegerValue -> {
        require(value.value >= 0) { "Native protocol unsigned integer is invalid" }
        payload.int64(value.value)
        UNSIGNED_INTEGER_TAG
      }
      (expectedType == "string" || expectedType.startsWith("enum:")) && value is ProtocolWireValue.StringValue -> {
        payload.string(value.value)
        STRING_TAG
      }
      expectedType == "strings" && value is ProtocolWireValue.StringListValue -> {
        payload.uint32(value.value.size.toLong())
        value.value.forEach(payload::string)
        STRINGS_TAG
      }
      expectedType.startsWith("record:") && value is ProtocolWireValue.RecordValue -> {
        payload.bytes(encodeRecord(value.value, depth + 1))
        RECORD_TAG
      }
      expectedType.startsWith("records:") && value is ProtocolWireValue.RecordListValue -> {
        payload.uint32(value.value.size.toLong())
        value.value.forEach { nested ->
          val encoded = encodeRecord(nested, depth + 1)
          payload.uint32(encoded.size.toLong())
          payload.bytes(encoded)
        }
        RECORDS_TAG
      }
      else -> throw IllegalArgumentException("Native protocol field type does not match its value")
    }
    val encodedPayload = payload.result()
    val output = ProtocolWriter()
    output.byte(tag)
    output.uint32(encodedPayload.size.toLong())
    output.bytes(encodedPayload)
    return output.result()
  }

  private class ProtocolWriter {
    private val output = ByteArrayOutputStream()

    fun byte(value: Int) {
      require(value in 0..0xff) { "Native protocol byte is invalid" }
      output.write(value)
      require(output.size() <= MAXIMUM_CONTROL_RECORD_BYTES) { "Native protocol control record exceeds its limit" }
    }

    fun uint16(value: Int) {
      require(value in 0..0xffff) { "Native protocol uint16 is invalid" }
      bytes(ByteBuffer.allocate(2).order(ByteOrder.LITTLE_ENDIAN).putShort(value.toShort()).array())
    }

    fun uint32(value: Long) {
      require(value in 0..0xffffffffL) { "Native protocol uint32 is invalid" }
      bytes(ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(value.toInt()).array())
    }

    fun int64(value: Long) {
      bytes(ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN).putLong(value).array())
    }

    fun string(value: String) {
      val encoded = value.toByteArray(StandardCharsets.UTF_8)
      uint32(encoded.size.toLong())
      bytes(encoded)
    }

    fun bytes(value: ByteArray) {
      require(value.size <= MAXIMUM_CONTROL_RECORD_BYTES - output.size()) {
        "Native protocol control record exceeds its limit"
      }
      output.write(value)
    }

    fun result(): ByteArray = output.toByteArray()
  }
}
