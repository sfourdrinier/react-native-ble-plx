// __tests__/backend-sdk/fixtures/external-deterministic-backend.mjs

export const unifiedBleBackend = {
  metadata: {
    packageName: 'external-doctor-backend',
    authorNamespace: 'external',
    backendId: 'external:doctor-fixture',
    platformId: 'unified-ble:test',
    compatibility: {}
  },
  factory: {
    backendId: 'external:doctor-fixture',
    provider: {
      descriptor: {
        providerId: 'external:doctor-provider',
        hostKind: 'test',
        loadability: 'loadable',
        compatibility: {}
      },
      listAdapters: async () => []
    },
    selection: { selectedAdapterId: 'external:doctor-adapter' },
    run: { proofScope: 'deterministic' }
  },
  featureSuites: []
}
