// example/src/services/storage/persistentDeviceNameHydration.ts

/** A storage response is valid only if no local edit happened after the read began. */
export function shouldApplyPersistedDeviceName(readStartedAtEditVersion: number, currentEditVersion: number): boolean {
  return readStartedAtEditVersion === currentEditVersion
}
