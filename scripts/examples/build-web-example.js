// scripts/examples/build-web-example.js

'use strict'

const fs = require('fs')
const path = require('path')
const webpack = require('webpack')

const root = path.resolve(__dirname, '../..')
const outputPath = path.join(root, 'example-web/dist')

fs.mkdirSync(outputPath, { recursive: true })
fs.copyFileSync(path.join(root, 'example-web/index.html'), path.join(outputPath, 'index.html'))

const compiler = webpack({
  mode: 'production',
  target: ['web', 'es2022'],
  entry: path.join(root, 'example-web/app.js'),
  output: {
    path: outputPath,
    filename: 'app.js',
    clean: { keep: /index\.html$/u }
  },
  devtool: false,
  performance: { hints: false },
  resolve: {
    conditionNames: ['import', 'browser', 'default'],
    extensions: ['.js']
  }
})

compiler.run((error, stats) => {
  compiler.close(closeError => {
    const failure = error ?? closeError
    if (failure !== null && failure !== undefined) {
      console.error('[build-web-example] Webpack failed:', failure)
      process.exitCode = 1
      return
    }
    if (stats === undefined) {
      console.error('[build-web-example] Webpack returned no build statistics.')
      process.exitCode = 1
      return
    }
    if (stats.hasErrors() || stats.hasWarnings()) {
      console.error(stats.toString({ all: false, errors: true, warnings: true }))
      process.exitCode = 1
      return
    }
    console.log('Built the 4.0 Web Bluetooth example with zero diagnostics.')
  })
})
