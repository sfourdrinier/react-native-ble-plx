// scripts/ci/jest-zero-diagnostic-imported-focused.config.js

const packageJestConfig = require('../../jest.config')
const path = require('node:path')

module.exports = {
  ...packageJestConfig,
  rootDir: path.resolve(__dirname, '../..'),
  roots: ['<rootDir>/scripts/ci/zero-diagnostic-imported-focused-fixture'],
  testMatch: ['<rootDir>/scripts/ci/zero-diagnostic-imported-focused-fixture/imported-focused.test.ts']
}
