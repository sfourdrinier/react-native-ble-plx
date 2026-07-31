// scripts/ci/jest-zero-diagnostic-dynamic-global-focused.config.js

const packageJestConfig = require('../../jest.config')
const path = require('node:path')

module.exports = {
  ...packageJestConfig,
  rootDir: path.resolve(__dirname, '../..'),
  roots: ['<rootDir>/scripts/ci/zero-diagnostic-dynamic-global-focused-fixture'],
  testMatch: ['<rootDir>/scripts/ci/zero-diagnostic-dynamic-global-focused-fixture/dynamic-global-focused.test.jsx']
}
