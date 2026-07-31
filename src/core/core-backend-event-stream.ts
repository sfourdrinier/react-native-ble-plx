// src/core/core-backend-event-stream.ts

import { BackendContractError } from '../backend-contract/errors'
import { assertBackendEvent, type BackendEvent } from '../backend-contract/backend'
import type { CleanupRecord } from '../backend-contract/errors'
import type { BoundedAsyncStream } from '../backend-contract/streams'
import { CoreTraceRecorder } from './trace-recorder'

export interface CoreBackendEventStreamRuntime<Attachment extends string> {
  readonly events: BoundedAsyncStream<BackendEvent<Attachment>>
  readonly isReady: () => boolean
  readonly applyEvent: (event: BackendEvent<Attachment>) => void
  readonly releaseAfterFailure: () => Promise<CleanupRecord>
  readonly trace: CoreTraceRecorder
  readonly now: () => number
}

/** Pumps the backend event stream and fails closed when its delivery contract is broken. */
export async function forwardCoreBackendEvents<Attachment extends string>(
  runtime: CoreBackendEventStreamRuntime<Attachment>
): Promise<void> {
  try {
    for await (const item of runtime.events) {
      if (!runtime.isReady()) {
        return
      }
      if (item.kind !== 'value') {
        runtime.trace.record({
          timestamp: runtime.now(),
          resource: 'manager',
          transition: 'backend-event-stream-terminal',
          operation: null,
          cause: item.kind === 'overflow' ? 'stream.overflow' : 'platform.failure',
          queuedOperations: 0,
          dispatchedOperations: 0,
          quarantinedOperations: 0
        })
        await runtime.releaseAfterFailure()
        return
      }
      assertBackendEvent(item.value)
      runtime.applyEvent(item.value)
    }
  } catch (error) {
    runtime.trace.record({
      timestamp: runtime.now(),
      resource: 'manager',
      transition: 'backend-event-source-failed',
      operation: null,
      cause: error instanceof BackendContractError ? error.normalized.code : 'platform.failure',
      queuedOperations: 0,
      dispatchedOperations: 0,
      quarantinedOperations: 0
    })
    await runtime.releaseAfterFailure()
  }
}
