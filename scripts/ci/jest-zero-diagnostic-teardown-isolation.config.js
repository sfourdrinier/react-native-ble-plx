// scripts/ci/jest-zero-diagnostic-teardown-isolation.config.js

const packageJestConfig = require('../../jest.config')
const path = require('node:path')

module.exports = {
  ...packageJestConfig,
  rootDir: path.resolve(__dirname, '../..'),
  roots: ['<rootDir>/scripts/ci/zero-diagnostic-teardown-isolation-fixture'],
  testMatch: ['<rootDir>/scripts/ci/zero-diagnostic-teardown-isolation-fixture/teardown-isolation.test.js']
}
