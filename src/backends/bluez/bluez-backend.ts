// src/backends/bluez/bluez-backend.ts

import type { BackendAttachment, BackendAttachmentRequest, BleCentralBackend } from '../../backend-contract/backend'
import { contractError, type CleanupRecord } from '../../backend-contract/errors'
import { createFeatureRegistry } from '../../backend-contract/capabilities'
import type { AdapterDescriptor, HostNeutralBackendIdentity } from '../../backend-contract/identity'
import { negotiateCoreVersions, opaqueId, type BackendInstanceId } from '../../backend-contract/primitives'
import type { BluezBusKind, BluezDbusBoundary } from './bluez-dbus-contract'
import { BluezObjectStore } from './bluez-object-store'
import {
  BLUEZ_BACKEND_ID,
  BLUEZ_IMPLEMENTATION_VERSION,
  BLUEZ_PLATFORM_ID,
  bluezCompatibility
} from './bluez-backend-provider'
import { BluezBackendRuntime } from './bluez-backend-runtime'

export interface BluezBackendConstruction {
  readonly boundary: BluezDbusBoundary
  readonly store: BluezObjectStore
  readonly adapter: AdapterDescriptor<string>
  readonly now: () => number
  readonly busKind: BluezBusKind
}

let nextBluezBackendInstance = 1

function allocateBluezBackendInstance(): number {
  const value = nextBluezBackendInstance
  nextBluezBackendInstance += 1
  return value
}

/** Contract-v1 BlueZ backend bound to one explicitly selected D-Bus adapter. */
export class BluezBackend implements BleCentralBackend<string, HostNeutralBackendIdentity<string>> {
  readonly features = createFeatureRegistry([])
  readonly adapter
  readonly scanner
  readonly connections
  readonly gatt
  private readonly backendInstanceId: BackendInstanceId<string>
  private readonly runtime: BluezBackendRuntime
  private attached = false

  constructor(construction: BluezBackendConstruction) {
    this.backendInstanceId = opaqueId(`bluez-backend-${allocateBluezBackendInstance()}`, 'backend-instance', 'bluez')
    this.runtime = new BluezBackendRuntime({
      ...construction,
      backendInstanceId: this.backendInstanceId
    })
    this.adapter = this.runtime.adapter
    this.scanner = this.runtime.scanner
    this.connections = this.runtime.connections
    this.gatt = this.runtime.gatt
  }

  get identity(): HostNeutralBackendIdentity<string> {
    const attachment = this.runtime.attachment()
    return Object.freeze({
      registeredBackendId: BLUEZ_BACKEND_ID,
      registeredPlatformId: BLUEZ_PLATFORM_ID,
      attachment,
      versions: negotiateCoreVersions(bluezCompatibility, bluezCompatibility),
      runtime: Object.freeze({
        hostKind: 'node',
        implementationVersion: BLUEZ_IMPLEMENTATION_VERSION,
        diagnostics: Object.freeze({
          busKind: this.runtime.busKind,
          selectedAdapterPath: String(attachment.adapter.adapterId)
        })
      })
    })
  }

  async attach(
    request: BackendAttachmentRequest
  ): Promise<BackendAttachment<string, HostNeutralBackendIdentity<string>>> {
    this.runtime.assertUsable('bluez.attach')
    if (this.attached) {
      throw contractError('lifecycle.invalid-state', 'core', 'bluez.attach')
    }
    negotiateCoreVersions(bluezCompatibility, request.coreCompatibility)
    this.attached = true
    const identity = this.identity
    return Object.freeze({ attachment: identity.attachment, identity })
  }

  events() {
    return this.runtime.events()
  }

  resourceCounters() {
    return this.runtime.resourceCounters()
  }

  destroy(): Promise<CleanupRecord> {
    return this.runtime.destroy()
  }
}
