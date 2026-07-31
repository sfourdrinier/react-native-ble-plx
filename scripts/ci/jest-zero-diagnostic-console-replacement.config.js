// scripts/ci/jest-zero-diagnostic-console-replacement.config.js

const packageJestConfig = require('../../jest.config')
const path = require('node:path')

module.exports = {
  ...packageJestConfig,
  rootDir: path.resolve(__dirname, '../..'),
  roots: ['<rootDir>/scripts/ci/zero-diagnostic-console-replacement-fixture'],
  testMatch: ['<rootDir>/scripts/ci/zero-diagnostic-console-replacement-fixture/console-replacement.test.js']
}
