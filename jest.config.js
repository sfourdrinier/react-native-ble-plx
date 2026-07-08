module.exports = {
  roots: ['<rootDir>/__tests__'],
  preset: '@react-native/jest-preset',
  setupFiles: ['<rootDir>/jest.setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!(.*react-native.*))/'
  ]
}
