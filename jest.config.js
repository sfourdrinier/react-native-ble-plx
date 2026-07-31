// jest.config.js

module.exports = {
  roots: ['<rootDir>/__tests__'],
  globalSetup: '<rootDir>/scripts/ci/jest-zero-diagnostic-global-setup.js',
  setupFilesAfterEnv: ['<rootDir>/__tests__/helpers/zero-diagnostic-guard.js'],
  testResultsProcessor: '<rootDir>/scripts/ci/jest-zero-diagnostic-results.js',
  // Shared fixtures under helpers/ export modules only — not test suites (F086/F087).
  testPathIgnorePatterns: [
    '/node_modules/',
    '/__tests__/helpers/',
    '/__tests__/backend-contract/fixtures/',
    '/__tests__/package-surface/fixtures/'
  ],
  preset: '@react-native/jest-preset',
  transformIgnorePatterns: ['node_modules/(?!(.*react-native.*))/'],
  moduleNameMapper: {
    // Phase 0+: resolve package identity names to this repo during unit tests
    '^unified-ble-manager/web$': '<rootDir>/src/web.ts',
    '^unified-ble-manager/backend-sdk$': '<rootDir>/src/backend-sdk.ts',
    '^unified-ble-manager/cli$': '<rootDir>/src/cli.ts',
    '^unified-ble-manager/testing$': '<rootDir>/src/testing.ts',
    '^unified-ble-manager/node/winrt$': '<rootDir>/src/node-winrt.ts',
    '^unified-ble-manager/electron/main$': '<rootDir>/src/electron-main.ts',
    '^unified-ble-manager/electron/renderer$': '<rootDir>/src/electron-renderer.ts',
    '^unified-ble-manager$': '<rootDir>/src/index.ts'
  }
}
