// scripts/ci/jest-zero-diagnostic-computed-global.config.js

const packageJestConfig = require('../../jest.config')
const path = require('node:path')

module.exports = {
  ...packageJestConfig,
  rootDir: path.resolve(__dirname, '../..'),
  roots: ['<rootDir>/scripts/ci/zero-diagnostic-computed-global-fixture'],
  testMatch: ['<rootDir>/scripts/ci/zero-diagnostic-computed-global-fixture/computed-global.test.js']
}
