// scripts/ci/jest-zero-diagnostic-native-vm-reflect-skip.config.js

const nativeVmJestConfig = require('./jest-native-vm.config')
const path = require('node:path')

module.exports = {
  ...nativeVmJestConfig,
  rootDir: path.resolve(__dirname, '../..'),
  roots: ['<rootDir>/scripts/ci/zero-diagnostic-native-vm-reflect-skip-fixture'],
  testMatch: ['<rootDir>/scripts/ci/zero-diagnostic-native-vm-reflect-skip-fixture/reflect-skip.test.js']
}
