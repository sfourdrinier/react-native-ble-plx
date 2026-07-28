// src/backends/corebluetooth/corebluetooth-attachment-lifecycle.ts

import type { AdapterStateSnapshot, AttachmentRecord } from '../../backend-contract/identity'
import { monotonicTimestamp, opaqueId, type BackendInstanceId } from '../../backend-contract/primitives'
import type { CoreBluetoothAdapterSnapshot } from './corebluetooth-boundary'
import type { DirectGattBackendIdentityOptions } from './corebluetooth-identity'

/** Keeps attachment identity stable while allowing a post-open adapter-state refresh. */
export class CoreBluetoothAttachmentLifecycle {
  private adapterStateSnapshot: CoreBluetoothAdapterSnapshot
  private currentAttachment: AttachmentRecord<string>
  private backendGeneration = 1
  private adapterGeneration = 1

  constructor(
    private readonly backendInstanceId: BackendInstanceId<string>,
    private readonly identityOptions: DirectGattBackendIdentityOptions,
    private readonly now: () => number,
    initialAdapterState: CoreBluetoothAdapterSnapshot
  ) {
    this.adapterStateSnapshot = initialAdapterState
    this.currentAttachment = this.buildAttachment()
  }

  get generation(): number {
    return this.backendGeneration
  }

  attachment(): AttachmentRecord<string> {
    return this.currentAttachment
  }

  adapterState(): AdapterStateSnapshot<string> {
    const state = this.adapterStateSnapshot
    return Object.freeze({
      availability: state.availability,
      authorization: state.authorization,
      power: state.power,
      backendGeneration: opaqueId(
        String(this.backendGeneration),
        'backend-generation',
        this.identityOptions.attachmentScope
      ),
      updatedAt: monotonicTimestamp(this.now()),
      safeReason: state.safeReason
    })
  }

  updateAdapterState(state: CoreBluetoothAdapterSnapshot): void {
    this.adapterStateSnapshot = state
  }

  refreshAttachmentState(): void {
    this.currentAttachment = this.buildAttachment()
  }

  advanceGeneration(): void {
    this.backendGeneration += 1
    this.adapterGeneration += 1
    this.currentAttachment = this.buildAttachment()
  }

  private buildAttachment(): AttachmentRecord<string> {
    const backendGeneration = opaqueId(
      String(this.backendGeneration),
      'backend-generation',
      this.identityOptions.attachmentScope
    )
    const adapterId = opaqueId(this.identityOptions.adapterNativeId, 'adapter', this.identityOptions.attachmentScope)
    return Object.freeze({
      attachmentId: opaqueId(
        `${String(this.backendInstanceId)}:${this.backendGeneration}:${this.adapterGeneration}`,
        'attachment',
        this.identityOptions.attachmentScope
      ),
      backendInstanceId: this.backendInstanceId,
      backendGeneration,
      adapter: Object.freeze({
        adapterId,
        displayName: this.identityOptions.adapterDisplayName,
        state: this.adapterState(),
        adapterGeneration: opaqueId(
          String(this.adapterGeneration),
          'adapter-generation',
          this.identityOptions.attachmentScope
        ),
        limitations: Object.freeze([...this.identityOptions.limitations])
      })
    })
  }
}
