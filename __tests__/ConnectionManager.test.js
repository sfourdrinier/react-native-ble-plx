import { ConnectionManager } from '../src/ConnectionManager';
import { BleError, BleErrorCode, BleErrorCodeMessage } from '../src/BleError';

const createDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const createMockSubscription = () => ({ remove: jest.fn() });

const createMockBleManager = () => {
  const disconnectCallbacks = new Map();
  const subscriptions = new Map();
  const pending = new Map(); // deviceId -> deferred
  const connectCalls = [];

  return {
    connectToDevice: jest.fn((deviceId, options) => {
      const d = createDeferred();
      pending.set(deviceId, d);
      connectCalls.push({ deviceId, options, deferred: d });
      return d.promise;
    }),

    cancelDeviceConnection: jest.fn((deviceId) => {
      const d = pending.get(deviceId);
      if (d) {
        d.reject(
          new BleError(
            {
              errorCode: BleErrorCode.OperationCancelled,
              attErrorCode: null,
              iosErrorCode: null,
              androidErrorCode: null,
              reason: `Cancelled ${deviceId}`,
            },
            BleErrorCodeMessage
          )
        );
        pending.delete(deviceId);
      }
      return Promise.resolve();
    }),

    onDeviceDisconnected: jest.fn((deviceId, callback) => {
      disconnectCallbacks.set(deviceId, callback);
      const sub = createMockSubscription();
      subscriptions.set(deviceId, sub);
      return sub;
    }),

    _resolveConnect: (deviceId, device) => {
      const d = pending.get(deviceId);
      if (!d) throw new Error(`No pending connect for ${deviceId}`);
      d.resolve(device);
      pending.delete(deviceId);
    },

    _rejectConnect: (deviceId, err) => {
      const d = pending.get(deviceId);
      if (!d) throw new Error(`No pending connect for ${deviceId}`);
      d.reject(err);
      pending.delete(deviceId);
    },

    _simulateDisconnect: (deviceId, error) => {
      const cb = disconnectCallbacks.get(deviceId);
      if (cb) cb(error, { id: deviceId });
    },

    _getSubscription: (deviceId) => subscriptions.get(deviceId),
    _connectCalls: connectCalls,
  };
};

const createDevice = (id) => ({ id, name: 'Test', mtu: 23, rssi: -50 });

const createUnknownError = (msg) => new Error(msg);

const createBleError = (code, reason) =>
  new BleError(
    {
      errorCode: code,
      attErrorCode: null,
      iosErrorCode: null,
      androidErrorCode: null,
      reason,
    },
    BleErrorCodeMessage
  );

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('ConnectionManager', () => {
  let ble;
  let mgr;

  beforeEach(() => {
    jest.useFakeTimers();
    ble = createMockBleManager();
    mgr = new ConnectionManager(ble);
  });

  afterEach(async () => {
    // Flush any pending microtasks before cleanup
    await flushMicrotasks();

    // Destroy manager (cleanup without rejecting promises)
    if (mgr) {
      mgr.destroy();
    }

    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('BUG1: coalesces concurrent connect() calls into one native connect', async () => {
    const p1 = mgr.connect('d1');
    const p2 = mgr.connect('d1');

    expect(ble.connectToDevice).toHaveBeenCalledTimes(1);

    ble._resolveConnect('d1', createDevice('d1'));
    await expect(p1).resolves.toMatchObject({ id: 'd1' });
    await expect(p2).resolves.toMatchObject({ id: 'd1' });
  });

  test('BUG1: coalesced callers all reject together on failure', async () => {
    const p1 = mgr.connect('d1', { maxRetries: 1, timeoutMs: 0 });
    const p2 = mgr.connect('d1', { maxRetries: 1, timeoutMs: 0 });

    const err = createBleError(BleErrorCode.DeviceDisconnected, 'fail');
    ble._rejectConnect('d1', err);

    // Flush microtasks to let the rejection propagate through the promise chain
    await flushMicrotasks();

    await expect(p1).rejects.toMatchObject({ errorCode: BleErrorCode.DeviceDisconnected });
    await expect(p2).rejects.toMatchObject({ errorCode: BleErrorCode.DeviceDisconnected });
  });

  test('timeout rejects and cancels native connection', async () => {
    const p = mgr.connect('d1', { timeoutMs: 100, maxRetries: 1 });

    jest.advanceTimersByTime(120);
    await flushMicrotasks();

    await expect(p).rejects.toMatchObject({ errorCode: BleErrorCode.OperationTimedOut });
    expect(ble.cancelDeviceConnection).toHaveBeenCalledWith('d1');
  });

  test('BUG2: destroy() removes auto-reconnect disconnect subscription', () => {
    mgr.enableAutoReconnect('d1');
    const sub = ble._getSubscription('d1');
    expect(sub).toBeTruthy();

    mgr.destroy();
    expect(sub.remove).toHaveBeenCalledTimes(1);
  });

  test('BUG3: repeated disconnect events do not schedule multiple reconnection attempts', async () => {
    mgr.enableAutoReconnect('d1', { maxRetries: 1, timeoutMs: 0 });

    const disconnErr = createBleError(BleErrorCode.DeviceDisconnected, 'unexpected');
    ble._simulateDisconnect('d1', disconnErr);
    ble._simulateDisconnect('d1', disconnErr);
    ble._simulateDisconnect('d1', disconnErr);

    // reconnection is scheduled with delay 0 -> requires timer run
    jest.runOnlyPendingTimers();
    await flushMicrotasks();

    expect(ble.connectToDevice).toHaveBeenCalledTimes(1);

    // Clean up the pending connection attempt
    if (ble._connectCalls.length > 0) {
      ble._connectCalls[0].deferred.reject(createBleError(BleErrorCode.DeviceDisconnected, 'cleanup'));
      await flushMicrotasks().catch(() => {});
    }
  });

  test('normalizes unknown errors into BleError.UnknownError', async () => {
    const p = mgr.connect('d1', { maxRetries: 1, timeoutMs: 0 });

    ble._rejectConnect('d1', createUnknownError('boom'));
    await expect(p).rejects.toMatchObject({ errorCode: BleErrorCode.UnknownError });
  });

  test('cancel rejects pending promise', async () => {
    const p = mgr.connect('d1', { timeoutMs: 0 });
    const cancelled = mgr.cancel('d1');
    expect(cancelled).toBe(true);

    await expect(p).rejects.toMatchObject({ errorCode: BleErrorCode.OperationCancelled });
  });

  test('BUG4 regression check: cancel should NOT trigger retries for autoReconnect devices', async () => {
    mgr.enableAutoReconnect('d1', { maxRetries: 3, initialDelayMs: 1000, timeoutMs: 0 });

    // start an explicit connect; it is in-flight and will be cancelled
    const p = mgr.connect('d1', { maxRetries: 3, initialDelayMs: 1000, timeoutMs: 0 });

    mgr.cancel('d1');
    await expect(p).rejects.toMatchObject({ errorCode: BleErrorCode.OperationCancelled });

    // If cancel truly stops the attempt, there should be no retry timer that later calls connectToDevice again.
    jest.advanceTimersByTime(5000);
    await flushMicrotasks();

    // Expected for correct behavior: 1 connect attempt total.
    // With the attemptId fix, this should pass.
    expect(ble.connectToDevice).toHaveBeenCalledTimes(1);
  });

  test('auto-reconnect triggers on disconnect even when error is null (platform quirk handling)', async () => {
    mgr.enableAutoReconnect('d1', { maxRetries: 1, initialDelayMs: 0, timeoutMs: 0 });

    // Initial connection
    const p = mgr.connect('d1', { timeoutMs: 0 });
    ble._resolveConnect('d1', createDevice('d1'));
    await expect(p).resolves.toMatchObject({ id: 'd1' });

    // Reset call count
    ble.connectToDevice.mockClear();

    // Simulate disconnect with null error (some platforms do this)
    ble._simulateDisconnect('d1', null);

    // Auto-reconnect should still trigger
    jest.runOnlyPendingTimers();
    await flushMicrotasks();

    expect(ble.connectToDevice).toHaveBeenCalledTimes(1);

    // Clean up the pending reconnection attempt
    if (ble._connectCalls.length > 0) {
      ble._connectCalls[0].deferred.reject(createBleError(BleErrorCode.DeviceDisconnected, 'cleanup'));
      await flushMicrotasks().catch(() => {});
    }
  });

  test('auto-reconnect preserves reconnect-specific connection options after an explicit connect', async () => {
    mgr.enableAutoReconnect('d1', {
      maxRetries: 1,
      initialDelayMs: 0,
      timeoutMs: 0,
      connectionOptions: { autoConnect: true },
    });

    const p = mgr.connect('d1', { timeoutMs: 0 });
    ble._resolveConnect('d1', createDevice('d1'));
    await expect(p).resolves.toMatchObject({ id: 'd1' });

    ble.connectToDevice.mockClear();
    ble._simulateDisconnect('d1', createBleError(BleErrorCode.DeviceDisconnected, 'background disconnect'));
    jest.runOnlyPendingTimers();
    await flushMicrotasks();

    expect(ble.connectToDevice).toHaveBeenCalledWith('d1', { autoConnect: true });

    const reconnect = ble._connectCalls[ble._connectCalls.length - 1];
    reconnect.deferred.reject(createBleError(BleErrorCode.DeviceDisconnected, 'cleanup'));
    await flushMicrotasks().catch(() => {});
  });

  test('zero-delay auto-reconnect starts on a microtask without waiting for timers', async () => {
    mgr.enableAutoReconnect('d1', { maxRetries: 1, initialDelayMs: 0, timeoutMs: 0 });

    ble._simulateDisconnect('d1', createBleError(BleErrorCode.DeviceDisconnected, 'background disconnect'));
    await flushMicrotasks();

    expect(ble.connectToDevice).toHaveBeenCalledTimes(1);

    const reconnect = ble._connectCalls[ble._connectCalls.length - 1];
    reconnect.deferred.reject(createBleError(BleErrorCode.DeviceDisconnected, 'cleanup'));
    await flushMicrotasks().catch(() => {});
  });
});
