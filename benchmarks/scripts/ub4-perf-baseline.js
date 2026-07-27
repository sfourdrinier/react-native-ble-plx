// benchmarks/scripts/ub4-perf-baseline.js

'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { fork, spawnSync } = require('node:child_process')
const { BUDGET_DIMENSIONS, calculateStatistics, validateResult } = require('./validate-ub4-perf-baseline')

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..')
const SAMPLE_COUNT = 31
const WARMUP_BATCHES = 10
const ISOLATED_RESOURCE_SAMPLES = 7
const SAMPLING_SEED = 418992731
const PAYLOADS = [0, 20, 64, 512, 4096, 65536, 1048576]
const MEASURED_BUILD_MODULES = [
  'lib/commonjs/encoding.js',
  'lib/commonjs/port/BlePort.js',
  'lib/commonjs/port/PortBleManager.js',
  'lib/commonjs/DeviceOperationQueue.js',
  'native/electron/corebluetooth/index.js',
  'native/electron/corebluetooth/build/Release/unified_ble_corebluetooth.node'
]

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function nowNs() {
  return process.hrtime.bigint()
}

function elapsedNs(start) {
  return Number(nowNs() - start)
}

function round(value) {
  return Number(value.toFixed(6))
}

function nextTurn() {
  return new Promise(resolve => setImmediate(resolve))
}

function consumeBytes(bytes) {
  if (bytes.length === 0) return 0
  return bytes[0] ^ bytes[Math.floor(bytes.length / 2)] ^ bytes[bytes.length - 1] ^ bytes.length
}

function consumeText(text) {
  if (text.length === 0) return 0
  return text.charCodeAt(0) ^ text.charCodeAt(Math.floor(text.length / 2)) ^ text.charCodeAt(text.length - 1) ^ text.length
}

function assertBytesEqual(actual, expected, label) {
  if (!Buffer.from(actual).equals(Buffer.from(expected))) throw new Error(`${label} payload integrity failed`)
}

function makePayload(byteLength, byteOffset) {
  const backing = new Uint8Array(byteLength + byteOffset + 19)
  for (let index = 0; index < backing.length; index += 1) backing[index] = (index * 37 + 11) % 251
  return backing.subarray(byteOffset, byteOffset + byteLength)
}

function integrity(input, output) {
  return { algorithm: 'sha256', inputSha256: sha256(input), outputSha256: sha256(output), verified: true }
}

function createPrng(seed) {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function shuffled(items, random) {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1))
    ;[copy[index], copy[target]] = [copy[target], copy[index]]
  }
  return copy
}

function runSyncBatch(descriptor) {
  let checksum = 0
  for (let index = 0; index < descriptor.iterationsPerSample; index += 1) checksum ^= descriptor.run()
  return checksum
}

async function runAsyncBatch(descriptor) {
  let checksum = 0
  for (let index = 0; index < descriptor.iterationsPerSample; index += 1) checksum ^= await descriptor.run()
  return checksum
}

function finishDescriptors(descriptors) {
  return descriptors.map(descriptor => {
    const result = {
      id: descriptor.id,
      warmupBatches: WARMUP_BATCHES,
      iterationsPerSample: descriptor.iterationsPerSample,
      samplesNsPerOperation: descriptor.samplesNsPerOperation,
      statistics: calculateStatistics(descriptor.samplesNsPerOperation),
      integrity: descriptor.integrity
    }
    if (Object.hasOwn(descriptor, 'payload')) result.payload = descriptor.payload
    return result
  })
}

function measureSyncSuite(descriptors, seed) {
  const random = createPrng(seed)
  for (const descriptor of descriptors) descriptor.samplesNsPerOperation = []
  for (let roundIndex = 0; roundIndex < WARMUP_BATCHES; roundIndex += 1) {
    for (const descriptor of shuffled(descriptors, random)) runSyncBatch(descriptor)
  }
  for (let sampleIndex = 0; sampleIndex < SAMPLE_COUNT; sampleIndex += 1) {
    for (const descriptor of shuffled(descriptors, random)) {
      const startedAt = nowNs()
      runSyncBatch(descriptor)
      descriptor.samplesNsPerOperation.push(round(elapsedNs(startedAt) / descriptor.iterationsPerSample))
    }
  }
  return finishDescriptors(descriptors)
}

async function measureAsyncSuite(descriptors, seed) {
  const random = createPrng(seed)
  for (const descriptor of descriptors) descriptor.samplesNsPerOperation = []
  for (let roundIndex = 0; roundIndex < WARMUP_BATCHES; roundIndex += 1) {
    for (const descriptor of shuffled(descriptors, random)) await runAsyncBatch(descriptor)
  }
  for (let sampleIndex = 0; sampleIndex < SAMPLE_COUNT; sampleIndex += 1) {
    for (const descriptor of shuffled(descriptors, random)) {
      const startedAt = nowNs()
      await runAsyncBatch(descriptor)
      descriptor.samplesNsPerOperation.push(round(elapsedNs(startedAt) / descriptor.iterationsPerSample))
    }
  }
  return finishDescriptors(descriptors)
}

function requireBuiltModule(relativePath) {
  const modulePath = path.join(REPOSITORY_ROOT, relativePath)
  if (!fs.existsSync(modulePath)) throw new Error(`Missing ${relativePath}; run pnpm prepack before capture`)
  return require(modulePath)
}

function loadedModules() {
  return {
    encoding: requireBuiltModule('lib/commonjs/encoding.js'),
    blePort: requireBuiltModule('lib/commonjs/port/BlePort.js'),
    portManager: requireBuiltModule('lib/commonjs/port/PortBleManager.js'),
    deviceQueue: requireBuiltModule('lib/commonjs/DeviceOperationQueue.js')
  }
}

function iterationsFor(byteLength, targetBytes, minimumIterations = 8) {
  if (byteLength === 0) return 100000
  return Math.max(minimumIterations, Math.min(100000, Math.ceil(targetBytes / byteLength)))
}

function captureCodec() {
  const { bytesToBase64, base64ToBytes } = loadedModules().encoding
  const payloads = []
  const descriptors = []
  for (const [index, byteLength] of PAYLOADS.entries()) {
    const byteOffset = byteLength === 0 ? 0 : 7 + index
    const bytes = makePayload(byteLength, byteOffset)
    const input = Buffer.from(bytes)
    const encoded = bytesToBase64(bytes)
    const decoded = base64ToBytes(encoded)
    const expectedEncoded = input.toString('base64')
    assertBytesEqual(decoded, input, `codec preflight decode ${byteLength}`)
    if (encoded !== expectedEncoded) throw new Error(`codec preflight encode ${byteLength} differs from Node Base64`)
    const iterationsPerSample = iterationsFor(byteLength, 1024 * 1024, 1)
    const operations = [
      { id: 'byte-copy', iterationsPerSample, integrity: integrity(input, input), run: () => { const copied = new Uint8Array(bytes); assertBytesEqual(copied, input, `byte-copy ${byteLength}`); return consumeBytes(copied) } },
      { id: 'base64-encode', iterationsPerSample, integrity: integrity(input, Buffer.from(encoded, 'ascii')), run: () => { const output = bytesToBase64(bytes); if (output !== expectedEncoded) throw new Error(`base64 encode ${byteLength} payload integrity failed`); return consumeText(output) } },
      { id: 'base64-decode', iterationsPerSample, integrity: integrity(input, input), run: () => { const decodedOutput = base64ToBytes(encoded); assertBytesEqual(decodedOutput, input, `base64 decode ${byteLength}`); return consumeBytes(decodedOutput) } }
    ]
    const payload = { id: `payload-${byteLength}-offset-${byteOffset}`, byteLength, byteOffset, encodedBytes: Buffer.byteLength(encoded, 'ascii'), encodedExpansionRatio: byteLength === 0 ? null : round(Buffer.byteLength(encoded, 'ascii') / byteLength), operations }
    payloads.push(payload)
    for (const operation of operations) descriptors.push({ ...operation, payload })
  }
  const measured = measureSyncSuite(descriptors, SAMPLING_SEED)
  for (const operation of measured) operation.payload.operations = operation.payload.operations.map(candidate => candidate.id === operation.id ? operation : candidate)
  return { id: 'codec-base64-and-byte-copy', classification: 'deterministic-microbenchmark', status: 'passed', method: 'Compiled Node Buffer-backed codec versus explicit Uint8Array copy. Preflight verifies complete payload equality before randomized/interleaved timed batches.', payloads: payloads.map(payload => ({ ...payload, operations: payload.operations.map(({ run, payload: ignored, ...operation }) => operation) })) }
}

function seededFakePort(FakeBlePort) {
  const deviceId = 'BENCHMARK-DEVICE'
  const serviceUuid = '180d'
  const characteristicUuid = '2a37'
  const services = Object.fromEntries([deviceId, 'BENCHMARK-DEVICE-B'].map(id => [id, { [serviceUuid]: { [characteristicUuid]: { value: makePayload(20, 5), properties: { read: true, write: true, notify: true } } } }]))
  return { port: new FakeBlePort({ services }), deviceId, serviceUuid, characteristicUuid }
}

async function captureNotificationDispatch() {
  const { FakeBlePort } = loadedModules().blePort
  const { PortBleManager } = loadedModules().portManager
  const payload = Buffer.from(makePayload(512, 11))
  const direct = seededFakePort(FakeBlePort)
  await direct.port.connect(direct.deviceId)
  let directValue = null
  const directUnsubscribe = await direct.port.monitorCharacteristic(direct.deviceId, direct.serviceUuid, direct.characteristicUuid, value => { directValue = Buffer.from(value) })
  await direct.port.emitNotification(direct.deviceId, direct.serviceUuid, direct.characteristicUuid, payload)
  assertBytesEqual(directValue, payload, 'direct notification preflight')
  const managed = seededFakePort(FakeBlePort)
  await managed.port.connect(managed.deviceId)
  const manager = new PortBleManager({ port: managed.port, host: 'fake' })
  let managedValue = null
  const subscription = manager.monitorCharacteristicForDevice(managed.deviceId, managed.serviceUuid, managed.characteristicUuid, (error, characteristic) => {
    if (error) throw error
    if (!characteristic || characteristic.value === null) throw new Error('Base64 notification delivered no value')
    managedValue = Buffer.from(characteristic.value, 'base64')
  })
  await nextTurn()
  await nextTurn()
  await managed.port.emitNotification(managed.deviceId, managed.serviceUuid, managed.characteristicUuid, payload)
  assertBytesEqual(managedValue, payload, 'Port manager notification preflight')
  const operations = await measureAsyncSuite([
    { id: 'fake-port-direct-bytes-512', iterationsPerSample: 250, integrity: integrity(payload, payload), run: async () => { directValue = null; await direct.port.emitNotification(direct.deviceId, direct.serviceUuid, direct.characteristicUuid, payload); assertBytesEqual(directValue, payload, 'direct notification'); return consumeBytes(directValue) } },
    { id: 'port-manager-base64-512', iterationsPerSample: 200, integrity: integrity(payload, payload), run: async () => { managedValue = null; await managed.port.emitNotification(managed.deviceId, managed.serviceUuid, managed.characteristicUuid, payload); assertBytesEqual(managedValue, payload, 'Port manager notification'); return consumeBytes(managedValue) } }
  ], SAMPLING_SEED + 1)
  await directUnsubscribe()
  subscription.remove()
  await nextTurn()
  managedValue = null
  await managed.port.emitNotification(managed.deviceId, managed.serviceUuid, managed.characteristicUuid, payload)
  const postUnsubscribeNotifications = managedValue === null ? 0 : 1
  manager.destroy()
  if (postUnsubscribeNotifications !== 0) throw new Error('notification delivered after unsubscribe')
  return { id: 'notification-dispatch-mock', classification: 'deterministic-microbenchmark', status: 'passed', method: 'Fake notification dispatch with complete byte equality checked for every timed callback; no OS, TurboModule, controller, or radio is involved.', operations, postUnsubscribeNotifications }
}

async function capturePortQueue() {
  const { FakeBlePort } = loadedModules().blePort
  const { PortBleManager } = loadedModules().portManager
  const seeded = seededFakePort(FakeBlePort)
  await seeded.port.connect(seeded.deviceId)
  await seeded.port.connect('BENCHMARK-DEVICE-B')
  const originalWrite = seeded.port.writeCharacteristicBytes.bind(seeded.port)
  let activeWrites = 0
  let maxConcurrentWrites = 0
  let concurrencyGate = null
  seeded.port.writeCharacteristicBytes = async (...args) => {
    activeWrites += 1
    maxConcurrentWrites = Math.max(maxConcurrentWrites, activeWrites)
    try {
      if (concurrencyGate) await concurrencyGate
      return await originalWrite(...args)
    } finally {
      activeWrites -= 1
    }
  }
  const manager = new PortBleManager({ port: seeded.port, host: 'fake' })
  const payload = Buffer.from(makePayload(64, 9))
  await manager.writeCharacteristicWithResponseForDeviceFromBytes(seeded.deviceId, seeded.serviceUuid, seeded.characteristicUuid, payload)
  const preflightRead = await manager.readCharacteristicForDeviceAsBytes(seeded.deviceId, seeded.serviceUuid, seeded.characteristicUuid)
  assertBytesEqual(preflightRead.value, payload, 'queue write preflight')
  const [operation] = await measureAsyncSuite([{ id: 'serialized-write-64', iterationsPerSample: 100, integrity: integrity(payload, payload), run: async () => { await manager.writeCharacteristicWithResponseForDeviceFromBytes(seeded.deviceId, seeded.serviceUuid, seeded.characteristicUuid, payload); return consumeBytes(payload) } }], SAMPLING_SEED + 2)
  async function observe(deviceIds) {
    let releaseGate
    concurrencyGate = new Promise(resolve => { releaseGate = resolve })
    maxConcurrentWrites = 0
    const writes = deviceIds.map(id => manager.writeCharacteristicWithResponseForDeviceFromBytes(id, seeded.serviceUuid, seeded.characteristicUuid, payload))
    await nextTurn()
    await nextTurn()
    const observed = maxConcurrentWrites
    releaseGate()
    await Promise.all(writes)
    concurrencyGate = null
    return observed
  }
  const sameDeviceObserved = await observe([seeded.deviceId, seeded.deviceId])
  const differentDeviceObserved = await observe([seeded.deviceId, 'BENCHMARK-DEVICE-B'])
  const postDrainActiveDeviceCount = manager.getDeviceOperationQueue().activeDeviceCount()
  manager.destroy()
  if (sameDeviceObserved !== 1 || differentDeviceObserved < 2 || postDrainActiveDeviceCount !== 0) throw new Error('queue scheduling invariant failed')
  return { id: 'port-queue-latency-and-concurrency', classification: 'deterministic-microbenchmark', status: 'passed', method: 'PortBleManager over FakeBlePort. Timed data is scheduling characterization only, not native transport latency.', operations: [operation], concurrency: { sameDeviceObserved, differentDeviceObserved, postDrainActiveDeviceCount } }
}

async function exerciseResources(FakeBlePort, DeviceOperationQueue) {
  const queue = new DeviceOperationQueue()
  let releaseGate
  const gate = new Promise(resolve => { releaseGate = resolve })
  let queued = [queue.enqueue('UNBOUNDED-BACKLOG', async () => gate)]
  const submittedOperations = 4096
  for (let index = 1; index < submittedOperations; index += 1) queued.push(queue.enqueue('UNBOUNDED-BACKLOG', async () => undefined))
  await nextTurn()
  const activeDeviceKeysWhileBlocked = queue.activeDeviceCount()
  if (activeDeviceKeysWhileBlocked !== 1) throw new Error('unbounded queue did not expose exactly one active key while blocked')
  releaseGate()
  await Promise.all(queued)
  const completedOperations = queued.length
  queued = []
  const postDrainActiveDeviceCount = queue.activeDeviceCount()
  const seeded = seededFakePort(FakeBlePort)
  await seeded.port.connect(seeded.deviceId)
  let deliveries = 0
  const remove = await seeded.port.monitorCharacteristic(seeded.deviceId, seeded.serviceUuid, seeded.characteristicUuid, () => { deliveries += 1 })
  await seeded.port.emitNotification(seeded.deviceId, seeded.serviceUuid, seeded.characteristicUuid, makePayload(20, 3))
  await remove()
  const beforePostUnsubscribe = deliveries
  await seeded.port.emitNotification(seeded.deviceId, seeded.serviceUuid, seeded.characteristicUuid, makePayload(20, 4))
  return { postDrainActiveDeviceCount, postUnsubscribeNotifications: deliveries - beforePostUnsubscribe, safeUnboundedQueue: { configuredCapacity: null, submittedOperations, completedOperations, activeDeviceKeysWhileBlocked } }
}

function childResult(value) {
  process.stdout.write(`UB4_PERF_CHILD_RESULT=${JSON.stringify(value)}\n`)
}

async function runMemoryChild() {
  if (typeof global.gc !== 'function') throw new Error('memory child requires node --expose-gc')
  const { FakeBlePort } = loadedModules().blePort
  const { DeviceOperationQueue } = loadedModules().deviceQueue
  global.gc()
  const beforeHeapUsed = process.memoryUsage().heapUsed
  const resource = await exerciseResources(FakeBlePort, DeviceOperationQueue)
  await nextTurn()
  global.gc()
  const afterHeapUsed = process.memoryUsage().heapUsed
  const heapDeltaBytes = afterHeapUsed - beforeHeapUsed
  return { beforeHeapUsed, afterHeapUsed, heapDeltaBytes, retainedHeapBytes: Math.max(0, heapDeltaBytes), ...resource }
}

function sanitizeNativeBlocker() {
  return 'node-napi-corebluetooth-unavailable'
}

function runNativeChild() {
  const startedAt = nowNs()
  try {
    const coreBluetooth = require(path.join(REPOSITORY_ROOT, 'native/electron/corebluetooth'))
    if (!coreBluetooth.tryLoadNative()) return { status: 'blocked', loadNs: null, createNs: null, blocker: sanitizeNativeBlocker() }
    const loadNs = elapsedNs(startedAt)
    const createStartedAt = nowNs()
    const port = coreBluetooth.createPort()
    const createNs = elapsedNs(createStartedAt)
    if (!port || typeof port.destroy !== 'function') throw new Error('invalid node napi port')
    port.destroy()
    return { status: 'passed', loadNs, createNs, blocker: null }
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return { status: 'blocked', loadNs: null, createNs: null, blocker: sanitizeNativeBlocker() }
  }
}

function extractChildResult(output, mode) {
  const resultLine = output.split(/\r?\n/).find(line => line.startsWith('UB4_PERF_CHILD_RESULT='))
  if (!resultLine) throw new Error(`${mode} child emitted no structured result`)
  return JSON.parse(resultLine.slice('UB4_PERF_CHILD_RESULT='.length))
}

function runChild(mode) {
  const child = spawnSync(process.execPath, ['--expose-gc', __filename, mode], { cwd: REPOSITORY_ROOT, encoding: 'utf8', timeout: 120000 })
  if (child.error || child.status !== 0) throw new Error(`${mode} child failed: ${child.error?.message ?? child.stderr}`)
  return extractChildResult(child.stdout, mode)
}

function captureResources() {
  const resourceSamples = []
  for (let index = 0; index < ISOLATED_RESOURCE_SAMPLES; index += 1) resourceSamples.push(runChild('--memory-child'))
  return { id: 'memory-and-resource-isolation', classification: 'deterministic-microbenchmark', status: 'passed', method: 'Fresh --expose-gc child processes release promise arrays and local ports before final GC. Only public queue and post-unsubscribe counters are observable; unsupported resource counters remain a blocked budget dimension.', resourceSamples }
}

function createIpcClient() {
  const child = fork(__filename, ['--ipc-child'], { cwd: REPOSITORY_ROOT, serialization: 'advanced', stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
  const pending = new Map()
  let nextId = 1
  child.on('message', message => {
    if (!message || typeof message !== 'object' || !Number.isInteger(message.id)) {
      const error = new Error('IPC child returned an invalid response')
      for (const request of pending.values()) request.reject(error)
      pending.clear()
      return
    }
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error))
    else request.resolve(message.payload)
  })
  child.on('error', error => {
    for (const request of pending.values()) request.reject(error)
    pending.clear()
  })
  return {
    send(payload) {
      return new Promise((resolve, reject) => {
        const id = nextId
        nextId += 1
        pending.set(id, { resolve, reject })
        child.send({ id, payload }, error => {
          if (!error) return
          const request = pending.get(id)
          if (request) {
            pending.delete(id)
            request.reject(error)
          }
        })
      })
    },
    async close() {
      if (pending.size !== 0) throw new Error('IPC close with pending requests')
      child.disconnect()
      await new Promise((resolve, reject) => child.once('exit', (code, signal) => code === 0 && signal === null ? resolve() : reject(new Error(`IPC child exit ${code}/${signal}`))))
    }
  }
}

async function captureIpc() {
  const client = createIpcClient()
  try {
    const descriptors = []
    for (const byteLength of [20, 512, 65536]) {
      const bytes = Buffer.from(makePayload(byteLength, 13))
      for (const [kind, payload] of [['uint8array', bytes], ['base64', Buffer.from(bytes.toString('base64'), 'ascii')]]) {
        const wirePayload = kind === 'base64' ? payload.toString('ascii') : new Uint8Array(payload)
        descriptors.push({ id: `node-advanced-ipc-${kind}-${byteLength}`, iterationsPerSample: iterationsFor(byteLength, 2048, 1), integrity: integrity(payload, payload), run: async () => {
          const response = await client.send(wirePayload)
          const received = typeof response === 'string' ? Buffer.from(response, 'ascii') : Buffer.from(response)
          assertBytesEqual(received, payload, `IPC ${kind}/${byteLength}`)
          return consumeBytes(received)
        } })
      }
    }
    const operations = await measureAsyncSuite(descriptors, SAMPLING_SEED + 3)
    return { id: 'ipc-equivalent-serialization', classification: 'mock-system-abi', status: 'passed', method: 'Node child_process advanced serialization full-payload echo. This is a Node IPC proxy only, not Electron IPC or React Native TurboModule transport.', operations }
  } finally {
    await client.close()
  }
}

function captureNodeNapi() {
  const childSamples = []
  for (let index = 0; index < SAMPLE_COUNT; index += 1) childSamples.push(runChild('--native-child'))
  const blocked = childSamples.find(sample => sample.status === 'blocked')
  if (blocked) return { id: 'node-napi-corebluetooth-load-startup', classification: 'mock-system-abi', status: 'blocked', runtime: 'node-napi', method: 'Fresh Node N-API probe; no Electron ABI, renderer IPC, scan, connection, or radio traffic.', operations: [], childSamples, blocker: blocked.blocker }
  const operation = (id, samples) => ({ id, warmupBatches: 0, iterationsPerSample: 1, samplesNsPerOperation: samples, statistics: calculateStatistics(samples), integrity: null })
  return { id: 'node-napi-corebluetooth-load-startup', classification: 'mock-system-abi', status: 'passed', runtime: 'node-napi', method: 'Fresh Node processes require the N-API addon and create/destroy a port without radio traffic. Electron ABI and renderer IPC are separately blocked.', operations: [operation('fresh-process-addon-load', childSamples.map(sample => sample.loadNs)), operation('fresh-process-port-create-destroy', childSamples.map(sample => sample.createNs))], childSamples, blocker: null }
}

function fingerprintPath(relativePath) {
  const absolutePath = path.join(REPOSITORY_ROOT, relativePath)
  if (!fs.existsSync(absolutePath)) throw new Error(`missing ${relativePath}`)
  const stat = fs.lstatSync(absolutePath)
  if (stat.isFile()) {
    const bytes = fs.readFileSync(absolutePath)
    return { bytes: bytes.length, sha256: sha256(bytes) }
  }
  if (!stat.isDirectory()) throw new Error(`unsupported artifact ${relativePath}`)
  const digest = crypto.createHash('sha256')
  let totalBytes = 0
  for (const entry of fs.readdirSync(absolutePath, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() && !entry.isDirectory()) continue
    const child = fingerprintPath(path.join(relativePath, entry.name))
    totalBytes += child.bytes
    digest.update(`${entry.name}\0${child.bytes}\0${child.sha256}\0`)
  }
  return { bytes: totalBytes, sha256: digest.digest('hex') }
}

function captureArtifacts() {
  const available = [
    ['package-manifest', 'package.json'], ['lib-commonjs', 'lib/commonjs'], ['lib-module', 'lib/module'], ['lib-typescript', 'lib/typescript'], ['plugin-build', 'plugin/build'], ['corebluetooth-native-addon', 'native/electron/corebluetooth/build/Release/unified_ble_corebluetooth.node']
  ].map(([id, relativePath]) => ({ id, status: 'passed', fingerprint: fingerprintPath(relativePath), blocker: null }))
  available.push({ id: 'package-tarball', status: 'blocked', fingerprint: null, blocker: 'No retained immutable tarball exists for this capture.' })
  return { id: 'artifact-and-build-size', classification: 'deterministic-microbenchmark', status: 'passed', method: 'Recursive deterministic artifact fingerprints. Package tarball, browser JS bundle, and non-macOS host artifacts remain blocked.', artifacts: available }
}

function filteredStatus(rawStatus, excludedArtifactPaths) {
  const excluded = new Set(excludedArtifactPaths)
  const entries = rawStatus.toString('utf8').split('\0')
  const retained = []
  for (let index = 0; index < entries.length - 1; index += 1) {
    const entry = entries[index]
    const status = entry.slice(0, 2)
    const entryPath = entry.slice(3)
    const hasRenameOrigin = status.includes('R') || status.includes('C')
    const originPath = hasRenameOrigin ? entries[index + 1] : null
    const isExcluded = excluded.has(entryPath) || (originPath !== null && excluded.has(originPath))
    if (!isExcluded) {
      retained.push(entry)
      if (originPath !== null) retained.push(originPath)
    }
    if (originPath !== null) index += 1
  }
  return Buffer.from(retained.length === 0 ? '' : `${retained.join('\0')}\0`)
}

function sourceState(excludedArtifactPaths) {
  const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPOSITORY_ROOT, encoding: 'utf8' })
  const status = spawnSync('git', ['status', '--porcelain=v1', '-z'], { cwd: REPOSITORY_ROOT, encoding: 'buffer' })
  if (commit.status !== 0 || status.status !== 0) throw new Error('Unable to capture source state')
  const raw = filteredStatus(status.stdout, excludedArtifactPaths)
  return { commit: commit.stdout.trim(), dirty: { isDirty: raw.length > 0, changedPathCount: raw.length === 0 ? 0 : raw.toString('utf8').split('\0').filter(Boolean).length, statusNulSha256: sha256(raw) } }
}

function buildProvenance(before) {
  const modules = MEASURED_BUILD_MODULES.map(relativePath => ({ path: relativePath, before: before.get(relativePath), after: fingerprintPath(relativePath) }))
  const stable = modules.every(module => module.before.bytes === module.after.bytes && module.before.sha256 === module.after.sha256)
  if (!stable) throw new Error('Measured build output changed during capture')
  return { status: 'blocked', blocker: 'This capture fingerprints stable prebuilt outputs but has no isolated source-to-output build receipt; build-dependent release budgets remain blocked.', modules }
}

function blockedBudget(id, evidenceMeasurementIds, blocker) {
  return { id, status: 'blocked', evidenceMeasurementIds, threshold: null, blocker }
}

function budgetDimensions() {
  const dimensions = [
    blockedBudget('bridge-ipc-copies-and-expansion', ['codec-base64-and-byte-copy', 'ipc-equivalent-serialization'], 'No RN binary bridge or isolated build receipt was captured.'),
    blockedBudget('scan-result-throughput', ['notification-dispatch-mock'], 'No controlled scan source, event rate, or physical radio was available.'),
    blockedBudget('notification-delivery-throughput', ['notification-dispatch-mock'], 'The fake single-event latency probe does not establish controlled notification throughput.'),
    blockedBudget('core-scheduling-overhead-and-operation-latency', ['port-queue-latency-and-concurrency'], 'This dirty local reference has not completed repeated clean-environment captures.'),
    blockedBudget('memory-per-manager-connection-attribute-subscription', ['memory-and-resource-isolation'], 'Current public transitional paths expose no complete resource counters.'),
    blockedBudget('queue-capacity-and-worst-retained-bytes', ['memory-and-resource-isolation'], 'The current queue is unbounded and no defensible retained-byte ceiling exists.'),
    blockedBudget('idle-cpu-wakeups', ['memory-and-resource-isolation'], 'No idle CPU or wakeup profiler capture was performed.'),
    blockedBudget('connect-discovery-time', ['node-napi-corebluetooth-load-startup'], 'No physical device session removed device-imposed delay.'),
    blockedBudget('sustained-write-and-notification-throughput', ['notification-dispatch-mock', 'port-queue-latency-and-concurrency'], 'No controlled sustained peripheral script or physical radio was available.'),
    blockedBudget('teardown-and-postdestroy-live-resources', ['memory-and-resource-isolation', 'port-queue-latency-and-concurrency'], 'Only public queue and post-unsubscribe counters are observable in the transitional fake path.'),
    blockedBudget('package-js-and-native-artifact-size', ['artifact-and-build-size'], 'No retained package tarball, browser bundle, or all-host release artifacts were captured.')
  ]
  if (JSON.stringify(dimensions.map(dimension => dimension.id)) !== JSON.stringify(BUDGET_DIMENSIONS)) throw new Error('Budget dimension registry drifted from contract')
  return dimensions
}

function commandOutput(command, args) {
  const result = spawnSync(command, args, { cwd: REPOSITORY_ROOT, encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : 'unavailable'
}

async function capture(outputPath) {
  const relativeResultPath = path.relative(REPOSITORY_ROOT, outputPath)
  const relativeReceiptPath = relativeResultPath.replace(/\.json$/, '.receipt.json')
  if (!relativeResultPath.startsWith('benchmarks/results/') || relativeReceiptPath === relativeResultPath) throw new Error('Result output must remain under benchmarks/results and use a .json extension')
  const excludedArtifactPaths = [relativeResultPath, relativeReceiptPath]
  const sourceBefore = sourceState(excludedArtifactPaths)
  const modulesBefore = new Map(MEASURED_BUILD_MODULES.map(relativePath => [relativePath, fingerprintPath(relativePath)]))
  const codec = captureCodec()
  const notifications = await captureNotificationDispatch()
  const queue = await capturePortQueue()
  const resources = captureResources()
  const ipc = await captureIpc()
  const nodeNapi = captureNodeNapi()
  const artifacts = captureArtifacts()
  const measurements = [codec, notifications, queue, resources, ipc, nodeNapi, artifacts]
  const sourceAfter = sourceState(excludedArtifactPaths)
  const result = {
    schemaVersion: 'ub4-perf-baseline/v1',
    generatedAt: new Date().toISOString(),
    capture: { command: 'node --expose-gc benchmarks/scripts/ub4-perf-baseline.js --output <result.json>', warmupBatches: WARMUP_BATCHES, sampleCount: SAMPLE_COUNT, samplingSeed: SAMPLING_SEED, isolatedChildSamples: ISOLATED_RESOURCE_SAMPLES, excludedArtifactPaths },
    sourceWindow: { before: sourceBefore, after: sourceAfter, stable: JSON.stringify(sourceBefore) === JSON.stringify(sourceAfter) },
    environment: { platform: process.platform, architecture: process.arch, node: process.version, v8: process.versions.v8, osRelease: os.release(), cpuModel: os.cpus()[0]?.model ?? 'unavailable', logicalCpuCount: os.cpus().length, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'unavailable', xcode: commandOutput('xcodebuild', ['-version']), macos: commandOutput('sw_vers', ['-productVersion']) },
    proofBoundary: {
      level: 'L1-deterministic-and-L3-node-napi-only',
      physicalRadio: { status: 'blocked', blocker: 'No scan, connect, discovery, subscription, or write against a physical BLE controller/device occurred.' },
      electronAbi: { status: 'blocked', blocker: 'The fresh-process probe uses the Node N-API ABI only; it does not run the addon under Electron.' },
      electronRendererIpc: { status: 'blocked', blocker: 'Node child_process serialization is not Electron main-to-renderer IPC.' }
    },
    methodology: { clock: 'process.hrtime.bigint monotonic nanoseconds normalized per operation.', warmup: 'Ten full randomized warmup batches per operation before timed sampling.', sampling: 'Thirty-one raw samples per operation; Node N-API uses thirty-one fresh child processes and resources use seven GC-isolated child processes.', interleaving: 'A deterministic seeded permutation interleaves operation batches to reduce fixed-order cache and scheduler bias.', estimator: 'Nearest-rank p50/p95/p99 over 31 samples; p95 is the 30th ordered sample, not the maximum.', confidence: 'Dirty-machine local characterization only. No numeric release budget freezes until repeated clean-environment capture series are retained.', isolation: 'Resource and Node N-API probes use fresh child processes; IPC uses a dedicated advanced-serialization child process.', scope: 'No RN binary bridge, zero-copy claim, Electron ABI/renderer IPC, physical radio, or package-release proof.' },
    buildProvenance: buildProvenance(modulesBefore),
    measurements,
    budgetDimensions: budgetDimensions(),
    limitations: ['RN 0.86 TurboModule binary typed-array transport, ownership, Hermes, Android, Apple, Expo CNG, and classic RN were not measured.', 'Node IPC echo is not Electron renderer IPC.', 'The current queue is unbounded; resource values are descriptive only and no retained-heap cap is frozen.', 'No retained package tarball, browser bundle, all-host artifacts, or physical-radio session was captured.']
  }
  validateResult(result)
  return result
}

function receiptFor(resultPath, resultBytes, result) {
  const relativePath = path.relative(REPOSITORY_ROOT, resultPath)
  if (!relativePath.startsWith('benchmarks/results/')) throw new Error('Result output must remain under benchmarks/results')
  return { schemaVersion: 'ub4-perf-baseline-receipt/v1', resultPath: relativePath, resultSha256: sha256(resultBytes), capturedAt: result.generatedAt, sourceWindow: result.sourceWindow, buildProvenance: result.buildProvenance }
}

async function runIpcChild() {
  process.on('message', message => {
    if (!message || typeof message !== 'object' || !Number.isInteger(message.id)) return
    try {
      const payload = message.payload
      if (typeof payload !== 'string' && !(payload instanceof Uint8Array)) throw new Error('invalid IPC payload')
      process.send({ id: message.id, payload })
    } catch (error) {
      if (!(error instanceof Error)) throw error
      process.send({ id: message.id, error: 'ipc-echo-failed' })
    }
  })
}

async function main() {
  if (process.argv.includes('--memory-child')) return childResult(await runMemoryChild())
  if (process.argv.includes('--native-child')) return childResult(runNativeChild())
  if (process.argv.includes('--ipc-child')) return runIpcChild()
  const outputIndex = process.argv.indexOf('--output')
  if (outputIndex < 0 || !process.argv[outputIndex + 1]) throw new Error('Usage: node --expose-gc benchmarks/scripts/ub4-perf-baseline.js --output benchmarks/results/<name>.json')
  const outputPath = path.resolve(REPOSITORY_ROOT, process.argv[outputIndex + 1])
  const result = await capture(outputPath)
  const resultBytes = `${JSON.stringify(result, null, 2)}\n`
  const receiptPath = outputPath.replace(/\.json$/, '.receipt.json')
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, resultBytes)
  fs.writeFileSync(receiptPath, `${JSON.stringify(receiptFor(outputPath, resultBytes, result), null, 2)}\n`)
  process.stdout.write(`Captured UB4 Phase 0 baseline at ${outputPath}\n`)
}

main().catch(error => {
  process.stderr.write(`UB4 Phase 0 capture failed: ${error instanceof Error ? error.stack : String(error)}\n`)
  process.exitCode = 1
})
