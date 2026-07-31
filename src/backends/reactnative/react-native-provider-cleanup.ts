// src/backends/reactnative/react-native-provider-cleanup.ts

import { BackendContractError, contractError, type CleanupRecord } from '../../backend-contract/errors'

type ReactNativeProviderPlatform = 'android' | 'apple'

interface RetryableCleanupResource {
  destroy(): Promise<CleanupRecord>
}

interface Successful<Value> {
  readonly state: 'succeeded'
  readonly value: Value
}

interface Failed {
  readonly state: 'failed'
  readonly error: Error
}

type ProviderOperationOutcome<Value> = Successful<Value> | Failed

/**
 * Owns a failed provider cleanup until the receiving caller explicitly retries it.
 * The error retains the backend resource instead of allowing an open native attachment
 * to become unreachable when a provider probe or initialization cleanup cannot finish.
 */
export class ReactNativeProviderCleanupError extends BackendContractError {
  readonly cleanupKind: 'release-failed' | 'released-with-failures' | 'rejected'

  constructor(
    readonly platform: ReactNativeProviderPlatform,
    readonly cleanupOperation: string,
    readonly cleanup: CleanupRecord | Error,
    private readonly resource: RetryableCleanupResource
  ) {
    super(cleanupContractError(platform, cleanupOperation, cleanup).normalized)
    this.name = 'ReactNativeProviderCleanupError'
    this.cleanupKind =
      cleanup instanceof Error
        ? 'rejected'
        : cleanup.state === 'release-failed'
          ? 'release-failed'
          : 'released-with-failures'
  }

  async retryCleanup(): Promise<void> {
    await releaseReactNativeProviderResource(this.resource, this.platform, this.cleanupOperation)
  }
}

/**
 * Completes a provider-owned cleanup before returning a probe result or surfacing
 * a setup failure. If cleanup fails, the thrown error retains explicit retry ownership.
 */
export async function withReactNativeProviderCleanup<Value>(
  resource: RetryableCleanupResource,
  platform: ReactNativeProviderPlatform,
  cleanupOperation: string,
  operation: () => Promise<Value> | Value
): Promise<Value> {
  const operationOutcome = await captureProviderOperation(operation, platform, cleanupOperation)
  const cleanupError = await captureProviderCleanup(resource, platform, cleanupOperation)
  if (operationOutcome.state === 'failed' && cleanupError !== null) {
    throw new AggregateError(
      [operationOutcome.error, cleanupError],
      `${cleanupOperation}: provider operation and cleanup both failed`
    )
  }
  if (operationOutcome.state === 'failed') {
    throw operationOutcome.error
  }
  if (cleanupError !== null) {
    throw cleanupError
  }
  return operationOutcome.value
}

async function captureProviderOperation<Value>(
  operation: () => Promise<Value> | Value,
  platform: ReactNativeProviderPlatform,
  cleanupOperation: string
): Promise<ProviderOperationOutcome<Value>> {
  try {
    return { state: 'succeeded', value: await operation() }
  } catch (error) {
    return { state: 'failed', error: operationError(platform, cleanupOperation, error) }
  }
}

async function captureProviderCleanup(
  resource: RetryableCleanupResource,
  platform: ReactNativeProviderPlatform,
  cleanupOperation: string
): Promise<ReactNativeProviderCleanupError | null> {
  try {
    await releaseReactNativeProviderResource(resource, platform, cleanupOperation)
    return null
  } catch (error) {
    if (error instanceof ReactNativeProviderCleanupError) {
      return error
    }
    return new ReactNativeProviderCleanupError(
      platform,
      cleanupOperation,
      operationError(platform, cleanupOperation, error),
      resource
    )
  }
}

async function releaseReactNativeProviderResource(
  resource: RetryableCleanupResource,
  platform: ReactNativeProviderPlatform,
  cleanupOperation: string
): Promise<void> {
  try {
    const cleanup = await resource.destroy()
    if (cleanup.state === 'released' && cleanup.failures.length === 0) {
      return
    }
    const failure = new ReactNativeProviderCleanupError(platform, cleanupOperation, cleanup, resource)
    console.error('[releaseReactNativeProviderResource] Provider cleanup did not complete:', {
      platform,
      cleanupOperation,
      cleanup
    })
    throw failure
  } catch (error) {
    if (error instanceof ReactNativeProviderCleanupError) {
      throw error
    }
    const cleanupFailure = operationError(platform, cleanupOperation, error)
    const failure = new ReactNativeProviderCleanupError(platform, cleanupOperation, cleanupFailure, resource)
    console.error('[releaseReactNativeProviderResource] Provider cleanup rejected:', {
      platform,
      cleanupOperation,
      error: cleanupFailure
    })
    throw failure
  }
}

function cleanupContractError(
  platform: ReactNativeProviderPlatform,
  cleanupOperation: string,
  cleanup: CleanupRecord | Error
): BackendContractError {
  const cleanupFailureCount = cleanup instanceof Error ? 1 : cleanup.failures.length
  const cleanupKind = cleanup instanceof Error ? 'native-cleanup-rejected' : `native-cleanup-${cleanup.state}`
  return contractError('platform.failure', 'cleanup', cleanupOperation, {
    domain: `react-native-${platform}`,
    code: cleanupKind,
    safeMessage: 'The React Native provider could not complete native resource cleanup.',
    metadata: Object.freeze({ cleanupFailureCount })
  })
}

function operationError(platform: ReactNativeProviderPlatform, cleanupOperation: string, error: unknown): Error {
  if (error instanceof Error) {
    return error
  }
  return contractError('platform.failure', 'platform', `${cleanupOperation}.operation`, {
    domain: `react-native-${platform}`,
    code: 'provider-operation-rejected-without-error',
    safeMessage: 'The React Native provider operation rejected without an Error object.',
    metadata: Object.freeze({})
  })
}
