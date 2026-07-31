// __tests__/backend-contract/fixtures/negative.ts

import { createAttachmentBoundIdFactory, rebindAttachmentBoundId } from '../../../src/backend-contract'
import type {
  AttachmentBinding,
  CharacteristicPath,
  FeatureImplementation,
  FeatureRegistration,
  GattDatabase,
  OwnedBytes,
  ScanOptions,
  SerializableRecord,
  VersionRange
} from '../../../src/backend-contract'

declare const currentPath: CharacteristicPath<'alpha', 'connection', 'database', 'service', 'characteristic'>
declare const stalePath: CharacteristicPath<'alpha', 'connection', 'database', 'service', 'characteristic', 'stale'>
declare const differentAttachmentPath: CharacteristicPath<'beta', 'connection', 'database', 'service', 'characteristic'>
declare const nativeRange: VersionRange<'native-protocol'>
declare const capabilityRange: VersionRange<'capability-schema'>
declare const byteBuffer: ArrayBuffer
declare const clientId: import('../../../src/backend-contract').ClientId<'alpha', 'client'>
declare const database: GattDatabase<'alpha', 'connection', 'database'>
declare const scanOptions: ScanOptions<'alpha', 'scan-lease'>
declare const scanner: import('../../../src/backend-contract').ScannerBackend<'alpha'>
declare const restoration: import('../../../src/backend-contract').RestorationAdoptionRequest<'alpha'>
declare const restorationJournal: import('../../../src/backend-contract').RestorationJournal<'alpha'>
declare const arbiter: import('../../../src/backend-contract/electron').ElectronMainArbiter<'alpha'>
declare const envelope: import('../../../src/backend-contract/electron').IpcEnvelope<'alpha', 'renderer', 'operation'>
declare const alphaBinding: AttachmentBinding<'alpha'>
declare const betaBinding: AttachmentBinding<'beta'>
declare function observe<Value>(value: Value): void
declare function readCurrent(
  path: CharacteristicPath<'alpha', 'connection', 'database', 'service', 'characteristic', 'current'>
): void
readCurrent(currentPath)
// @ts-expect-error stale GATT paths must not dispatch.
readCurrent(stalePath)
// @ts-expect-error attachment-scoped paths cannot cross backend instances.
const mismatchedAttachment: CharacteristicPath<'alpha', 'connection', 'database', 'service', 'characteristic'> =
  differentAttachmentPath
// @ts-expect-error every feature binds a typed implementation.
const featureWithoutImplementation: FeatureRegistration<
  'example:feature',
  SerializableRecord,
  SerializableRecord,
  FeatureImplementation<SerializableRecord, SerializableRecord>
> = {
  id: 'example:feature',
  state: 'supported',
  selectedSchemaRange: capabilityRange,
  implementationOrigin: 'backend-native',
  tck: { suiteId: 'example-suite', requiredScenarioIds: ['s'], contractRange: capabilityRange },
  evidence: {
    receiptId: 'receipt',
    evidenceLevel: 'deterministic',
    implementationVersion: '1',
    sourceDigest: 'digest',
    scenarioIds: ['s'],
    limitations: []
  },
  limitations: [],
  limits: { maximumBytes: { maximum: 1, minimum: null, unit: 'bytes' } }
}
// @ts-expect-error normal BLE output must be owned bytes.
const wrongByteType: OwnedBytes = byteBuffer
// @ts-expect-error protocol axes cannot be substituted.
const wrongVersionAxis: VersionRange<'backend-contract'> = nativeRange
// @ts-expect-error subscriptions require bounded delivery.
observe(database.subscribe(currentPath, { signal: null, deadline: null }))
// @ts-expect-error only an owner request starts physical scanning.
observe(scanner.start(scanOptions, clientId))
const forgedRestoration: import('../../../src/backend-contract').RestorationAdoptionRequest<'alpha'> = {
  ...restoration,
  // @ts-expect-error public adoption cannot inject provider-owned journal state.
  journal: restorationJournal
}
// @ts-expect-error public write must explicitly declare the write policy.
observe(database.write(currentPath, new Uint8Array(), { signal: null, deadline: null }))
// @ts-expect-error renderer identity is not a trusted main-process sender.
observe(arbiter.route(envelope.renderer, envelope))
const alphaLease = createAttachmentBoundIdFactory(alphaBinding).leaseId('alpha-lease')
// @ts-expect-error an attachment-bound generated ID cannot cross attachments.
const crossAttachmentLease: import('../../../src/backend-contract').LeaseId<'alpha', string> =
  createAttachmentBoundIdFactory(betaBinding).leaseId('beta-lease')
// @ts-expect-error rebinding needs the identical attachment type and tuple.
observe(rebindAttachmentBoundId(alphaLease, alphaBinding, betaBinding))
observe(featureWithoutImplementation)
observe(mismatchedAttachment)
observe(wrongByteType)
observe(wrongVersionAxis)
observe(forgedRestoration)
observe(crossAttachmentLease)
