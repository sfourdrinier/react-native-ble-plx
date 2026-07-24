module.exports = {
  roots: ['<rootDir>/__tests__'],
  preset: '@react-native/jest-preset',
  setupFiles: ['<rootDir>/jest.setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!(.*react-native.*))/'
  ],
  moduleNameMapper: {
    // Phase 0: resolve package identity names to this repo during unit tests
    '^unified-ble-manager$': '<rootDir>/src/index.ts',
    '^@sfourdrinier/react-native-ble-plx$': '<rootDir>/packages/react-native-ble-plx-shim/index.js'
  }
}
