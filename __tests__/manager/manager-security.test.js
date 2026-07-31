// __tests__/manager/manager-security.test.js

const {
  attachBleBackend,
  BleManager,
  createBleManagerFromProvider,
  createManagerOwnershipAuthority,
  DEFAULT_BLE_MANAGER_OPTIONS
} = require('../../src/manager/ble-manager')
const { assertAttachedBackend } = require('../../src/backend-contract/backend')
const ownershipAuthorityModule = require('../../src/manager/manager-ownership-authority')
const { opaqueId, version, versionRange } = require('../../src/backend-contract/primitives')
const { createDeterministicTestBackend } = require('../../src/testing/deterministic/deterministic-test-backend')

function compatibility() {
  return {
    backendContract: versionRange(version('backend-contract', 1), version('backend-contract', 1)),
    capabilitySchema: versionRange(version('capability-schema', 1), version('capability-schema', 1)),
    eventSchema: versionRange(version('event-schema', 1), version('event-schema', 1)),
    traceFormat: versionRange(version('trace-format', 1), version('trace-format', 1))
  }
}

function managerConstruction(attachedBackend, ordinal, ownerMode) {
  return {
    attachedBackend,
    clientId: opaqueId(`security-client-${ordinal}`, 'client', `security:${ordinal}`),
    managerId: opaqueId(`security-manager-${ordinal}`, 'manager', `security:${ordinal}`),
    ownerMode
  }
}

function providerConstruction(provider, selectedAdapterId, ordinal) {
  return {
    provider,
    selection: { selectedAdapterId },
    coreCompatibility: compatibility(),
    manager: {
      clientId: opaqueId(`provider-client-${ordinal}`, 'client', `security:provider-${ordinal}`),
      managerId: opaqueId(`provider-manager-${ordinal}`, 'manager', `security:provider-${ordinal}`),
      ownerMode: 'owning'
    }
  }
}

async function attachedFixture() {
  const fixture = createDeterministicTestBackend()
  const attachedBackend = await attachBleBackend(fixture.backend, compatibility())
  const authority = createManagerOwnershipAuthority(attachedBackend)
  return { fixture, attachedBackend, authority }
}

function createManager(attachedBackend, authority, ordinal, ownerMode) {
  return BleManager.create(
    managerConstruction(attachedBackend, ordinal, ownerMode),
    authority,
    DEFAULT_BLE_MANAGER_OPTIONS
  )
}

function failedCleanup(resourceKind, operation) {
  return {
    state: 'release-failed',
    failures: [
      {
        resourceKind,
        error: {
          code: 'platform.failure',
          domain: 'cleanup',
          operation,
          platform: null,
          retryability: 'transient'
        }
      }
    ]
  }
}

function mutableIdentity(identity) {
  return {
    ...identity,
    attachment: {
      ...identity.attachment,
      adapter: {
        ...identity.attachment.adapter,
        state: { ...identity.attachment.adapter.state },
        limitations: [...identity.attachment.adapter.limitations]
      }
    },
    runtime: {
      ...identity.runtime,
      diagnostics: { ...identity.runtime.diagnostics }
    }
  }
}

describe('BleManager authority and cleanup security', () => {
  test('rejects a direct runtime construction that lacks canonical core authority', () => {
    expect(() => new BleManager({}, {})).toThrow(
      expect.objectContaining({
        normalized: expect.objectContaining({
          code: 'argument.invalid',
          operation: 'ble-manager.constructor.core'
        })
      })
    )
  })

  test('rejects forged attachment receipts before authority creation or backend event dispatch', async () => {
    const { fixture, attachedBackend, authority } = await attachedFixture()
    const owner = await createManager(attachedBackend, authority, 1, 'owning')
    const events = jest.spyOn(fixture.backend, 'events')
    const forgedReceipt = {
      backend: attachedBackend.backend,
      attachment: attachedBackend.attachment
    }
    const baselineEventCalls = events.mock.calls.length

    expect(() => assertAttachedBackend(forgedReceipt)).toThrow(
      expect.objectContaining({
        normalized: expect.objectContaining({
          code: 'ownership.denied',
          operation: 'backend.assert-attached-backend.receipt'
        })
      })
    )
    expect(() => createManagerOwnershipAuthority(forgedReceipt)).toThrow(
      expect.objectContaining({
        normalized: expect.objectContaining({
          code: 'ownership.denied',
          operation: 'backend.assert-attached-backend.receipt'
        })
      })
    )
    await expect(
      BleManager.create(managerConstruction(forgedReceipt, 2, 'borrowing'), authority, DEFAULT_BLE_MANAGER_OPTIONS)
    ).rejects.toMatchObject({
      normalized: {
        code: 'ownership.denied',
        operation: 'backend.assert-attached-backend.receipt'
      }
    })
    expect(events).toHaveBeenCalledTimes(baselineEventCalls)

    await owner.destroy()
    events.mockRestore()
  })

  test('rejects duplicate authorities, structural participants, and direct borrower elevation', async () => {
    const { attachedBackend, authority } = await attachedFixture()
    expect(() => createManagerOwnershipAuthority(attachedBackend)).toThrow(
      expect.objectContaining({
        normalized: expect.objectContaining({
          code: 'ownership.denied',
          operation: 'manager-ownership-authority.issuance'
        })
      })
    )

    const structuralParticipant = {
      ...managerConstruction(attachedBackend, 10, 'owning'),
      acceptsOwnershipTransfer: () => true,
      becomeOwnershipTransferDestination: () => undefined,
      relinquishOwnershipTransferSource: () => undefined,
      revokeForOwnerDestroy: async () => ({ state: 'released', failures: [] })
    }
    expect(() => authority.register(structuralParticipant)).toThrow(
      expect.objectContaining({
        normalized: expect.objectContaining({
          code: 'ownership.denied',
          operation: 'manager-ownership-authority.participant-authentication'
        })
      })
    )

    const owner = await createManager(attachedBackend, authority, 1, 'owning')
    const borrower = await createManager(attachedBackend, authority, 2, 'borrowing')
    expect(() => borrower.becomeOwnershipTransferDestination()).toThrow(
      expect.objectContaining({
        normalized: expect.objectContaining({
          code: 'ownership.denied',
          operation: 'manager-ownership-authority.role-capability'
        })
      })
    )
    expect(borrower.ownerMode).toBe('borrowing')

    await owner.destroy()
  })

  test('does not expose a caller-controlled participant enrollment function', async () => {
    const { attachedBackend, authority } = await attachedFixture()
    const structuralParticipant = {
      ...managerConstruction(attachedBackend, 11, 'owning'),
      acceptsOwnershipTransfer: () => true,
      becomeOwnershipTransferDestination: () => undefined,
      relinquishOwnershipTransferSource: () => undefined,
      revokeForOwnerDestroy: async () => ({ state: 'released', failures: [] })
    }

    expect(ownershipAuthorityModule.authenticateManagerOwnershipParticipant).toBeUndefined()
    expect(() => authority.register(structuralParticipant)).toThrow(
      expect.objectContaining({
        normalized: expect.objectContaining({
          code: 'ownership.denied',
          operation: 'manager-ownership-authority.participant-authentication'
        })
      })
    )

    const owner = await createManager(attachedBackend, authority, 1, 'owning')
    await owner.destroy()
  })

  test('destroys a provided backend exactly once when the selected adapter does not match attachment', async () => {
    const fixture = createDeterministicTestBackend()
    const attach = jest.spyOn(fixture.backend, 'attach')
    const destroy = jest.spyOn(fixture.backend, 'destroy')
    const selectedAdapterId = opaqueId('different-adapter', 'adapter', 'security')

    try {
      const rejection = await createBleManagerFromProvider(
        providerConstruction({ create: async () => fixture.backend }, selectedAdapterId, 1),
        DEFAULT_BLE_MANAGER_OPTIONS
      ).then(
        () => {
          throw new Error('expected selected adapter admission to reject')
        },
        error => error
      )
      expect(rejection).toMatchObject({
        normalized: {
          code: 'argument.invalid',
          domain: 'adapter',
          operation: 'ble-manager.create-from-provider.adapter-selection'
        }
      })
      expectConsoleError('[createBleManagerFromProvider] Backend attachment or manager admission failed:', {
        error: rejection,
        cleanup: { state: 'released', failures: [] }
      })
      expect(attach).not.toHaveBeenCalled()
      expect(destroy).toHaveBeenCalledTimes(1)
    } finally {
      attach.mockRestore()
      destroy.mockRestore()
    }
  })

  test.each([
    [
      'registered backend',
      identity => {
        identity.registeredBackendId = 'unified-ble:substituted-backend'
      }
    ],
    [
      'registered platform',
      identity => {
        identity.registeredPlatformId = 'unified-ble:substituted-platform'
      }
    ],
    [
      'runtime metadata',
      identity => {
        identity.runtime.hostKind = 'node'
        identity.runtime.implementationVersion = 'substituted-version'
        identity.runtime.diagnostics.providerId = 'substituted-provider'
      }
    ],
    [
      'full attachment metadata',
      identity => {
        identity.attachment.adapter.displayName = 'Substituted Adapter'
        identity.attachment.adapter.state.safeReason = 'substituted-state'
        identity.attachment.adapter.limitations.push('substituted-limitation')
      }
    ]
  ])('rejects %s mutation after opaque attachment receipt issuance', async (_claim, mutate) => {
    const fixture = createDeterministicTestBackend()
    const identity = mutableIdentity(fixture.backend.identity)
    const identityGetter = jest.spyOn(fixture.backend, 'identity', 'get').mockReturnValue(identity)

    try {
      const attachedBackend = await attachBleBackend(fixture.backend, compatibility())
      expect(() => assertAttachedBackend(attachedBackend)).not.toThrow()
      mutate(identity)
      expect(() => assertAttachedBackend(attachedBackend)).toThrow(
        expect.objectContaining({
          normalized: expect.objectContaining({
            code: 'protocol.violation',
            operation: 'backend.assert-attached-backend.authentication'
          })
        })
      )
      await fixture.backend.destroy()
    } finally {
      identityGetter.mockRestore()
    }
  })

  test('retries borrower resource release after a reported transient cleanup failure', async () => {
    const { attachedBackend, authority } = await attachedFixture()
    const owner = await createManager(attachedBackend, authority, 1, 'owning')
    const borrower = await createManager(attachedBackend, authority, 2, 'borrowing')
    const originalRelease = borrower.core.releaseResources.bind(borrower.core)
    const releaseResources = jest
      .spyOn(borrower.core, 'releaseResources')
      .mockResolvedValueOnce(failedCleanup('manager', 'test.borrower-release'))
      .mockImplementation(originalRelease)

    await expect(borrower.destroy()).resolves.toMatchObject({ state: 'release-failed' })
    await expect(borrower.destroy()).resolves.toMatchObject({ state: 'released' })
    expect(releaseResources).toHaveBeenCalledTimes(2)

    releaseResources.mockRestore()
    await owner.destroy()
  })

  test('retries owner backend destruction without repeating successful resource release', async () => {
    const { attachedBackend, authority } = await attachedFixture()
    const owner = await createManager(attachedBackend, authority, 1, 'owning')
    const releaseResources = jest.spyOn(owner.core, 'releaseResources')
    const originalDestroyBackend = owner.core.destroyBackend.bind(owner.core)
    const destroyBackend = jest
      .spyOn(owner.core, 'destroyBackend')
      .mockResolvedValueOnce(failedCleanup('backend', 'test.owner-backend-destroy'))
      .mockImplementation(originalDestroyBackend)

    await expect(owner.destroy()).resolves.toMatchObject({ state: 'release-failed' })
    await expect(owner.destroy()).resolves.toMatchObject({ state: 'released' })
    expect(releaseResources).toHaveBeenCalledTimes(1)
    expect(destroyBackend).toHaveBeenCalledTimes(2)

    releaseResources.mockRestore()
    destroyBackend.mockRestore()
  })

  test('allows the same transfer grant to retry after resource release reports failure', async () => {
    const { attachedBackend, authority } = await attachedFixture()
    const owner = await createManager(attachedBackend, authority, 1, 'owning')
    const borrower = await createManager(attachedBackend, authority, 2, 'borrowing')
    const grant = authority.issueTransferGrant(owner.managerId, borrower.managerId)
    const originalRelease = owner.core.releaseResources.bind(owner.core)
    const releaseResources = jest
      .spyOn(owner.core, 'releaseResources')
      .mockResolvedValueOnce(failedCleanup('manager', 'test.transfer-release'))
      .mockImplementation(originalRelease)

    await expect(owner.transferOwnership(grant)).resolves.toMatchObject({ state: 'release-failed' })
    expect(owner.ownerMode).toBe('owning')
    expect(borrower.ownerMode).toBe('borrowing')
    await expect(owner.transferOwnership(grant)).resolves.toMatchObject({ state: 'released' })
    expect(owner.ownerMode).toBe('borrowing')
    expect(borrower.ownerMode).toBe('owning')
    expect(releaseResources).toHaveBeenCalledTimes(2)

    releaseResources.mockRestore()
    await borrower.destroy()
  })
})
