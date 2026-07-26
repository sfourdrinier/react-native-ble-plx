/**
 * Cross-host central helpers (4.0) — scan/connect/notify recipes that work on
 * RN BleManager and PortBleManager (Electron / Web / Fake / Node).
 *
 * See docs/HELPERS.md.
 */

export {
  withTimeout,
  waitForState,
  findDevice,
  connectAndDiscover,
  firstNotification,
  tryReadCharacteristicBytes,
  assertSupported,
  safeTeardown
} from './central'

export type {
  BleCentralLike,
  ScannedDeviceLike,
  ScanListener,
  HelperSubscription,
  WaitForStateOptions,
  FindDeviceOptions,
  ConnectAndDiscoverOptions,
  FirstNotificationOptions,
  TryReadOptions,
  TryReadResult,
  SafeTeardownOptions
} from './types'
