// example/babel.config.js

const path = require('path')
const pak = require('../package.json')

module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    [
      'module-resolver',
      {
        extensions: ['.tsx', '.ts', '.js', '.json'],
        alias: {
          [`${pak.name}/react-native`]: path.join(__dirname, '..', 'src', 'react-native'),
          [pak.name]: path.join(__dirname, '..', pak.source)
        }
      }
    ]
  ]
}
