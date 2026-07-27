// spikes/rn-jsi-binary/fixtures/JsiBinaryRuntimeProbe.tsx

import React, { useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Ub4JsiBinaryBootstrap, {
  type BinaryHandshakeRequest,
  type BinaryHandshakeResult,
} from '../specs/NativeUb4JsiBinaryBootstrap'

declare const operationHandleBrand: unique symbol
declare const subscriptionHandleBrand: unique symbol

interface OperationHandle {
  readonly [operationHandleBrand]: never
}

interface SubscriptionHandle {
  readonly [subscriptionHandleBrand]: never
}

type BinaryNotification =
  | { kind: 'value'; payload: Uint8Array }
  | { kind: 'overflow'; dropped: number }

interface BinaryJsiProtocol {
  submit(payload: Uint8Array): OperationHandle
  submitArrayBuffer(payload: ArrayBuffer, byteOffset: number, byteLength: number): OperationHandle
  complete(operation: OperationHandle): Uint8Array
  completeArrayBuffer(operation: OperationHandle): ArrayBuffer
  subscribe(callback: (notification: BinaryNotification) => void): SubscriptionHandle
  unsubscribe(subscription: SubscriptionHandle): boolean
  cancel(operation: OperationHandle): boolean
}

declare global {
  var __ub4JsiBinaryV1: BinaryJsiProtocol | undefined
}

const v1Range = { minimum: 1, maximum: 1 }

const handshakeRequest: BinaryHandshakeRequest = {
  nativeProtocol: v1Range,
  abi: v1Range,
  backendContract: v1Range,
  capabilitySchema: v1Range,
  eventSchema: v1Range,
  traceFormat: v1Range,
  owner: 'ub4-phase0-example',
  backendGeneration: 1,
}

function getBinaryProtocol(): BinaryJsiProtocol {
  const protocol = globalThis.__ub4JsiBinaryV1
  if (!protocol) {
    throw new Error('The binary JSI data surface was not activated by the handshake')
  }
  return protocol
}

function assertHandshake(result: BinaryHandshakeResult): void {
  if (
    result.nativeProtocol !== 1 ||
    result.abi !== 1 ||
    result.backendContract !== 1 ||
    result.capabilitySchema !== 1 ||
    result.eventSchema !== 1 ||
    result.traceFormat !== 1 ||
    result.maximumPayloadBytes !== 65536
  ) {
    throw new Error('The control handshake did not select the complete v1 attachment tuple')
  }
}

function assertBytes(payload: Uint8Array, expected: readonly number[], label: string): void {
  const received = Array.from(payload)
  if (received.length !== expected.length) {
    throw new Error(`${label} returned ${received.length} bytes, expected ${expected.length}`)
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (received[index] !== expected[index]) {
      throw new Error(`${label} differed at byte ${index}`)
    }
  }
}

/** Isolated, request-correlated control surface for the native transport proof. */
export function JsiBinaryRuntimeProbe() {
  const [status, setStatus] = useState('Idle — transport probe has not run')
  const runningRef = useRef(false)
  const subscriptionRef = useRef<SubscriptionHandle | null>(null)
  const handshakeRef = useRef<BinaryHandshakeResult | null>(null)

  // Releases the native callback if the example screen unmounts during a probe.
  useEffect(() => {
    return () => {
      const subscription = subscriptionRef.current
      const protocol = globalThis.__ub4JsiBinaryV1
      if (subscription && protocol) {
        protocol.unsubscribe(subscription)
      }
      subscriptionRef.current = null
    }
  }, [])

  const runProbe = async () => {
    if (runningRef.current) {
      return
    }
    runningRef.current = true
    setStatus('Running native transport probe…')
    try {
      const handshake =
        handshakeRef.current ?? (await Ub4JsiBinaryBootstrap.handshake(handshakeRequest))
      if (handshakeRef.current === null) {
        handshakeRef.current = handshake
      }
      assertHandshake(handshake)
      const protocol = getBinaryProtocol()

      const typedArrayBacking = new Uint8Array([199, 11, 22, 33, 88])
      const typedArraySubview = typedArrayBacking.subarray(1, 4)
      const typedArrayOperation = protocol.submit(typedArraySubview)
      typedArrayBacking.fill(0)
      assertBytes(protocol.complete(typedArrayOperation), [11, 22, 33], 'Uint8Array subview')

      const arrayBufferBacking = new Uint8Array([77, 44, 55, 66, 99])
      const arrayBufferOperation = protocol.submitArrayBuffer(arrayBufferBacking.buffer, 1, 3)
      arrayBufferBacking.fill(0)
      assertBytes(
        new Uint8Array(protocol.completeArrayBuffer(arrayBufferOperation)),
        [44, 55, 66],
        'ArrayBuffer range',
      )

      const notification = new Promise<void>((resolve, reject) => {
        const subscription = protocol.subscribe((event) => {
          if (event.kind === 'overflow') {
            reject(new Error(`Native notification stream overflowed after dropping ${event.dropped} events`))
            return
          }
          try {
            assertBytes(event.payload, [71, 72, 73], 'Native notification')
            resolve()
          } catch (error) {
            reject(error)
          }
        })
        subscriptionRef.current = subscription
      })
      await Ub4JsiBinaryBootstrap.emitProbe()
      await notification

      const subscription = subscriptionRef.current
      if (!subscription || !protocol.unsubscribe(subscription)) {
        throw new Error('The native notification subscription did not close exactly once')
      }
      subscriptionRef.current = null
      setStatus('PASS — negotiated attachment, copied subviews, ArrayBuffer range, and native notification verified')
    } catch (error) {
      console.error('[JsiBinaryRuntimeProbe] Transport probe failed:', error)
      setStatus(`FAIL — ${error instanceof Error ? error.message : 'transport check failed'}`)
    } finally {
      runningRef.current = false
    }
  }

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityLabel="Run UB4 JSI binary transport probe"
        accessibilityRole="button"
        disabled={runningRef.current}
        onPress={runProbe}
        style={styles.button}
        testID="ub4-jsi-binary-probe-button"
      >
        <Text style={styles.buttonText}>Run JSI binary transport probe</Text>
      </Pressable>
      <Text style={styles.status} testID="ub4-jsi-binary-probe-status">
        {status}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    gap: 8,
    padding: 12,
  },
  button: {
    alignItems: 'center',
    backgroundColor: '#1d4ed8',
    borderRadius: 6,
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  buttonText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  status: {
    color: '#111827',
    textAlign: 'center',
  },
})
