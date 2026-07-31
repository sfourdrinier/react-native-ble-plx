// scripts/ci/jest-native-vm.config.js

const packageJestConfig = require('../../jest.config')
const path = require('node:path')

const nativeVmJestConfig = {
  ...packageJestConfig,
  rootDir: path.resolve(__dirname, '../..')
}

module.exports = nativeVmJestConfig
