// __tests__/tck/web-unsupported-capabilities-scenario.test.js

const { contractError } = require('../../src/backend-contract/errors')
const { executePublicWebUnsupportedCapabilitiesScenario } = require('../../src/tck/runner-public-web-unsupported-capabilities-scenario')

const definition = Object.freeze({
  id: 'web.unsupported-capabilities-reject-and-remain-honest',
  execution: 'feature',
  requiredFacts: ['web-unsupported-capabilities-reject-and-report-runtime-truth'],
  requiredControllerActions: []
})

describe('runner-owned Web unsupported-capability scenario', () => {
  test('never treats an unexpectedly successful scan whose cleanup rejects as unsupported proof', async () => {
    const fixture = fixtureWithScanner({
      start: async () => {
        throw new Error('manager path must own the unexpected scan')
      },
      join: async () => {
        throw new Error('scan join must not run after invalid scan success')
      }
    })
    const manager = managerWithScan(async () => ({
      stop: async () => {
        throw contractError('capability.unsupported', 'scan', 'unexpected-scan.cleanup')
      }
    }))

    await expect(executePublicWebUnsupportedCapabilitiesScenario(manager, fixture, definition)).rejects.toMatchObject({
      message: expect.stringContaining('unexpected Web scan succeeded and its cleanup rejected')
    })
  })

  test('never treats an unexpectedly successful join whose cleanup rejects as unsupported proof', async () => {
    const fixture = fixtureWithScanner({
      start: async () => {
        throw new Error('direct scan start is not used by this scenario')
      },
      join: async () => ({
        stop: async () => {
          throw contractError('capability.unsupported', 'scan', 'unexpected-join.cleanup')
        }
      })
    })
    const manager = managerWithScan(async () => {
      throw contractError('capability.unsupported', 'scan', 'expected-scan.rejection')
    })

    await expect(executePublicWebUnsupportedCapabilitiesScenario(manager, fixture, definition)).rejects.toMatchObject({
      message: expect.stringContaining('unexpected Web scan join succeeded and its cleanup rejected')
    })
  })
})

function managerWithScan(scan) {
  return {
    attachedBackend: {
      attachment: {
        attachment: attachmentRecord()
      }
    },
    scan
  }
}

function fixtureWithScanner(scanner) {
  return {
    backend: {
      identity: { attachment: attachmentRecord() },
      scanner,
      features: { registrations: [] },
      resourceCounters: () => ({})
    },
    controller: {
      settle: promise => promise
    }
  }
}

function attachmentRecord() {
  return {
    attachmentId: 'web-test-attachment',
    backendInstanceId: 'web-test-backend',
    backendGeneration: 'web-test-backend-generation',
    adapter: {
      adapterId: 'web-test-adapter',
      adapterGeneration: 'web-test-adapter-generation'
    }
  }
}
