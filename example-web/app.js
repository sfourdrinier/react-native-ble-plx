// example-web/app.js

import { capacity } from 'unified-ble-manager'
import { createNavigatorWebBleManager } from 'unified-ble-manager/web'
import { BATTERY_SERVICE } from 'unified-ble-manager/profiles/battery-service'
import {
  HEART_RATE_SERVICE,
  parseHeartRateMeasurement
} from 'unified-ble-manager/profiles/heart-rate'
import {
  readBatteryLevel,
  subscribeHeartRateMeasurements
} from 'unified-ble-manager/profiles/standard-commands'

const operationOptions = Object.freeze({ signal: null, deadline: null })
const notificationOptions = Object.freeze({
  ...operationOptions,
  delivery: Object.freeze({
    itemCapacity: capacity(16),
    byteCapacity: capacity(4096),
    reservedControlCapacity: capacity(2),
    overflowPolicy: 'drop-oldest'
  })
})

const controls = Object.freeze({
  choose: document.getElementById('choose-connect'),
  reconnect: document.getElementById('reconnect'),
  disconnect: document.getElementById('disconnect'),
  destroy: document.getElementById('destroy')
})
const fields = Object.freeze({
  status: document.getElementById('status'),
  peer: document.getElementById('peer'),
  battery: document.getElementById('battery'),
  heartRate: document.getElementById('heart-rate'),
  resources: document.getElementById('resources'),
  events: document.getElementById('events')
})

let session = null
let connection = null
let database = null
let subscription = null
let notificationTask = null
let selectedPeerId = null
let busy = false
let nextManagerNumber = 0

controls.choose.addEventListener('click', () => runAction('choose-connect', chooseAndConnect))
controls.reconnect.addEventListener('click', () => runAction('reconnect', reconnect))
controls.disconnect.addEventListener('click', () => runAction('disconnect', disconnect))
controls.destroy.addEventListener('click', () => runAction('destroy', destroyManager))

window.addEventListener('pagehide', () => {
  void destroyManager().catch(error => {
    console.error('[web-example.pagehide] Unified BLE cleanup failed:', error)
  })
})

render()

async function runAction(name, action) {
  if (busy) return
  busy = true
  render()
  try {
    await action()
  } catch (error) {
    const failure = toError(error)
    console.error(`[web-example.${name}] Unified BLE operation failed:`, failure)
    setStatus(`${name} failed: ${failure.message}`, true)
  } finally {
    busy = false
    render()
  }
}

async function chooseAndConnect() {
  if (connection !== null) {
    throw new Error('Disconnect the current peer before choosing another device.')
  }
  const activeSession = await ensureSession()
  setStatus('Opening the Web Bluetooth chooser…')
  const selection = await activeSession.chooser.choose(
    {
      filters: [{ serviceUuids: [HEART_RATE_SERVICE], manufacturerData: [], localNamePrefix: null }],
      acceptAllDevices: false,
      optionalServices: [HEART_RATE_SERVICE, BATTERY_SERVICE]
    },
    operationOptions
  )
  selectedPeerId = selection.peerId
  appendEvent('chooser', 'selected a Heart Rate Service peer')
  await connectSelectedPeer('connect')
}

async function reconnect() {
  if (selectedPeerId === null) throw new Error('Choose a device before reconnecting.')
  if (connection !== null) throw new Error('The selected peer is already connected.')
  await ensureSession()
  await connectSelectedPeer('reconnect')
}

async function connectSelectedPeer(operation) {
  if (session === null || selectedPeerId === null) {
    throw new Error('The Web Bluetooth manager or selected peer is unavailable.')
  }
  setStatus(operation === 'reconnect' ? 'Reconnecting…' : 'Connecting…')
  const connected = await session.manager.connect(selectedPeerId, operationOptions)
  connection = connected
  appendEvent(operation, `connection generation ${String(connected.connectionGeneration)}`)

  const discovered = await connection.discover(operationOptions)
  database = discovered
  const snapshot = await database.snapshot()
  appendEvent('discover', `${String(snapshot.services.length)} services`)

  const battery = await readBatteryLevel(database, operationOptions)
  fields.battery.textContent = `${String(battery)}%`
  appendEvent('read', `Battery Level ${String(battery)}%`)

  subscription = await subscribeHeartRateMeasurements(database, notificationOptions)
  notificationTask = consumeHeartRateNotifications(subscription)
  appendEvent('notify', 'Heart Rate Measurement subscription active')
  setStatus('Connected, discovered, read, and subscribed.')
}

async function consumeHeartRateNotifications(activeSubscription) {
  try {
    for await (const item of activeSubscription.values) {
      if (item.kind === 'value') {
        const measurement = parseHeartRateMeasurement(item.value.value)
        fields.heartRate.textContent = `${String(measurement.beatsPerMinute)} BPM`
        appendEvent('notification', `${String(measurement.beatsPerMinute)} BPM`)
        continue
      }
      if (item.kind === 'overflow') {
        appendEvent('overflow', `${String(item.droppedItems)} notification item(s) dropped`)
        continue
      }
      appendEvent('terminal', item.reason)
      return null
    }
    return null
  } catch (error) {
    const failure = toError(error)
    console.error('[web-example.consumeHeartRateNotifications] Notification stream failed:', failure)
    return failure
  }
}

async function disconnect() {
  const failures = []
  await stopSubscription(failures)
  if (connection !== null) {
    try {
      assertReleased(await connection.disconnect(), 'connection disconnect')
      connection = null
      database = null
      appendEvent('disconnect', 'connection resources released')
    } catch (error) {
      failures.push(toError(error))
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, 'Bluetooth disconnect cleanup failed.')
  setStatus('Disconnected. Reconnect uses the same authorized peer.')
}

async function stopSubscription(failures) {
  if (subscription === null) return
  try {
    assertReleased(await subscription.remove(), 'notification removal')
    subscription = null
    appendEvent('notification-stop', 'subscription resources released')
  } catch (error) {
    failures.push(toError(error))
    return
  }
  if (notificationTask !== null) {
    const notificationFailure = await notificationTask
    notificationTask = null
    if (notificationFailure !== null) failures.push(notificationFailure)
  }
}

async function destroyManager() {
  const failures = []
  try {
    await disconnect()
  } catch (error) {
    failures.push(toError(error))
  }
  if (session !== null) {
    try {
      assertReleased(await session.manager.destroy(), 'manager destroy')
      fields.resources.textContent = JSON.stringify(session.manager.localResourceCounters())
      session = null
      selectedPeerId = null
      appendEvent('destroy', 'manager resources released')
    } catch (error) {
      failures.push(toError(error))
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, 'Unified BLE manager cleanup failed.')
  setStatus('Manager destroyed. All owned resources were released.')
}

async function ensureSession() {
  if (session !== null) return session
  nextManagerNumber += 1
  session = await createNavigatorWebBleManager({
    environment: createNavigatorEnvironment(),
    clientId: 'unified-ble-web-example',
    managerId: `unified-ble-web-example-${String(nextManagerNumber)}`
  })
  appendEvent('bootstrap', 'Web Bluetooth backend attached')
  return session
}

function createNavigatorEnvironment() {
  if (navigator.bluetooth === undefined) {
    throw new Error('Web Bluetooth is unavailable. Use a current Chrome installation on localhost or HTTPS.')
  }
  const timers = new Map()
  const bluetooth = navigator.bluetooth
  return {
    implementationVersion: 'unified-ble-manager-web-example-4.0',
    browserEngine: navigator.userAgent,
    bluetooth: {
      getAvailability: typeof bluetooth.getAvailability === 'function'
        ? () => bluetooth.getAvailability()
        : undefined,
      requestDevice: options => bluetooth.requestDevice(options)
    },
    isSecureContext: () => window.isSecureContext,
    hasTransientUserActivation: () => navigator.userActivation?.isActive ?? false,
    now: () => performance.now(),
    setTimer: (callback, delayMilliseconds) => {
      const handle = Object.freeze({})
      const timer = window.setTimeout(() => {
        timers.delete(handle)
        callback()
      }, delayMilliseconds)
      timers.set(handle, timer)
      return handle
    },
    clearTimer: handle => {
      const timer = timers.get(handle)
      if (timer === undefined) return
      timers.delete(handle)
      window.clearTimeout(timer)
    },
    addPageLifecycleListener: listener => {
      const onVisibilityChange = () => {
        if (document.visibilityState === 'hidden') listener('page-hidden')
      }
      const onPageHide = () => listener('page-unloaded')
      document.addEventListener('visibilitychange', onVisibilityChange)
      window.addEventListener('pagehide', onPageHide)
      return () => {
        document.removeEventListener('visibilitychange', onVisibilityChange)
        window.removeEventListener('pagehide', onPageHide)
      }
    }
  }
}

function assertReleased(cleanup, operation) {
  if (cleanup.state !== 'released' || cleanup.failures.length !== 0) {
    throw new Error(`${operation} did not release every owned resource.`)
  }
}

function appendEvent(operation, detail) {
  const item = document.createElement('li')
  item.textContent = `${operation}: ${detail}`
  fields.events.append(item)
}

function setStatus(message, error = false) {
  fields.status.textContent = message
  fields.status.classList.toggle('error', error)
}

function render() {
  controls.choose.disabled = busy || connection !== null
  controls.reconnect.disabled = busy || session === null || selectedPeerId === null || connection !== null
  controls.disconnect.disabled = busy || connection === null
  controls.destroy.disabled = busy || session === null
  fields.peer.textContent = selectedPeerId ?? '—'
  if (session !== null) fields.resources.textContent = JSON.stringify(session.manager.localResourceCounters())
}

function toError(error) {
  return error instanceof Error ? error : new Error(String(error))
}
