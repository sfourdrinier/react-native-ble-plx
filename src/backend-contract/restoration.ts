// src/backend-contract/restoration.ts

import type {
  AttachmentId,
  BackendInstanceId,
  ClientId,
  GenerationId,
  NativeVersionAxes,
  PeerId,
  SerializableRecord
} from './primitives'

export interface RestorationJournalRecord<Attachment extends string> {
  readonly recordVersion: number
  readonly namespace: string
  readonly attachmentId: AttachmentId<Attachment>
  readonly backendInstanceId: BackendInstanceId<Attachment>
  readonly backendGeneration: GenerationId<'backend-generation', Attachment>
  readonly ordinal: number
  readonly adoptionEpoch: GenerationId<'restoration-epoch', Attachment>
  readonly kind: 'adapter' | 'connection' | 'subscription' | 'event'
  readonly peerId: PeerId<Attachment> | null
  readonly payload: SerializableRecord
}
export interface RestorationJournal<Attachment extends string> {
  readonly records: readonly RestorationJournalRecord<Attachment>[]
  readonly capacity: number
  readonly byteCapacity: number
  readonly overflow: 'reject-restoration' | 'drop-oldest-with-notice'
}
export interface RestorationAdoptionRequest<Attachment extends string> {
  readonly namespace: string
  readonly attachmentId: AttachmentId<Attachment>
  readonly expectedBackendInstanceId: BackendInstanceId<Attachment>
  readonly expectedEpoch: GenerationId<'restoration-epoch', Attachment>
  readonly expectedVersions: NativeVersionAxes
}
export interface AuthenticatedRestorationClient<Attachment extends string> {
  readonly clientId: ClientId<Attachment, string>
  readonly hostSessionScope: string
}
export interface RestorationAdoptionResult<Attachment extends string> {
  readonly attachmentId: AttachmentId<Attachment>
  readonly receiptId: string
  readonly namespace: string
  readonly boundClientId: ClientId<Attachment, string>
  readonly adoptionEpoch: GenerationId<'restoration-epoch', Attachment>
  readonly outcome:
    | 'adopted'
    | 'already-consumed'
    | 'attachment-mismatch'
    | 'backend-mismatch'
    | 'namespace-mismatch'
    | 'epoch-mismatch'
  readonly replayedRecords: readonly RestorationJournalRecord<Attachment>[]
}
export interface ProviderRestorationAuthority<Attachment extends string> {
  lookup(
    client: AuthenticatedRestorationClient<Attachment>,
    request: RestorationAdoptionRequest<Attachment>
  ): Promise<RestorationJournal<Attachment> | null>
  consume(
    client: AuthenticatedRestorationClient<Attachment>,
    request: RestorationAdoptionRequest<Attachment>,
    result: RestorationAdoptionResult<Attachment>
  ): Promise<void>
}
export interface RestorationCoordinator<Attachment extends string> {
  adopt(
    client: AuthenticatedRestorationClient<Attachment>,
    request: RestorationAdoptionRequest<Attachment>
  ): Promise<RestorationAdoptionResult<Attachment>>
}
