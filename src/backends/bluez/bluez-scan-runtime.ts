// src/backends/bluez/bluez-scan-runtime.ts

import type { OwnerScanOptions } from '../../backend-contract/advertisement'
import { contractError, type CleanupRecord } from '../../backend-contract/errors'
import type { ClientId, LeaseId, ScanShareToken } from '../../backend-contract/primitives'
import { CoreBoundedStream } from '../../core/bounded-stream'
import type { BluezBackendRuntime } from './bluez-backend-runtime'
import type { BluezScanConsumer, BluezScanGroup } from './bluez-runtime-types'
import { BLUEZ_ADAPTER_INTERFACE, BLUEZ_DEVICE_INTERFACE } from './bluez-dbus-contract'
import { BluezScanLease, releasedBluezCleanup } from './bluez-backend-handles'
import { scanFilterVariant, scanSignature } from './bluez-runtime-models'

export async function startBluezScan(
  runtime: BluezBackendRuntime,
  options: OwnerScanOptions<string, string>,
  clientId: ClientId<string, string>
): Promise<BluezScanLease> {
  runtime.assertUsable('bluez.scan.start')
  if (runtime.scanGroup?.stopRequested === true) {
    const orphanedOwner = runtime.scanGroup.consumers.get(String(runtime.scanGroup.ownerLeaseId))
    if (orphanedOwner === undefined) {
      throw contractError('lifecycle.invariant-violation', 'scan', 'bluez.scan.retry-orphaned-stop')
    }
    await runtime.stopScan(orphanedOwner)
  }
  if (runtime.scanGroup !== null) {
    throw contractError('scan.already-active', 'scan', 'bluez.scan.start')
  }
  if (options.signal?.aborted === true) {
    throw contractError('operation.aborted', 'scan', 'bluez.scan.start')
  }
  if (options.deadline !== null && options.deadline <= runtime.now()) {
    throw contractError('operation.timed-out', 'scan', 'bluez.scan.start')
  }
  const ids = runtime.identifiers()
  const leaseId = ids.leaseId(`bluez-scan-${runtime.nextScan}`)
  const scanSessionId = ids.scanSessionId(`bluez-scan-session-${runtime.nextScan}`)
  const shareToken = options.sharing.allowSharing ? ids.scanShareToken(`bluez-scan-share-${runtime.nextScan}`) : null
  runtime.nextScan += 1
  const abort = (): void => {
    if (runtime.scanGroup?.state === 'starting') {
      runtime.scanGroup.stopRequested = true
      return
    }
    observeScanCleanup(runtime.stopScan(consumer))
  }
  const consumer: BluezScanConsumer = {
    scanSessionId,
    leaseId,
    shareToken,
    clientId,
    options,
    stream: new CoreBoundedStream(options.delivery, options.delivery.overflowPolicy),
    abort,
    deadlineTimer: null,
    stopped: null
  }
  let settleStartup: (() => void) | null = null
  const startupSettled = new Promise<void>(resolve => {
    settleStartup = resolve
  })
  if (settleStartup === null) {
    throw contractError('lifecycle.invariant-violation', 'scan', 'bluez.scan.startup-signal')
  }
  const group: BluezScanGroup = {
    ownerLeaseId: leaseId,
    shareToken,
    signature: scanSignature(options),
    consumers: new Map([[String(leaseId), consumer]]),
    state: 'starting',
    physicalStarted: false,
    stopRequested: false,
    startupComplete: false,
    startupSettled,
    settleStartup
  }
  runtime.scanGroup = group
  options.signal?.addEventListener('abort', abort, { once: true })
  try {
    await runtime.boundary.methods.callVoid(
      String(runtime.selectedAdapter.adapterId),
      BLUEZ_ADAPTER_INTERFACE,
      'SetDiscoveryFilter',
      [scanFilterVariant(options)]
    )
  } catch (primaryError) {
    await failBluezScanStartup(runtime, group, consumer, primaryError)
  }
  if (group.stopRequested || operationAborted(options)) {
    await failBluezScanStartup(runtime, group, consumer, contractError('operation.aborted', 'scan', 'bluez.scan.start'))
  }
  try {
    await runtime.boundary.methods.callVoid(
      String(runtime.selectedAdapter.adapterId),
      BLUEZ_ADAPTER_INTERFACE,
      'StartDiscovery',
      []
    )
    group.physicalStarted = true
  } catch (primaryError) {
    await failBluezScanStartup(runtime, group, consumer, primaryError)
  }
  if (group.stopRequested || operationAborted(options)) {
    try {
      await stopBluezScan(runtime, consumer)
    } finally {
      group.startupComplete = true
      group.settleStartup()
    }
    throw contractError('operation.aborted', 'scan', 'bluez.scan.start')
  }
  group.state = 'active'
  if (options.deadline !== null) {
    consumer.deadlineTimer = setTimeout(abort, Math.max(0, options.deadline - runtime.now()))
  }
  for (const path of runtime.store.objectsWithInterface(BLUEZ_DEVICE_INTERFACE)) {
    runtime.emitAdvertisementForPath(path)
  }
  group.startupComplete = true
  group.settleStartup()
  return new BluezScanLease(runtime, consumer)
}

export async function joinBluezScan(
  runtime: BluezBackendRuntime,
  leaseId: LeaseId<string, string>,
  shareToken: ScanShareToken<string, string>,
  clientId: ClientId<string, string>
): Promise<BluezScanLease> {
  runtime.assertUsable('bluez.scan.join')
  const group = runtime.scanGroup
  if (
    group === null ||
    group.state !== 'active' ||
    group.ownerLeaseId !== leaseId ||
    group.shareToken === null ||
    group.shareToken !== shareToken
  ) {
    throw contractError('ownership.denied', 'scan', 'bluez.scan.join')
  }
  const owner = group.consumers.get(String(group.ownerLeaseId))
  if (owner === undefined) {
    throw contractError('lifecycle.invariant-violation', 'scan', 'bluez.scan.join')
  }
  const ids = runtime.identifiers()
  const joinedLeaseId = ids.leaseId(`bluez-scan-${runtime.nextScan}`)
  const consumer: BluezScanConsumer = {
    scanSessionId: owner.scanSessionId,
    leaseId: joinedLeaseId,
    shareToken: null,
    clientId,
    options: owner.options,
    stream: new CoreBoundedStream(owner.options.delivery, owner.options.delivery.overflowPolicy),
    abort: null,
    deadlineTimer: null,
    stopped: null
  }
  runtime.nextScan += 1
  group.consumers.set(String(joinedLeaseId), consumer)
  return new BluezScanLease(runtime, consumer)
}

export async function stopBluezScan(runtime: BluezBackendRuntime, consumer: BluezScanConsumer): Promise<CleanupRecord> {
  if (consumer.abort !== null) {
    consumer.options.signal?.removeEventListener('abort', consumer.abort)
  }
  if (consumer.deadlineTimer !== null) {
    clearTimeout(consumer.deadlineTimer)
    consumer.deadlineTimer = null
  }
  const group = runtime.scanGroup
  if (group === null || !group.consumers.has(String(consumer.leaseId))) {
    consumer.stream.closeWithReason('owner-released')
    return releasedBluezCleanup
  }
  if (consumer.leaseId !== group.ownerLeaseId) {
    group.consumers.delete(String(consumer.leaseId))
    consumer.stream.closeWithReason('owner-released')
    return releasedBluezCleanup
  }
  if (!group.physicalStarted && group.state === 'starting') {
    group.stopRequested = true
    return releasedBluezCleanup
  }
  group.state = 'stopping'
  if (group.physicalStarted) {
    try {
      await runtime.boundary.methods.callVoid(
        String(runtime.selectedAdapter.adapterId),
        BLUEZ_ADAPTER_INTERFACE,
        'StopDiscovery',
        []
      )
      group.physicalStarted = false
    } catch (error) {
      group.state = 'active'
      console.error('[stopBluezScan] BlueZ StopDiscovery failed; scan ownership retained for retry:', error)
      throw error
    }
  }
  try {
    await clearBluezDiscoveryFilter(runtime)
  } catch (error) {
    group.state = 'active'
    console.error('[stopBluezScan] BlueZ discovery-filter cleanup failed; scan ownership retained for retry:', error)
    throw error
  }
  for (const joined of [...group.consumers.values()]) {
    joined.stream.closeWithReason('owner-released')
  }
  group.consumers.clear()
  runtime.scanGroup = null
  return releasedBluezCleanup
}

export async function destroyBluezScan(runtime: BluezBackendRuntime): Promise<CleanupRecord> {
  const initialGroup = runtime.scanGroup
  if (initialGroup === null) {
    return releasedBluezCleanup
  }
  if (!initialGroup.startupComplete) {
    initialGroup.stopRequested = true
    await initialGroup.startupSettled
  }
  const group = runtime.scanGroup
  if (group === null) {
    return releasedBluezCleanup
  }
  const owner = group.consumers.get(String(group.ownerLeaseId))
  if (owner === undefined) {
    throw contractError('lifecycle.invariant-violation', 'scan', 'bluez.destroy.scan-owner')
  }
  return runtime.stopScan(owner)
}

async function failBluezScanStartup(
  runtime: BluezBackendRuntime,
  group: BluezScanGroup,
  consumer: BluezScanConsumer,
  primaryError: unknown
): Promise<never> {
  try {
    await clearBluezDiscoveryFilter(runtime)
  } catch (cleanupError) {
    releaseFailedScanStartup(runtime, group, consumer)
    console.error('[startBluezScan] Failed to clear the BlueZ discovery filter after start failure:', cleanupError)
    throw new AggregateError([primaryError, cleanupError], 'BlueZ scan start and filter cleanup both failed')
  }
  releaseFailedScanStartup(runtime, group, consumer)
  throw primaryError
}

function releaseFailedScanStartup(
  runtime: BluezBackendRuntime,
  group: BluezScanGroup,
  consumer: BluezScanConsumer
): void {
  if (consumer.abort !== null) {
    consumer.options.signal?.removeEventListener('abort', consumer.abort)
  }
  runtime.scanGroup = null
  consumer.stream.closeWithReason('owner-released')
  group.startupComplete = true
  group.settleStartup()
}

async function clearBluezDiscoveryFilter(runtime: BluezBackendRuntime): Promise<void> {
  await runtime.boundary.methods.callVoid(
    String(runtime.selectedAdapter.adapterId),
    BLUEZ_ADAPTER_INTERFACE,
    'SetDiscoveryFilter',
    [{ signature: 'a{sv}', value: Object.freeze({}) }]
  )
}

function observeScanCleanup(cleanup: Promise<CleanupRecord>): void {
  cleanup.catch(error => {
    console.error('[startBluezScan] Failed to stop an aborted BlueZ scan:', error)
  })
}

function operationAborted(options: OwnerScanOptions<string, string>): boolean {
  return options.signal?.aborted === true
}
