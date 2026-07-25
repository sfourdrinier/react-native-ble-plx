/**
 * Fail-closed deviceId validation for Electron main IPC (renderer-supplied args).
 * Only accept non-empty strings that match charset bounds and, for connect-like
 * ops, ids previously advertised via discover/list (or listPairedDevices).
 */

const DEVICE_ID_MAX_LEN = 128
const DEVICE_ID_RE = /^[0-9a-zA-Z:_-]+$/

/**
 * Length + charset only (no allowlist). Use for unpair after paired ids are remembered,
 * or as the shape half of assertKnownDeviceId.
 * @param {unknown} deviceId
 * @returns {string}
 */
function assertDeviceIdShape(deviceId) {
  if (typeof deviceId !== 'string') {
    throw new TypeError('deviceId must be a string')
  }
  if (deviceId.length === 0 || deviceId.length > DEVICE_ID_MAX_LEN) {
    throw new Error(`deviceId length out of bounds (1–${DEVICE_ID_MAX_LEN})`)
  }
  if (!DEVICE_ID_RE.test(deviceId)) {
    throw new Error('deviceId contains invalid characters')
  }
  return deviceId
}

/**
 * @param {unknown} deviceId
 * @param {Set<string>} knownDeviceIds
 * @returns {string}
 */
function assertKnownDeviceId(deviceId, knownDeviceIds) {
  const id = assertDeviceIdShape(deviceId)
  if (!knownDeviceIds || !knownDeviceIds.has(id)) {
    throw new Error('Unknown deviceId — discover, listDevices, or listPairedDevices first')
  }
  return id
}

/**
 * @param {unknown} id
 * @param {Set<string>} knownDeviceIds
 */
function rememberDeviceId(id, knownDeviceIds) {
  if (
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= DEVICE_ID_MAX_LEN &&
    DEVICE_ID_RE.test(id)
  ) {
    knownDeviceIds.add(id)
  }
}

/**
 * @param {unknown} list
 * @param {Set<string>} knownDeviceIds
 */
function rememberDevices(list, knownDeviceIds) {
  if (!Array.isArray(list)) return
  for (const entry of list) {
    if (entry && typeof entry === 'object' && typeof entry.id === 'string') {
      rememberDeviceId(entry.id, knownDeviceIds)
    } else if (typeof entry === 'string') {
      rememberDeviceId(entry, knownDeviceIds)
    }
  }
}

module.exports = {
  DEVICE_ID_MAX_LEN,
  DEVICE_ID_RE,
  assertDeviceIdShape,
  assertKnownDeviceId,
  rememberDeviceId,
  rememberDevices
}
