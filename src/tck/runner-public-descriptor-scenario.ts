// src/tck/runner-public-descriptor-scenario.ts

import type { BleCentralBackend } from '../backend-contract/backend'
import type { BackendIdentity } from '../backend-contract/identity'
import type { BackendTckFixture, TckFact, TckScenarioDefinition } from './contracts'
import { TckAssertionError } from './contracts'
import { assertCleanupReleased, connectAndDiscover, fact, operationOptions } from './runner-public-scenario-support'
import type { PublicManager } from './runner-public-scenarios'

/** Verifies discovery, owned-byte reads, and confirmed writes through a registered descriptor boundary. */
export async function executeDescriptorOperationsScenario<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(
  manager: PublicManager<Attachment, Identity>,
  fixture: BackendTckFixture<Attachment, Identity, Backend>,
  definition: TckScenarioDefinition
): Promise<readonly TckFact[]> {
  const connected = await connectAndDiscover(manager, fixture, definition)
  const descriptor = connected.snapshot.descriptors[0]
  if (descriptor === undefined) {
    throw new TckAssertionError(definition.id, 'discovery returned no descriptor path')
  }
  const initialValue = await fixture.controller.settle(
    connected.database.readDescriptor(descriptor.path, operationOptions)
  )
  const initialByte = initialValue[0]
  if (initialByte === undefined) {
    throw new TckAssertionError(definition.id, 'descriptor read returned no bytes')
  }
  const expectedFirstByte = initialByte === 255 ? 0 : initialByte + 1
  const writtenValue = new Uint8Array([expectedFirstByte, 90])
  const write = await fixture.controller.settle(
    connected.database.writeDescriptor(descriptor.path, writtenValue, {
      ...operationOptions,
      mode: 'with-response'
    })
  )
  writtenValue[0] = initialByte
  const readBack = await fixture.controller.settle(connected.database.readDescriptor(descriptor.path, operationOptions))
  assertCleanupReleased(definition, await fixture.controller.settle(connected.connection.release()), 'connection')
  const discoveryReadWriteConfirmed =
    write.commitState === 'confirmed' && readBack[0] === expectedFirstByte && readBack[1] === 90
  return [
    fact('gatt-descriptor-discovery-read-write-crosses-boundary', discoveryReadWriteConfirmed, {
      discoveryReadWriteConfirmed,
      descriptorValueBytes: readBack.byteLength
    })
  ]
}
