// __tests__/backend-contract/fixtures/positive.ts

import { createAttachmentBoundIdFactory } from '../../../src/backend-contract'
import type {
  AttachmentBinding,
  Capacity,
  CharacteristicPath,
  FeatureImplementation,
  FeatureRegistration,
  GattDatabase,
  OwnerScanOptions,
  RestorationAdoptionRequest,
  ScannerBackend,
  SerializableRecord
} from '../../../src/backend-contract'
import type { IpcEnvelope } from '../../../src/backend-contract/electron'

declare const capacity: Capacity
declare const implementation: FeatureImplementation<SerializableRecord, SerializableRecord>
declare const scanner: ScannerBackend<'alpha'>
declare const leaseId: import('../../../src/backend-contract').LeaseId<'alpha', 'lease-one'>
declare const shareToken: import('../../../src/backend-contract').ScanShareToken<'alpha', 'lease-one'>
declare const clientId: import('../../../src/backend-contract').ClientId<'alpha', 'client-one'>
declare const database: GattDatabase<'alpha', 'connection-one', 'database-one'>
declare const restoration: RestorationAdoptionRequest<'alpha'>
declare const envelope: IpcEnvelope<'alpha', 'renderer-one', 'operation-one'>
declare const currentPath: CharacteristicPath<
  'alpha',
  'connection-one',
  'database-one',
  'service-one',
  'characteristic-one'
>
declare const schemaRange: import('../../../src/backend-contract').VersionRange<'capability-schema'>
declare const alphaBinding: AttachmentBinding<'alpha'>
declare function observe<Value>(value: Value): void

const exclusiveScan: OwnerScanOptions<'alpha', 'lease-one'> = {
  filter: { serviceUuids: [], localNamePrefix: null },
  duplicatePolicy: 'merged',
  timestampPolicy: 'source-then-receipt',
  delivery: {
    itemCapacity: capacity,
    byteCapacity: capacity,
    reservedControlCapacity: capacity,
    overflowPolicy: 'drop-oldest'
  },
  deadline: null,
  signal: null,
  sharing: { mode: 'owner', allowSharing: false }
}
const completeFeature: FeatureRegistration<
  'example:complete',
  SerializableRecord,
  SerializableRecord,
  FeatureImplementation<SerializableRecord, SerializableRecord>
> = {
  id: 'example:complete',
  state: 'supported',
  implementationOrigin: 'backend-native',
  implementation,
  tck: { suiteId: 'example-suite', requiredScenarioIds: ['example-scenario'], contractRange: schemaRange },
  evidence: {
    receiptId: 'example-receipt',
    evidenceLevel: 'supported',
    implementationVersion: '1.0',
    sourceDigest: 'digest',
    scenarioIds: ['example-scenario'],
    limitations: []
  },
  limitations: [],
  limits: { maximumBytes: 1024 }
}
observe(exclusiveScan)
observe(completeFeature)
observe(scanner.start(exclusiveScan, clientId))
observe(scanner.join(leaseId, shareToken, clientId))
observe(restoration.namespace)
observe(envelope.binaryPayload)
observe(database.snapshot())
declare const backendSubscription: import('../../../src/backend-contract').BackendSubscription<
  'alpha',
  'connection-one',
  'database-one',
  'service-one',
  'characteristic-one'
>
observe(backendSubscription.terminal.correlation)
observe(database.write(currentPath, new Uint8Array(), { signal: null, deadline: null, mode: 'with-response' }))
observe(
  database.subscribe(currentPath, {
    signal: null,
    deadline: null,
    delivery: {
      itemCapacity: capacity,
      byteCapacity: capacity,
      reservedControlCapacity: capacity,
      overflowPolicy: 'latest'
    }
  })
)
const runtimeScopedLease = createAttachmentBoundIdFactory(alphaBinding).leaseId('lease')
const runtimeCorrelation = createAttachmentBoundIdFactory(alphaBinding).operationCorrelation('operation')
observe(runtimeScopedLease)
observe(runtimeCorrelation)
