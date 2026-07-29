// src/backends/bluez/bluez-runtime-types.ts

import type { AdvertisementObservation, OwnerScanOptions } from '../../backend-contract/advertisement'
import type { CleanupRecord } from '../../backend-contract/errors'
import type { NotificationValue } from '../../backend-contract/gatt'
import type { OperationTerminalRecord } from '../../backend-contract/operations'
import type {
  ClientId,
  LeaseId,
  PeerId,
  ScanSessionId,
  ScanShareToken,
  SubscriptionId,
  Uuid
} from '../../backend-contract/primitives'
import { capacity } from '../../backend-contract/primitives'
import { CoreBoundedStream } from '../../core/bounded-stream'
import type { BluezConnection, BluezConnectionLease, BluezGattDatabase } from './bluez-backend-handles'

export const bluezEventLimits = Object.freeze({
  itemCapacity: capacity(64),
  byteCapacity: capacity(64 * 1024),
  reservedControlCapacity: capacity(1)
})
export const bluezStateLimits = Object.freeze({
  itemCapacity: capacity(16),
  byteCapacity: capacity(16 * 1024),
  reservedControlCapacity: capacity(1)
})

export interface BluezScanConsumer {
  readonly scanSessionId: ScanSessionId<string, string>
  readonly leaseId: LeaseId<string, string>
  readonly shareToken: ScanShareToken<string, string> | null
  readonly clientId: ClientId<string, string>
  readonly options: OwnerScanOptions<string, string>
  readonly stream: CoreBoundedStream<AdvertisementObservation<string>>
  readonly abort: (() => void) | null
  deadlineTimer: ReturnType<typeof setTimeout> | null
  stopped: Promise<CleanupRecord> | null
}

export interface BluezScanGroup {
  readonly ownerLeaseId: LeaseId<string, string>
  readonly shareToken: ScanShareToken<string, string> | null
  readonly signature: string
  readonly consumers: Map<string, BluezScanConsumer>
  state: 'starting' | 'active' | 'stopping'
  physicalStarted: boolean
  stopRequested: boolean
  startupComplete: boolean
  readonly startupSettled: Promise<void>
  readonly settleStartup: () => void
}

export interface BluezConnectionRecord {
  readonly devicePath: string
  readonly peerId: PeerId<string>
  connection: BluezConnection | null
  readonly leases: Set<BluezConnectionLease>
  readonly databases: Set<BluezGattDatabase>
  state: 'connecting' | 'connected' | 'disconnecting' | 'disconnected' | 'lost'
  active: boolean
  /** A Connect call or an existing BlueZ link requires destroy-time Disconnect even before confirmation. */
  physicalLinkMayExist: boolean
  ownerLeaseId: LeaseId<string, string> | null
  nextDatabaseGeneration: number
  currentDatabase: BluezGattDatabase | null
  transition: Promise<void> | null
  disconnection: Promise<CleanupRecord> | null
  pendingConnectors: number
  orphanCleanupScheduled: boolean
}

export interface BluezGattDescriptorRecord {
  readonly objectPath: string
  readonly uuid: Uuid
}

export interface BluezGattCharacteristicRecord {
  readonly objectPath: string
  readonly uuid: Uuid
  readonly flags: readonly string[]
  readonly descriptors: readonly BluezGattDescriptorRecord[]
}

export interface BluezGattServiceRecord {
  readonly objectPath: string
  readonly uuid: Uuid
  readonly characteristics: readonly BluezGattCharacteristicRecord[]
}

export interface BluezGattSnapshotRecord {
  readonly services: readonly BluezGattServiceRecord[]
}

export interface BluezPhysicalSubscription {
  readonly objectPath: string
  readonly consumers: Set<BluezSubscriptionRecord>
  pendingConsumers: number
  state: 'enabling' | 'ready' | 'removing'
  readonly startMethod: Promise<void>
  readonly enablement: Promise<void>
  removal: Promise<CleanupRecord> | null
}

export interface BluezSubscriptionRecord {
  readonly subscriptionId: SubscriptionId<string, string, string, string, string, string>
  readonly stream: CoreBoundedStream<NotificationValue>
  readonly terminal: OperationTerminalRecord<string, string>
  readonly physical: BluezPhysicalSubscription
  removed: boolean
}

export interface BluezPropertyWaiter {
  readonly path: string
  readonly interfaceName: string
  readonly property: string
  readonly expected: boolean
  readonly resolve: () => void
  readonly reject: (error: Error) => void
  readonly signal: AbortSignal | null
  readonly abort: () => void
  timer: ReturnType<typeof setTimeout> | null
}
