/**
 * Shared async / fake-timer flush helpers for package suites (F087 / R2-F077).
 * Prefer jest.useFakeTimers + these helpers over real-timer flush hacks like:
 *   await new Promise(r => setTimeout(r, 5|10|15|20|25|30))
 *   const flush = () => new Promise(r => setTimeout(r, 0))
 *
 * Uses Jest's async timer APIs so promise chains scheduled from timer callbacks
 * (queue holds, FakeBlePort scan setTimeout(0), findAndConnect timeouts) settle.
 * Hold-open patterns may still call setTimeout under active fake timers; always
 * pair with advanceTimers / runOnlyPendingTimers rather than wall-clock waits.
 *
 * Suites that previously used ad-hoc setTimeout flushes (BlePort.fake, CentralDemo,
 * WebHost, Benchmark) must import flushScan / flushMicrotasks / delay from here.
 */

/**
 * Install fake timers (modern). Call from beforeEach; pair with afterEach(useRealTimers).
 */
function useFakeTimers() {
  jest.useFakeTimers({ advanceTimers: false })
}

function useRealTimers() {
  jest.useRealTimers()
}

/**
 * Flush microtasks only (no timer advance).
 */
async function flushMicrotasks(times = 4) {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve()
  }
}

/**
 * Advance fake timers by ms and flush promise chains from timer callbacks.
 * Requires jest.useFakeTimers() to be active.
 */
async function advanceTimers(ms = 0) {
  if (typeof jest.advanceTimersByTimeAsync === 'function') {
    await jest.advanceTimersByTimeAsync(ms)
  } else {
    jest.advanceTimersByTime(ms)
  }
  // DeviceOperationQueue chains: run → finally/release → tail → next run → timer
  await flushMicrotasks(8)
}

/**
 * Run only pending timers (one wave) + microtasks.
 */
async function runOnlyPendingTimers() {
  if (typeof jest.runOnlyPendingTimersAsync === 'function') {
    await jest.runOnlyPendingTimersAsync()
  } else {
    jest.runOnlyPendingTimers()
  }
  await flushMicrotasks()
}

/**
 * Flush a FakeBlePort-style scan timer (setTimeout 0) under fake timers.
 * Callers should flush microtasks first if startScan was just kicked off so
 * scanActive is set before the ad timer fires (PortBleManager F094 ordering).
 */
async function flushScan() {
  await flushMicrotasks()
  await advanceTimers(0)
  await flushMicrotasks()
}

/**
 * Hold an async op open for `ms` under fake timers (caller must advanceTimers).
 * Prefer this over ad-hoc `new Promise(r => setTimeout(r, ms))` so suites share one API.
 * Works under both fake and real timers (setTimeout is faked when useFakeTimers is active).
 */
function delay(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

/**
 * Advance timers in equal steps until `pending` settles (or maxSteps exhausted).
 * Useful for serial queue holds of fixed duration under fake timers.
 */
async function advanceUntilSettled(pending, stepMs, maxSteps = 20) {
  let settled = false
  const tracked = Promise.resolve(pending).finally(() => {
    settled = true
  })
  for (let i = 0; i < maxSteps && !settled; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await advanceTimers(stepMs)
  }
  return tracked
}

module.exports = {
  useFakeTimers,
  useRealTimers,
  flushMicrotasks,
  advanceTimers,
  runOnlyPendingTimers,
  flushScan,
  delay,
  advanceUntilSettled
}
