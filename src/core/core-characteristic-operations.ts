// src/core/core-characteristic-operations.ts

import type { BleCentralBackend } from '../backend-contract/backend'
import { BackendContractError, contractError } from '../backend-contract/errors'
import type { CharacteristicPath } from '../backend-contract/gatt'
import type { BackendIdentity } from '../backend-contract/identity'
import type {
  LongWriteChunkProgress,
  LongWriteNotPlannedReceipt,
  LongWritePolicy,
  LongWriteReceipt,
  OperationTerminalRecord,
  PublicOperationOptions,
  WritePolicy,
  WriteReceipt
} from '../backend-contract/operations'
import { ownBytes, type ByteLimit, type OwnedBytes } from '../backend-contract/primitives'
import type { CoreGattDatabase } from './core-gatt-handles'
import type { CoreOperationCoordinator, CoreOperationDispatch, CoreOperationResult } from './operation-coordinator'
import { coreDispatch, requireOperationValue } from './unified-ble-core-helpers'

type CurrentCharacteristicPath<Attachment extends string> = CharacteristicPath<
  Attachment,
  string,
  string,
  string,
  string,
  'current'
>

interface LongWritePlan {
  readonly maximumWriteLength: number
  readonly totalChunks: number
}

export async function readCoreCharacteristic<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  backend: BleCentralBackend<Attachment, Identity>,
  operationCoordinator: CoreOperationCoordinator<Attachment>,
  maximumValueBytes: ByteLimit,
  database: CoreGattDatabase<Attachment, Identity>,
  path: CurrentCharacteristicPath<Attachment>,
  options: PublicOperationOptions
): Promise<OwnedBytes> {
  database.assertPath(path)
  const result = await operationCoordinator.run({
    queueKey: String(path.connectionId),
    options,
    mayCommit: false,
    dispatch: correlation => {
      database.assertPath(path)
      const dispatch = backend.gatt.read(path, { operation: { ...options, correlation } })
      return coreDispatch(dispatch, correlation, value => value.terminal)
    }
  })
  const read = requireOperationValue(result, 'unified-core.read')
  return ownBytes(read.value, maximumValueBytes)
}

export async function writeCoreCharacteristic<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  backend: BleCentralBackend<Attachment, Identity>,
  operationCoordinator: CoreOperationCoordinator<Attachment>,
  maximumValueBytes: ByteLimit,
  database: CoreGattDatabase<Attachment, Identity>,
  path: CurrentCharacteristicPath<Attachment>,
  bytes: Readonly<Uint8Array>,
  options: WritePolicy
): Promise<WriteReceipt<Attachment, string>> {
  database.assertPath(path)
  const owned = ownBytes(bytes, maximumValueBytes)
  const result = await operationCoordinator.run({
    queueKey: String(path.connectionId),
    options,
    mayCommit: true,
    retainedPayloadBytes: owned.byteLength,
    dispatch: correlation => {
      database.assertPath(path)
      const dispatch = backend.gatt.write(path, {
        operation: { ...options, correlation },
        bytes: owned,
        mode: options.mode
      })
      return coreDispatch(dispatch, correlation, value => value.terminal)
    }
  })
  return requireOperationValue(result, 'unified-core.write')
}

/**
 * Runs one logical long write at the existing connection FIFO head. The backend
 * sees ordinary writes only; each following chunk starts after the preceding
 * completion and after cancellation/deadline/disconnect/destroy boundaries.
 */
export async function writeCoreLongCharacteristic<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>
>(
  backend: BleCentralBackend<Attachment, Identity>,
  operationCoordinator: CoreOperationCoordinator<Attachment>,
  maximumValueBytes: ByteLimit,
  database: CoreGattDatabase<Attachment, Identity>,
  path: CurrentCharacteristicPath<Attachment>,
  bytes: Readonly<Uint8Array>,
  options: LongWritePolicy,
  planAtFifoHead: () => Promise<LongWritePlan>
): Promise<LongWriteReceipt<Attachment, string>> {
  database.assertPath(path)
  const owned = ownBytes(bytes, maximumValueBytes)
  let progress: MutableLongWriteProgress | null = null
  const result = await operationCoordinator.run({
    queueKey: String(path.connectionId),
    options,
    mayCommit: true,
    retainedPayloadBytes: owned.byteLength,
    dispatch: correlation =>
      createPlannedSequentialChunkDispatch(
        backend,
        database,
        path,
        owned,
        options,
        planAtFifoHead,
        plan => {
          const nextProgress = createLongWriteProgress(owned.byteLength, plan.maximumWriteLength, plan.totalChunks)
          progress = nextProgress
          return nextProgress
        },
        correlation
      ),
    onQuarantined: () => progress?.markBoundary()
  })
  if (progress === null && result.outcome !== 'succeeded') {
    return receiptBeforeLongWritePlan(result, owned.byteLength)
  }
  if (progress === null) {
    throw contractError('lifecycle.invariant-violation', 'gatt', 'unified-core.write-long.missing-plan')
  }
  return receiptFromLongWriteResult(result, progress)
}

interface MutableLongWriteProgress {
  readonly totalBytes: number
  readonly maximumWriteLength: number
  readonly chunks: LongWriteChunkProgress[]
  activeChunkIndex: number | null
  boundaryReached: boolean
  markBoundary(): void
  markDispatchedChunkUncertain(index: number): void
}

function createLongWriteProgress(
  totalBytes: number,
  maximumWriteLength: number,
  totalChunks: number
): MutableLongWriteProgress {
  if (
    !Number.isSafeInteger(maximumWriteLength) ||
    maximumWriteLength < 1 ||
    !Number.isSafeInteger(totalChunks) ||
    totalChunks < 1 ||
    totalChunks !== Math.max(1, Math.ceil(totalBytes / maximumWriteLength))
  ) {
    throw contractError('protocol.violation', 'gatt', 'unified-core.write-long-plan')
  }
  const chunks: LongWriteChunkProgress[] = []
  for (let index = 0; index < totalChunks; index += 1) {
    const byteOffset = index * maximumWriteLength
    chunks.push({
      index,
      byteOffset,
      byteLength: totalBytes === 0 ? 0 : Math.min(maximumWriteLength, totalBytes - byteOffset),
      state: 'not-started'
    })
  }
  return {
    totalBytes,
    maximumWriteLength,
    chunks,
    activeChunkIndex: null,
    boundaryReached: false,
    markBoundary() {
      this.boundaryReached = true
      if (this.activeChunkIndex !== null) {
        this.markDispatchedChunkUncertain(this.activeChunkIndex)
      }
    },
    markDispatchedChunkUncertain(index: number) {
      const current = this.chunks[index]
      if (current !== undefined && current.state === 'not-started') {
        this.chunks[index] = { ...current, state: 'uncertain' }
      }
      if (this.activeChunkIndex === index) {
        this.activeChunkIndex = null
      }
    }
  }
}

function createPlannedSequentialChunkDispatch<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  backend: BleCentralBackend<Attachment, Identity>,
  database: CoreGattDatabase<Attachment, Identity>,
  path: CurrentCharacteristicPath<Attachment>,
  bytes: OwnedBytes,
  options: LongWritePolicy,
  planAtFifoHead: () => Promise<LongWritePlan>,
  setProgress: (plan: LongWritePlan) => MutableLongWriteProgress,
  correlation: import('../backend-contract/primitives').OperationCorrelation<Attachment, string>
): CoreOperationDispatch<WriteReceipt<Attachment, string>> {
  let activeChunkDispatch: CoreOperationDispatch<WriteReceipt<Attachment, string>> | null = null
  let cancellationRequested = false
  const completion = planAtFifoHead().then(plan => {
    if (cancellationRequested) {
      throw contractError('operation.aborted', 'gatt', 'unified-core.write-long.cancelled-before-plan')
    }
    database.assertPath(path)
    const progress = setProgress(plan)
    const dispatch = createSequentialChunkDispatch(backend, database, path, bytes, options, progress, correlation)
    activeChunkDispatch = dispatch
    return dispatch.completion
  })
  return {
    completion,
    requestCancellation: (): Promise<void> => {
      cancellationRequested = true
      if (activeChunkDispatch === null) {
        return Promise.resolve()
      }
      return activeChunkDispatch.requestCancellation()
    }
  }
}

function createSequentialChunkDispatch<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  backend: BleCentralBackend<Attachment, Identity>,
  database: CoreGattDatabase<Attachment, Identity>,
  path: CurrentCharacteristicPath<Attachment>,
  bytes: OwnedBytes,
  options: LongWritePolicy,
  progress: MutableLongWriteProgress,
  correlation: import('../backend-contract/primitives').OperationCorrelation<Attachment, string>
): CoreOperationDispatch<WriteReceipt<Attachment, string>> {
  let activeDispatch: CoreOperationDispatch<WriteReceipt<Attachment, string>> | null = null
  let cancellationRequested = false
  let resolveCompletion: (value: WriteReceipt<Attachment, string>) => void = () => undefined
  let rejectCompletion: (reason: Error) => void = () => undefined
  const completion = new Promise<WriteReceipt<Attachment, string>>((resolve, reject) => {
    resolveCompletion = resolve
    rejectCompletion = reject
  })

  const runNext = (index: number): void => {
    if (cancellationRequested || progress.boundaryReached) {
      rejectCompletion(contractError('operation.aborted', 'gatt', 'unified-core.write-long.cancelled-between-chunks'))
      return
    }
    const chunk = progress.chunks[index]
    if (chunk === undefined) {
      resolveCompletion({
        terminal: { correlation, outcome: 'succeeded', cause: null },
        commitState: 'confirmed'
      })
      return
    }
    try {
      database.assertPath(path)
    } catch (error) {
      rejectCompletion(asBackendError(error, 'unified-core.write-long.assert-path'))
      return
    }
    let dispatch: CoreOperationDispatch<WriteReceipt<Attachment, string>>
    try {
      dispatch = coreDispatch(
        backend.gatt.write(path, {
          operation: { signal: null, deadline: null, correlation },
          bytes: bytes.subarray(chunk.byteOffset, chunk.byteOffset + chunk.byteLength),
          mode: options.mode
        }),
        correlation,
        value => value.terminal
      )
    } catch (error) {
      rejectCompletion(asBackendError(error, 'unified-core.write-long.dispatch'))
      return
    }
    activeDispatch = dispatch
    progress.activeChunkIndex = index
    dispatch.completion.then(
      () => {
        if (cancellationRequested || progress.boundaryReached) {
          rejectCompletion(contractError('operation.aborted', 'gatt', 'unified-core.write-long.cancelled-after-chunk'))
          return
        }
        progress.chunks[index] = { ...chunk, state: 'confirmed' }
        progress.activeChunkIndex = null
        runNext(index + 1)
      },
      error => {
        progress.markDispatchedChunkUncertain(index)
        rejectCompletion(asBackendError(error, 'unified-core.write-long.chunk'))
      }
    )
  }
  runNext(0)
  return {
    completion,
    requestCancellation: async (): Promise<void> => {
      cancellationRequested = true
      progress.markBoundary()
      if (activeDispatch === null) {
        return
      }
      await activeDispatch.requestCancellation()
    }
  }
}

function receiptFromLongWriteResult<Attachment extends string>(
  result: CoreOperationResult<Attachment, WriteReceipt<Attachment, string>>,
  progress: MutableLongWriteProgress
): LongWriteReceipt<Attachment, string> {
  const completedChunks = progress.chunks.filter(chunk => chunk.state === 'confirmed').length
  const committedBytes = progress.chunks
    .filter(chunk => chunk.state === 'confirmed')
    .reduce((total, chunk) => total + chunk.byteLength, 0)
  const uncertainChunk = progress.chunks.find(chunk => chunk.state === 'uncertain')
  const failedChunk = uncertainChunk ?? progress.chunks.find(chunk => chunk.state === 'not-started')
  if (result.outcome === 'succeeded') {
    return Object.freeze({
      terminal: terminalFromLongWriteResult(result),
      commitState: 'confirmed',
      planState: 'planned',
      totalBytes: progress.totalBytes,
      chunkSize: progress.maximumWriteLength,
      totalChunks: progress.chunks.length,
      chunks: Object.freeze(progress.chunks.map(chunk => Object.freeze({ ...chunk }))),
      completedChunks,
      committedBytes,
      failedChunkIndex: null
    })
  }
  return Object.freeze({
    terminal: terminalFromLongWriteResult(result),
    commitState: result.commitState === 'unknown' ? 'unknown' : 'confirmed',
    planState: 'planned',
    totalBytes: progress.totalBytes,
    chunkSize: progress.maximumWriteLength,
    totalChunks: progress.chunks.length,
    chunks: Object.freeze(progress.chunks.map(chunk => Object.freeze({ ...chunk }))),
    completedChunks,
    committedBytes,
    failedChunkIndex: failedChunk?.index ?? null
  })
}

function receiptBeforeLongWritePlan<Attachment extends string>(
  result: Exclude<CoreOperationResult<Attachment, WriteReceipt<Attachment, string>>, { readonly outcome: 'succeeded' }>,
  totalBytes: number
): LongWriteNotPlannedReceipt<Attachment, string> {
  return Object.freeze({
    terminal: terminalFromLongWriteResult(result),
    planState: 'not-planned',
    commitState: 'not-started',
    totalBytes,
    chunkSize: 0,
    totalChunks: 0,
    chunks: Object.freeze([]),
    completedChunks: 0,
    committedBytes: 0,
    failedChunkIndex: null
  })
}

function terminalFromLongWriteResult<Attachment extends string>(
  result: CoreOperationResult<Attachment, WriteReceipt<Attachment, string>>
): OperationTerminalRecord<Attachment, string> {
  if (result.outcome === 'succeeded') {
    return Object.freeze({ correlation: result.correlation, outcome: 'succeeded', cause: null })
  }
  return Object.freeze({ correlation: result.correlation, outcome: result.outcome, cause: result.error.code })
}

function asBackendError(error: unknown, operation: string): BackendContractError {
  if (error instanceof BackendContractError) {
    return error
  }
  console.error('[writeCoreLongCharacteristic] Backend chunk operation rejected with a non-contract error:', error)
  return contractError('platform.failure', 'gatt', operation)
}
