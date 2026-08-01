// __tests__/core/trace-recorder.test.js

const {
  measureTraceDocumentBytes,
  measureTraceDocumentBytesFromRecordBytes,
  measureTraceRecordBytes,
  UNIFIED_BLE_TRACE_FORMAT,
  UNIFIED_BLE_TRACE_MAXIMUM_BYTES,
  validateTraceDocument,
  redactTraceDocument
} = require('../../src/diagnostics/trace-format')
const { CoreTraceRecorder } = require('../../src/core/trace-recorder')

function traceInput(resource, operation = null, transition = 'completed') {
  return {
    timestamp: 10,
    resource,
    transition,
    operation,
    cause: null,
    queuedOperations: 0,
    dispatchedOperations: 0,
    quarantinedOperations: 0
  }
}

describe('CoreTraceRecorder portable snapshots', () => {
  test('exports bounded redacted records with explicit rollover and operation correlation', () => {
    const recorder = new CoreTraceRecorder(2, 4096)

    recorder.record(traceInput('operation', 'operation-1'))
    recorder.record(traceInput('operation', 'operation-1'))
    recorder.record(traceInput('manager'))

    const document = recorder.snapshotDocument()

    expect(document).toMatchObject({ format: 'unified-ble-trace-v1', truncated: true })
    expect(document.records).toHaveLength(2)
    expect(document.records[0]).toMatchObject({
      ordinal: 2,
      kind: 'operation',
      correlation: 'operation-1',
      redactedClient: true,
      redactedPeer: true,
      redactedPath: true,
      redactedPayload: true
    })
    expect(document.records[1]).toMatchObject({ ordinal: 3, kind: 'attachment', correlation: null })
    expect(validateTraceDocument(document)).toEqual({ valid: true, failures: [] })
    expect(validateTraceDocument({ ...document, truncated: false })).toMatchObject({ valid: false })
  })

  test('enforces exact document boundaries for multibyte records and the empty envelope', () => {
    const emptyDocument = { format: UNIFIED_BLE_TRACE_FORMAT, truncated: false, records: [] }
    const emptyBytes = measureTraceDocumentBytes(emptyDocument)
    expect(measureTraceDocumentBytesFromRecordBytes(false, 0, 0)).toBe(emptyBytes)
    expect(measureTraceDocumentBytesFromRecordBytes(true, 0, 0)).toBe(
      measureTraceDocumentBytes({ ...emptyDocument, truncated: true })
    )
    expect(() => measureTraceDocumentBytesFromRecordBytes('false', 0, 0)).toThrow()
    expect(() => measureTraceDocumentBytesFromRecordBytes(false, 0, 1)).toThrow()
    expect(() => new CoreTraceRecorder(2, emptyBytes - 1)).toThrow()

    const unicodeTransition = 'é'.repeat(16)
    const exactDocument = {
      format: UNIFIED_BLE_TRACE_FORMAT,
      truncated: false,
      records: [
        {
          ordinal: 1,
          time: 10,
          kind: 'operation',
          event: unicodeTransition,
          cause: null,
          correlation: null,
          redactedClient: true,
          redactedPeer: true,
          redactedPath: true,
          redactedPayload: true
        }
      ]
    }
    const exactBytes = measureTraceDocumentBytes(exactDocument)
    expect(exactBytes).toBe(Buffer.byteLength(JSON.stringify(exactDocument), 'utf8'))
    expect(measureTraceDocumentBytesFromRecordBytes(false, 1, measureTraceRecordBytes(exactDocument.records[0]))).toBe(
      exactBytes
    )
    const secondRecord = { ...exactDocument.records[0], ordinal: 2, time: 11 }
    const twoRecordDocument = { ...exactDocument, records: [exactDocument.records[0], secondRecord] }
    expect(
      measureTraceDocumentBytesFromRecordBytes(
        false,
        2,
        measureTraceRecordBytes(exactDocument.records[0]) + measureTraceRecordBytes(secondRecord)
      )
    ).toBe(measureTraceDocumentBytes(twoRecordDocument))

    const exactRecorder = new CoreTraceRecorder(2, exactBytes)
    exactRecorder.record(traceInput('operation', null, unicodeTransition))
    const exactSnapshot = exactRecorder.snapshotDocument()
    expect(exactSnapshot.records).toHaveLength(1)
    expect(measureTraceDocumentBytes(exactSnapshot)).toBe(exactBytes)
    expect(measureTraceDocumentBytes(exactSnapshot)).toBeLessThanOrEqual(exactBytes)

    const overBoundaryRecorder = new CoreTraceRecorder(2, exactBytes - 1)
    overBoundaryRecorder.record(traceInput('operation', null, unicodeTransition))
    const overBoundarySnapshot = overBoundaryRecorder.snapshotDocument()
    expect(overBoundarySnapshot.records).toHaveLength(0)
    expect(overBoundarySnapshot.truncated).toBe(true)
    expect(measureTraceDocumentBytes(overBoundarySnapshot)).toBeLessThanOrEqual(exactBytes - 1)
  })

  test('rejects oversized hostile documents before validation or redaction accepts them', () => {
    const oversizedEvent = 'é'.repeat(128)
    const oversizedDocument = {
      format: UNIFIED_BLE_TRACE_FORMAT,
      truncated: false,
      records: Array.from({ length: 2500 }, (_, index) => ({
        ordinal: index + 1,
        time: 10,
        kind: 'operation',
        event: oversizedEvent,
        cause: null,
        correlation: null,
        redactedClient: false,
        redactedPeer: false,
        redactedPath: false,
        redactedPayload: false
      }))
    }

    expect(measureTraceDocumentBytes(oversizedDocument)).toBeGreaterThan(UNIFIED_BLE_TRACE_MAXIMUM_BYTES)
    expect(validateTraceDocument(oversizedDocument)).toMatchObject({ valid: false })
    expect(() => redactTraceDocument(oversizedDocument)).toThrow()
  })

  test('clear starts a fresh valid capture with ordinal one', () => {
    const recorder = new CoreTraceRecorder(2, 4096)
    recorder.record(traceInput('operation', 'operation-1'))
    recorder.record(traceInput('operation', 'operation-2'))
    recorder.record(traceInput('operation', 'operation-3'))

    recorder.clear()
    const emptySnapshot = recorder.snapshotDocument()
    expect(emptySnapshot).toMatchObject({ truncated: false, records: [] })
    expect(validateTraceDocument(emptySnapshot)).toEqual({ valid: true, failures: [] })

    recorder.record(traceInput('operation', 'operation-1'))
    const freshSnapshot = recorder.snapshotDocument()
    expect(freshSnapshot).toMatchObject({ truncated: false, records: [{ ordinal: 1 }] })
    expect(validateTraceDocument(freshSnapshot)).toEqual({ valid: true, failures: [] })
  })

  test('rejects trace labels that could bypass the bounded portable contract', () => {
    const recorder = new CoreTraceRecorder(2, 4096)

    expect(() => recorder.record({ ...traceInput('operation'), transition: 'x'.repeat(129) })).toThrow()
    expect(() => recorder.record({ ...traceInput('operation'), operation: 'peer_sensitive_value' })).toThrow()
  })
})
