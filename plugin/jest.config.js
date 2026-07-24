const path = require('path')

// Resolve stubbed packages (e.g. expo/config) without Unix-only NODE_PATH=...
// so Windows CI can run `pnpm test:plugin` under pwsh/cmd.
const preset = require('expo-module-scripts/jest-preset-plugin')

module.exports = {
  ...preset,
  modulePaths: [path.join(__dirname, 'test-stubs'), ...(preset.modulePaths || [])]
}
