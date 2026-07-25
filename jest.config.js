module.exports = {
  roots: ['<rootDir>/__tests__'],
  // Shared fixtures under helpers/ export modules only — not test suites (F086/F087).
  testPathIgnorePatterns: ['/node_modules/', '/__tests__/helpers/'],
  preset: '@react-native/jest-preset',
  setupFiles: ['<rootDir>/jest.setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!(.*react-native.*))/'
  ],
  moduleNameMapper: {
    // Phase 0+: resolve package identity names to this repo during unit tests
    '^unified-ble-manager/web$': '<rootDir>/src/hosts/web.ts',
    '^unified-ble-manager/electron$': '<rootDir>/src/hosts/electron.ts',
    '^unified-ble-manager/node$': '<rootDir>/src/hosts/node.ts',
    '^unified-ble-manager$': '<rootDir>/src/index.ts',
    '^@sfourdrinier/react-native-ble-plx/web$': '<rootDir>/packages/react-native-ble-plx-shim/web.js',
    '^@sfourdrinier/react-native-ble-plx/electron$': '<rootDir>/packages/react-native-ble-plx-shim/electron.js',
    '^@sfourdrinier/react-native-ble-plx/node$': '<rootDir>/packages/react-native-ble-plx-shim/node.js',
    '^@sfourdrinier/react-native-ble-plx$': '<rootDir>/packages/react-native-ble-plx-shim/index.js'
  }
}
