// scripts/ci/jest-zero-diagnostic-late-timer.config.js

const packageJestConfig = require('../../jest.config')
const path = require('node:path')

module.exports = {
  ...packageJestConfig,
  rootDir: path.resolve(__dirname, '../..'),
  roots: ['<rootDir>/scripts/ci/zero-diagnostic-late-timer-fixture'],
  testMatch: ['<rootDir>/scripts/ci/zero-diagnostic-late-timer-fixture/late-timer.test.js']
}
