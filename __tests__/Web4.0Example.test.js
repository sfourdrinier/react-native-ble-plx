// __tests__/Web4.0Example.test.js

'use strict'

const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('4.0 Web Bluetooth public example', () => {
  test('uses only packed clean-baseline public entrypoints', () => {
    const app = read('example-web/app.js')
    expect(app).toContain("from 'unified-ble-manager'")
    expect(app).toContain("from 'unified-ble-manager/web'")
    expect(app).toContain("from 'unified-ble-manager/profiles/standard-commands'")
    expect(app).not.toContain('react-native-ble-plx')
    expect(app).not.toContain('/src/')
  })

  test('proves chooser, connect, discovery, read, notification, reconnect, and cleanup controls', () => {
    const app = read('example-web/app.js')
    const html = read('example-web/index.html')
    for (const operation of [
      'chooser.choose',
      'manager.connect',
      'connection.discover',
      'readBatteryLevel',
      'subscribeHeartRateMeasurements',
      'subscription.remove',
      'connection.disconnect',
      'manager.destroy'
    ]) {
      expect(app).toContain(operation)
    }
    for (const control of ['choose-connect', 'reconnect', 'disconnect', 'destroy']) {
      expect(html).toContain(`id="${control}"`)
    }
  })

  test('is built with the repository-owned bundler and documented as physical evidence only when retained', () => {
    const build = read('scripts/examples/build-web-example.js')
    const readme = read('example-web/README.md')
    const publishWorkflow = read('.github/workflows/publish.yml')
    expect(build).toContain("require('webpack')")
    expect(publishWorkflow).toContain('run: pnpm build:example:web')
    expect(readme).toContain('4.0 clean-baseline Web Bluetooth example')
    expect(readme).toMatch(/does not itself create a\s+release evidence receipt/u)
    expect(readme).not.toContain('Historical Web Bluetooth example')
  })
})
