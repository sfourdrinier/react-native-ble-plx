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
import { waitForBluezBoolean } from './bluez-property-waiters'

export async function startBluezScan(
  runtime: BluezBackendRuntime,
  options: OwnerScanOptions<string, string>,
  clientId: ClientId<string, string>
): Promise<BluezScanLease> {
  runtime.assertUsable('bluez.scan.start')
  assertScanAdmission(runtime, options)
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
  const filterStartupFailure = scanStartupFailure(runtime, group)
  if (filterStartupFailure !== null) {
    await failBluezScanStartup(runtime, group, consumer, filterStartupFailure)
  }
  const filterAdmissionFailure = scanAdmissionFailure(runtime, options)
  if (group.stopRequested || filterAdmissionFailure !== null) {
    await failBluezScanStartup(
      runtime,
      group,
      consumer,
      filterAdmissionFailure ?? contractError('operation.aborted', 'scan', 'bluez.scan.start')
    )
  }
  try {
    await runtime.boundary.methods.callVoid(
      String(runtime.selectedAdapter.adapterId),
      BLUEZ_ADAPTER_INTERFACE,
      'StartDiscovery',
      []
    )
    group.physicalStarted = true
    const discoveryStartupFailure = scanStartupFailure(runtime, group)
    if (discoveryStartupFailure !== null) {
      await failBluezScanStartup(runtime, group, consumer, discoveryStartupFailure)
    }
    await waitForBluezBoolean(
      runtime,
      String(runtime.selectedAdapter.adapterId),
      BLUEZ_ADAPTER_INTERFACE,
      'Discovering',
      true,
      options
    )
  } catch (primaryError) {
    await failBluezScanStartup(runtime, group, consumer, primaryError)
  }
  const discoveryAdmissionFailure = scanAdmissionFailure(runtime, options)
  if (group.stopRequested || discoveryAdmissionFailure !== null) {
    await failBluezScanStartup(
      runtime,
      group,
      consumer,
      discoveryAdmissionFailure ?? contractError('operation.aborted', 'scan', 'bluez.scan.start')
    )
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
      await stopBluezPhysicalDiscovery(runtime, group)
    } catch (error) {
      if (runtime.scanGroup === group) {
        group.state = 'active'
      }
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
  const cleanupErrors: unknown[] = []
  const ownsGroup = runtime.scanGroup === group
  if (group.physicalStarted && ownsGroup) {
    try {
      await stopBluezPhysicalDiscovery(runtime, group)
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError)
      console.error('[startBluezScan] Failed to stop BlueZ discovery after start failure:', cleanupError)
    }
  }
  if (ownsGroup) {
    try {
      await clearBluezDiscoveryFilter(runtime)
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError)
      console.error('[startBluezScan] Failed to clear the BlueZ discovery filter after start failure:', cleanupError)
    }
  }
  releaseFailedScanStartup(runtime, group, consumer)
  if (cleanupErrors.length > 0) {
    throw new AggregateError([primaryError, ...cleanupErrors], 'BlueZ scan start and cleanup both failed')
  }
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
  if (runtime.scanGroup === group) {
    runtime.scanGroup = null
  }
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

async function stopBluezPhysicalDiscovery(runtime: BluezBackendRuntime, group: BluezScanGroup): Promise<void> {
  await runtime.boundary.methods.callVoid(
    String(runtime.selectedAdapter.adapterId),
    BLUEZ_ADAPTER_INTERFACE,
    'StopDiscovery',
    []
  )
  await waitForBluezBoolean(
    runtime,
    String(runtime.selectedAdapter.adapterId),
    BLUEZ_ADAPTER_INTERFACE,
    'Discovering',
    false,
    { signal: null, deadline: null }
  )
  group.physicalStarted = false
}

function observeScanCleanup(cleanup: Promise<CleanupRecord>): void {
  cleanup.catch(error => {
    console.error('[startBluezScan] Failed to stop an aborted BlueZ scan:', error)
  })
}

function assertScanAdmission(runtime: BluezBackendRuntime, options: OwnerScanOptions<string, string>): void {
  const failure = scanAdmissionFailure(runtime, options)
  if (failure !== null) {
    throw failure
  }
}

function scanAdmissionFailure(runtime: BluezBackendRuntime, options: OwnerScanOptions<string, string>): Error | null {
  if (options.signal?.aborted === true) {
    return contractError('operation.aborted', 'scan', 'bluez.scan.start')
  }
  if (options.deadline !== null && options.deadline <= runtime.now()) {
    return contractError('operation.timed-out', 'scan', 'bluez.scan.start')
  }
  return null
}

function scanStartupFailure(runtime: BluezBackendRuntime, group: BluezScanGroup): Error | null {
  if (runtime.isDestroying()) {
    return contractError('operation.cancelled-by-destroy', 'core', 'bluez.scan.start')
  }
  if (runtime.scanGroup !== group) {
    return contractError('operation.reset', 'core', 'bluez.scan.start')
  }
  return null
}
