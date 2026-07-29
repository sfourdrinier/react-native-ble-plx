// android/src/test/java/com/sfourdrinier/unifiedblemanager/protocol/UnifiedBleProtocolAndroidDispatcherLifecycleTest.kt

package com.sfourdrinier.unifiedblemanager.protocol

import com.sfourdrinier.unifiedblemanager.protocol.generated.RecordKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class UnifiedBleProtocolAndroidDispatcherLifecycleTest {
  @Test
  fun decodesTheCanonicalDestroyCommandUsedByTheDispatcher() {
    val correlation = ProtocolWireRecord(
      RecordKind.OPERATION_CORRELATION,
      mapOf(
        1 to ProtocolWireValue.StringValue("android-native-protocol-test"),
        2 to ProtocolWireValue.UnsignedIntegerValue(7L),
        3 to ProtocolWireValue.StringValue("destroy-command")
      )
    )
    val command = ProtocolWireRecord(
      RecordKind.COMMAND,
      mapOf(
        1 to ProtocolWireValue.UnsignedIntegerValue(1L),
        2 to ProtocolWireValue.RecordValue(correlation),
        3 to ProtocolWireValue.StringValue("destroy")
      )
    )

    assertEquals(command, ProtocolCommandDecoder.decodeCommand(ProtocolWireEncoder.encode(command)))
  }

  @Test
  fun mapsDispatcherCommandsToTheirCanonicalResultKinds() {
    assertEquals("scanStarted", dispatcherResultKindFor("scanStart"))
    assertEquals("connected", dispatcherResultKindFor("connect"))
    assertEquals("database", dispatcherResultKindFor("discover"))
    assertEquals("read", dispatcherResultKindFor("read"))
    assertEquals("descriptorWrite", dispatcherResultKindFor("writeDescriptor"))
    assertEquals("destroyed", dispatcherResultKindFor("destroy"))
    assertEquals("accepted", dispatcherResultKindFor("disconnect"))
  }

  @Test
  fun connectionLostEventPreservesCanonicalConnectionAndTerminalStatus() {
    val attachment = ProtocolWireRecord(
      RecordKind.ATTACHMENT,
      mapOf(
        1 to ProtocolWireValue.StringValue("attachment-1"),
        2 to ProtocolWireValue.StringValue("backend-1"),
        3 to ProtocolWireValue.StringValue("generation-1"),
        4 to ProtocolWireValue.StringValue("adapter-1"),
        5 to ProtocolWireValue.StringValue("adapter-generation-1")
      )
    )
    val connection = ProtocolWireRecord(
      RecordKind.CONNECTION_PATH,
      mapOf(
        1 to ProtocolWireValue.RecordValue(attachment),
        2 to ProtocolWireValue.StringValue("C0FFEE000001"),
        3 to ProtocolWireValue.StringValue("connection-1"),
        4 to ProtocolWireValue.StringValue("lease-1"),
        5 to ProtocolWireValue.StringValue("connection-generation-1")
      )
    )

    val event = connectionLostEvent(17L, connection, 133, 3L, 99L)

    assertEquals(RecordKind.EVENT, event.kind)
    assertEquals(ProtocolWireValue.StringValue("connectionLost"), event.fields[3])
    assertEquals(ProtocolWireValue.RecordValue(attachment), event.fields[4])
    assertEquals(ProtocolWireValue.RecordValue(connection), event.fields[7])
    assertEquals(ProtocolWireValue.UnsignedIntegerValue(3L), event.fields[5])
    assertEquals(ProtocolWireValue.UnsignedIntegerValue(99L), event.fields[6])
    val errorValue = event.fields[14]
    if (errorValue !is ProtocolWireValue.RecordValue) {
      throw AssertionError("Connection-lost event is missing its canonical error record")
    }
    val error = errorValue.value
    assertEquals(ProtocolWireValue.StringValue("connectionLost"), error.fields[1])
    assertEquals(ProtocolWireValue.SignedIntegerValue(133L), error.fields[8])
    assertTrue(ProtocolWireEncoder.encode(event).isNotEmpty())
  }
}
