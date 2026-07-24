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
  // iOS mid-connect: cancel rejects (never connected, no disconnect).
  // 'resolve' models Android dispose success where DISCONNECTED may still follow.
  let cancelMidConnectOutcome = 'reject';

  const cancelledError = (deviceId) =>
    new BleError(
      {
        errorCode: BleErrorCode.OperationCancelled,
        attErrorCode: null,
        iosErrorCode: null,
        androidErrorCode: null,
        reason: `Cancelled ${deviceId}`,
      },
      BleErrorCodeMessage
    );

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
        d.reject(cancelledError(deviceId));
        pending.delete(deviceId);
        if (cancelMidConnectOutcome === 'resolve') {
          return Promise.resolve();
        }
        return Promise.reject(cancelledError(deviceId));
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
    /** @param {'reject' | 'resolve'} outcome */
    _setCancelMidConnectOutcome: (outcome) => {
      cancelMidConnectOutcome = outcome;
    },
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
    await flushMicrotasks();
    // Do not call destroy() here: it rejects in-flight connects (correct for production)
    // and Jest treats unawaited rejections as fatal. beforeEach builds a fresh manager.
    // Tests that need destroy must await the resulting promise rejections themselves.
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

  test('auto-reconnect partial updates preserve previously configured reconnect options', async () => {
    mgr.enableAutoReconnect('d1', {
      maxRetries: 1,
      initialDelayMs: 0,
      timeoutMs: 0,
      connectionOptions: { autoConnect: true },
    });

    mgr.enableAutoReconnect('d1', { maxRetries: 2 });

    ble._simulateDisconnect('d1', createBleError(BleErrorCode.DeviceDisconnected, 'background disconnect'));
    jest.runOnlyPendingTimers();
    await flushMicrotasks();

    expect(ble.connectToDevice).toHaveBeenCalledWith('d1', { autoConnect: true });

    const reconnect = ble._connectCalls[ble._connectCalls.length - 1];
    reconnect.deferred.reject(createBleError(BleErrorCode.DeviceDisconnected, 'cleanup'));
    await flushMicrotasks().catch(() => {});
  });

  test('auto-reconnect updates apply to an already scheduled retry', async () => {
    mgr.enableAutoReconnect('d1', { maxRetries: 2, initialDelayMs: 1000, timeoutMs: 0 });

    ble._simulateDisconnect('d1', createBleError(BleErrorCode.DeviceDisconnected, 'background disconnect'));

    mgr.enableAutoReconnect('d1', {
      maxRetries: 1,
      initialDelayMs: 1000,
      timeoutMs: 0,
      connectionOptions: { autoConnect: true },
    });

    jest.advanceTimersByTime(1000);
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

  describe('attemptConnectOnce (externally gated)', () => {
    test('single native connect; no retry timer after failure even if maxRetries>1 passed', async () => {
      const p = mgr.attemptConnectOnce('d1', { maxRetries: 5, timeoutMs: 0, initialDelayMs: 1000 });
      expect(ble.connectToDevice).toHaveBeenCalledTimes(1);
      ble._rejectConnect('d1', createBleError(BleErrorCode.DeviceDisconnected, 'fail'));
      await expect(p).rejects.toMatchObject({ errorCode: BleErrorCode.DeviceDisconnected });
      jest.advanceTimersByTime(10000);
      await flushMicrotasks();
      expect(ble.connectToDevice).toHaveBeenCalledTimes(1);
    });

    test('coalesces concurrent attemptConnectOnce', async () => {
      const p1 = mgr.attemptConnectOnce('d1', { timeoutMs: 0 });
      const p2 = mgr.attemptConnectOnce('d1', { timeoutMs: 0 });
      expect(ble.connectToDevice).toHaveBeenCalledTimes(1);
      ble._resolveConnect('d1', createDevice('d1'));
      await expect(p1).resolves.toMatchObject({ id: 'd1' });
      await expect(p2).resolves.toMatchObject({ id: 'd1' });
    });

    test('rejects when non-gated connect is already in flight (strict coalesce)', async () => {
      const pConnect = mgr.connect('d1', { maxRetries: 3, timeoutMs: 0 });
      await expect(mgr.attemptConnectOnce('d1', { timeoutMs: 0 })).rejects.toMatchObject({
        errorCode: BleErrorCode.OperationStartFailed,
        reason: expect.stringMatching(/non-gated|in-flight/i),
      });
      expect(ble.connectToDevice).toHaveBeenCalledTimes(1);
      ble._resolveConnect('d1', createDevice('d1'));
      await expect(pConnect).resolves.toMatchObject({ id: 'd1' });
    });

    test('connect coalesces onto in-flight gated attempt', async () => {
      const pGated = mgr.attemptConnectOnce('d1', { timeoutMs: 0 });
      const pConnect = mgr.connect('d1', { maxRetries: 5, timeoutMs: 0 });
      expect(ble.connectToDevice).toHaveBeenCalledTimes(1);
      ble._resolveConnect('d1', createDevice('d1'));
      await expect(pGated).resolves.toMatchObject({ id: 'd1' });
      await expect(pConnect).resolves.toMatchObject({ id: 'd1' });
    });

    test('rejects when auto-reconnect is enabled', async () => {
      mgr.enableAutoReconnect('d1', { maxRetries: 1, timeoutMs: 0 });
      await expect(mgr.attemptConnectOnce('d1', { timeoutMs: 0 })).rejects.toMatchObject({
        errorCode: BleErrorCode.OperationStartFailed,
        reason: expect.stringMatching(/auto-reconnect/i),
      });
      expect(ble.connectToDevice).not.toHaveBeenCalled();
    });

    test('enableAutoReconnect throws while gated attempt is in flight', async () => {
      const p = mgr.attemptConnectOnce('d1', { timeoutMs: 0 });
      try {
        mgr.enableAutoReconnect('d1');
        throw new Error('expected enableAutoReconnect to throw');
      } catch (e) {
        expect(e).toBeInstanceOf(BleError);
        expect(e.errorCode).toBe(BleErrorCode.OperationStartFailed);
        expect(e.reason).toMatch(/attemptConnectOnce|gated/i);
      }
      ble._resolveConnect('d1', createDevice('d1'));
      await expect(p).resolves.toMatchObject({ id: 'd1' });
    });

    test('enableAutoReconnect still throws if connect joined a gated flight', async () => {
      const pGated = mgr.attemptConnectOnce('d1', { timeoutMs: 0 });
      const pConnect = mgr.connect('d1', { timeoutMs: 0 });
      try {
        mgr.enableAutoReconnect('d1');
        throw new Error('expected enableAutoReconnect to throw');
      } catch (e) {
        expect(e).toBeInstanceOf(BleError);
        expect(e.errorCode).toBe(BleErrorCode.OperationStartFailed);
        expect(e.reason).toMatch(/attemptConnectOnce|gated/i);
      }
      ble._resolveConnect('d1', createDevice('d1'));
      await pGated;
      await pConnect;
    });

    test('cancel mid-attempt: OperationCancelled, no retry', async () => {
      const p = mgr.attemptConnectOnce('d1', { timeoutMs: 0 });
      expect(mgr.cancel('d1')).toBe(true);
      await expect(p).rejects.toMatchObject({ errorCode: BleErrorCode.OperationCancelled });
      jest.advanceTimersByTime(5000);
      await flushMicrotasks();
      expect(ble.connectToDevice).toHaveBeenCalledTimes(1);
    });

    test('timeout: OperationTimedOut', async () => {
      const p = mgr.attemptConnectOnce('d1', { timeoutMs: 100 });
      jest.advanceTimersByTime(120);
      await flushMicrotasks();
      await expect(p).rejects.toMatchObject({ errorCode: BleErrorCode.OperationTimedOut });
      expect(ble.cancelDeviceConnection).toHaveBeenCalledWith('d1');
    });

    test('callback order: onConnecting then onConnect', async () => {
      const order = [];
      mgr.setGlobalCallbacks({
        onConnecting: () => order.push('connecting'),
        onConnect: () => order.push('connect'),
      });
      const p = mgr.attemptConnectOnce('d1', { timeoutMs: 0 });
      ble._resolveConnect('d1', createDevice('d1'));
      await p;
      expect(order).toEqual(['connecting', 'connect']);
    });

    test('callback order: onConnecting then onConnectFailed', async () => {
      const order = [];
      mgr.setGlobalCallbacks({
        onConnecting: () => order.push('connecting'),
        onConnectFailed: () => order.push('failed'),
      });
      const p = mgr.attemptConnectOnce('d1', { timeoutMs: 0 });
      ble._rejectConnect('d1', createBleError(BleErrorCode.DeviceDisconnected, 'fail'));
      await expect(p).rejects.toBeTruthy();
      expect(order).toEqual(['connecting', 'failed']);
    });

    test('after gated success: auto off, no onDeviceDisconnected registration', async () => {
      ble.onDeviceDisconnected.mockClear();
      const p = mgr.attemptConnectOnce('d1', { timeoutMs: 0 });
      expect(ble.onDeviceDisconnected).not.toHaveBeenCalled();
      ble._resolveConnect('d1', createDevice('d1'));
      await p;
      expect(mgr.isAutoReconnectEnabled('d1')).toBe(false);
      expect(ble.onDeviceDisconnected).not.toHaveBeenCalled();
    });

    test('after gated failure, enableAutoReconnect works', async () => {
      const p = mgr.attemptConnectOnce('d1', { timeoutMs: 0 });
      ble._rejectConnect('d1', createBleError(BleErrorCode.DeviceDisconnected, 'fail'));
      await expect(p).rejects.toBeTruthy();
      expect(() => mgr.enableAutoReconnect('d1', { maxRetries: 1, timeoutMs: 0 })).not.toThrow();
      expect(mgr.isAutoReconnectEnabled('d1')).toBe(true);
    });

    test('destroy settles in-flight attemptConnectOnce with OperationCancelled', async () => {
      const p = mgr.attemptConnectOnce('d1', { timeoutMs: 0 });
      mgr.destroy();
      await expect(p).rejects.toMatchObject({ errorCode: BleErrorCode.OperationCancelled });
    });

    test('destroy does not leave connects started from onConnectFailed', async () => {
      let reentryAttempted = false;
      mgr.setGlobalCallbacks({
        onConnectFailed: () => {
          // Reconnect-on-failure style handler — must not stick after destroy.
          reentryAttempted = true;
          void mgr.connect('d2', { timeoutMs: 0 }).catch(() => {});
        },
      });
      const p = mgr.connect('d1', { timeoutMs: 0 });
      mgr.destroy();
      await expect(p).rejects.toMatchObject({ errorCode: BleErrorCode.OperationCancelled });
      expect(reentryAttempted).toBe(false);
      expect(mgr.activeCount).toBe(0);
      // Direct connect after destroy is rejected (manager is dead).
      await expect(mgr.connect('d3', { timeoutMs: 0 })).rejects.toMatchObject({
        errorCode: BleErrorCode.OperationCancelled,
      });
    });

    test('enableAutoReconnect throws after destroy', async () => {
      const p = mgr.connect('d1', { timeoutMs: 0 });
      mgr.destroy();
      await expect(p).rejects.toMatchObject({ errorCode: BleErrorCode.OperationCancelled });
      expect(() => mgr.enableAutoReconnect('d1', { maxRetries: 1, timeoutMs: 0 })).toThrow(
        expect.objectContaining({ errorCode: BleErrorCode.OperationCancelled })
      );
      expect(mgr.isAutoReconnectEnabled('d1')).toBe(false);
    });

    test('onConnect may enableAutoReconnect after gated native success', async () => {
      mgr.setGlobalCallbacks({
        onConnect: device => {
          mgr.enableAutoReconnect(device.id, { maxRetries: 1, timeoutMs: 0 });
        },
      });
      const p = mgr.attemptConnectOnce('d1', { timeoutMs: 0 });
      ble._resolveConnect('d1', createDevice('d1'));
      await expect(p).resolves.toMatchObject({ id: 'd1' });
      expect(mgr.isAutoReconnectEnabled('d1')).toBe(true);
    });
  });

  test('cancel mid-connect with auto-reconnect does not start reconnect by itself', async () => {
    mgr.enableAutoReconnect('d1', { maxRetries: 1, initialDelayMs: 0, timeoutMs: 0 });
    const p = mgr.connect('d1', { timeoutMs: 0 });
    ble.connectToDevice.mockClear();
    mgr.cancel('d1');
    await expect(p).rejects.toMatchObject({ errorCode: BleErrorCode.OperationCancelled });
    expect(mgr.isConnecting('d1')).toBe(false);
    // iOS mid-connect: cancel rejects, no disconnect event — must not auto-reconnect.
    await flushMicrotasks();
    expect(ble.connectToDevice).not.toHaveBeenCalled();
  });

  test('replace in-flight auto connect inherits suppress when cancel will emit disconnect', async () => {
    // Android-like: cancel resolves and a DISCONNECTED event still follows.
    ble._setCancelMidConnectOutcome('resolve');
    // Auto-reconnect path has no pendingPromise, so explicit connect() replaces (not coalesces).
    mgr.enableAutoReconnect('d1', { maxRetries: 1, initialDelayMs: 0, timeoutMs: 0 });
    ble._simulateDisconnect('d1', createBleError(BleErrorCode.DeviceDisconnected, 'drop'));
    await flushMicrotasks();
    expect(ble.connectToDevice).toHaveBeenCalledTimes(1);

    const p2 = mgr.connect('d1', { maxRetries: 1, timeoutMs: 0 });
    expect(ble.connectToDevice).toHaveBeenCalledTimes(2);
    // Replace cancelled the auto attempt → suppressNextAutoReconnect inherited by p2 state.
    await flushMicrotasks();

    ble.connectToDevice.mockClear();
    ble._simulateDisconnect('d1', createBleError(BleErrorCode.DeviceDisconnected, 'from-cancel-replace'));
    await flushMicrotasks();
    // Must not start a third native connect under auto.
    expect(ble.connectToDevice).not.toHaveBeenCalled();

    ble._resolveConnect('d1', createDevice('d1'));
    await expect(p2).resolves.toMatchObject({ id: 'd1' });
  });

  test('success does not clear suppress before late cancel-disconnect is consumed', async () => {
    ble._setCancelMidConnectOutcome('resolve');
    mgr.enableAutoReconnect('d1', { maxRetries: 1, initialDelayMs: 0, timeoutMs: 0 });
    ble._simulateDisconnect('d1', createBleError(BleErrorCode.DeviceDisconnected, 'drop'));
    await flushMicrotasks();
    const p2 = mgr.connect('d1', { maxRetries: 1, timeoutMs: 0 });
    // Succeed replacement BEFORE the cancel-disconnect is delivered
    ble._resolveConnect('d1', createDevice('d1'));
    await expect(p2).resolves.toMatchObject({ id: 'd1' });
    await flushMicrotasks();
    ble.connectToDevice.mockClear();
    // Late cancel-disconnect must still be suppressed (not re-arm auto on top of success)
    ble._simulateDisconnect('d1', createBleError(BleErrorCode.DeviceDisconnected, 'late-cancel'));
    await flushMicrotasks();
    expect(ble.connectToDevice).not.toHaveBeenCalled();
  });

  test('cancel reject clears orphan suppress so post-success disconnect re-arms', async () => {
    // iOS mid-connect default: cancel rejects → no disconnect → suppress must not stick.
    mgr.enableAutoReconnect('d1', { maxRetries: 1, initialDelayMs: 0, timeoutMs: 0 });
    ble._simulateDisconnect('d1', createBleError(BleErrorCode.DeviceDisconnected, 'drop'));
    await flushMicrotasks();
    const p2 = mgr.connect('d1', { maxRetries: 1, timeoutMs: 0 });
    await flushMicrotasks(); // cancel of auto attempt rejects → clear orphan suppress
    ble._resolveConnect('d1', createDevice('d1'));
    await expect(p2).resolves.toMatchObject({ id: 'd1' });
    ble.connectToDevice.mockClear();
    // Real disconnect after success must re-arm (not swallowed by orphan suppress / 2s window).
    ble._simulateDisconnect('d1', createBleError(BleErrorCode.DeviceDisconnected, 'real'));
    await flushMicrotasks();
    expect(ble.connectToDevice).toHaveBeenCalledTimes(1);
    if (ble._connectCalls.length > 0) {
      ble._connectCalls[ble._connectCalls.length - 1].deferred.reject(
        createBleError(BleErrorCode.DeviceDisconnected, 'cleanup')
      );
      await flushMicrotasks().catch(() => {});
    }
  });

  test('cancel of delay-0 scheduled auto reconnect does not fire native connect', async () => {
    mgr.enableAutoReconnect('d1', { maxRetries: 1, initialDelayMs: 0, timeoutMs: 0 });
    ble.connectToDevice.mockClear();
    ble._simulateDisconnect('d1', createBleError(BleErrorCode.DeviceDisconnected, 'drop'));
    // Microtask scheduled; cancel before it runs
    mgr.cancel('d1');
    await flushMicrotasks();
    expect(ble.connectToDevice).not.toHaveBeenCalled();
  });

  test('cancel mid-connect with auto-reconnect still allows later disconnect re-arm', async () => {
    mgr.enableAutoReconnect('d1', { maxRetries: 1, initialDelayMs: 0, timeoutMs: 0 });
    const p = mgr.connect('d1', { timeoutMs: 0 });
    mgr.cancel('d1');
    await expect(p).rejects.toMatchObject({ errorCode: BleErrorCode.OperationCancelled });
    expect(mgr.isConnecting('d1')).toBe(false);
    // Cancel rejected (never connected) → suppress already cleared; first disconnect re-arms.
    await flushMicrotasks();
    ble.connectToDevice.mockClear();

    ble._simulateDisconnect('d1', createBleError(BleErrorCode.DeviceDisconnected, 'later'));
    await flushMicrotasks();
    expect(ble.connectToDevice).toHaveBeenCalledTimes(1);
    if (ble._connectCalls.length > 0) {
      ble._connectCalls[ble._connectCalls.length - 1].deferred.reject(
        createBleError(BleErrorCode.DeviceDisconnected, 'cleanup')
      );
      await flushMicrotasks().catch(() => {});
    }
  });

  test('replace auto-reconnect in-flight: stale resolve must not cancel the newer connect', async () => {
    // Auto-reconnect starts _attemptConnection without pendingPromise → explicit connect replaces
    mgr.enableAutoReconnect('d1', { maxRetries: 1, initialDelayMs: 0, timeoutMs: 0 });
    ble._simulateDisconnect('d1', createBleError(BleErrorCode.DeviceDisconnected, 'drop'));
    await flushMicrotasks();
    expect(ble.connectToDevice).toHaveBeenCalledTimes(1);
    const staleDeferred = ble._connectCalls[0].deferred;

    const p2 = mgr.connect('d1', { maxRetries: 1, timeoutMs: 0 });
    expect(ble.connectToDevice).toHaveBeenCalledTimes(2);

    // Stale auto-reconnect deferred resolves after replace — must not cancel second attempt
    staleDeferred.resolve(createDevice('d1'));
    await flushMicrotasks();

    ble._resolveConnect('d1', createDevice('d1'));
    await expect(p2).resolves.toMatchObject({ id: 'd1' });
  });
});
