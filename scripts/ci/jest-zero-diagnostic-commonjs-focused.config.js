// scripts/ci/jest-zero-diagnostic-commonjs-focused.config.js

const packageJestConfig = require('../../jest.config')
const path = require('node:path')

module.exports = {
  ...packageJestConfig,
  rootDir: path.resolve(__dirname, '../..'),
  roots: ['<rootDir>/scripts/ci/zero-diagnostic-commonjs-focused-fixture'],
  testMatch: ['<rootDir>/scripts/ci/zero-diagnostic-commonjs-focused-fixture/commonjs-focused.test.js']
}
