// __tests__/helpers/zero-diagnostic-guard.js

const { isDeepStrictEqual, inspect } = require('node:util')

const diagnostics = {
  errors: [],
  warnings: [],
  infos: [],
  unhandledRejections: [],
  uncaughtExceptions: []
}

let testIsActive = false
const guardedConsole = globalThis.console
const consoleGuardMarker = Symbol.for('unified-ble-manager.zero-diagnostic-console-guard')

function renderArguments(argumentsList) {
  return argumentsList.map(argument => inspect(argument, { depth: 6 })).join(', ')
}

function failOutsideActiveTest(kind, details) {
  throw new Error(
    `Zero-diagnostic guard received ${kind} outside an active test: ${details}. ` +
      'Await all asynchronous work and emit deliberate diagnostics only from the test body.'
  )
}

function recordConsoleDiagnostic(kind, argumentsList) {
  const entries = diagnostics[kind]
  entries.push(argumentsList)
  if (!testIsActive) {
    failOutsideActiveTest(`console.${kind.slice(0, -1)}`, renderArguments(argumentsList))
  }
}

function removeExactDiagnostic(entries, expectedArguments, kind) {
  const index = entries.findIndex(actualArguments => isDeepStrictEqual(actualArguments, expectedArguments))
  if (index < 0) {
    throw new Error(
      `Expected one local console.${kind} call with (${renderArguments(expectedArguments)}), but observed: ${entries
        .map(renderArguments)
        .join(' | ') || 'none'}`
    )
  }
  entries.splice(index, 1)
}

function removeMatchingDiagnostic(entries, expectedArguments, kind) {
  const index = entries.findIndex(actualArguments => {
    try {
      expect(actualArguments).toEqual(expectedArguments)
      return true
    } catch (_error) {
      return false
    }
  })
  if (index < 0) {
    throw new Error(
      `Expected one local console.${kind} call matching (${renderArguments(expectedArguments)}), but observed: ${entries
        .map(renderArguments)
        .join(' | ') || 'none'}`
    )
  }
  entries.splice(index, 1)
}

function drainLateDiagnostics() {
  return Promise.resolve().then(
    () =>
      new Promise(resolve => {
        setImmediate(resolve)
      })
  )
}

function reportUnexpectedDiagnostics(phase) {
  const failures = []
  if (diagnostics.errors.length > 0) {
    failures.push(`unexpected console.error: ${diagnostics.errors.map(renderArguments).join(' | ')}`)
  }
  if (diagnostics.warnings.length > 0) {
    failures.push(`unexpected console.warn: ${diagnostics.warnings.map(renderArguments).join(' | ')}`)
  }
  if (diagnostics.infos.length > 0) {
    failures.push(`unexpected console.info: ${diagnostics.infos.map(renderArguments).join(' | ')}`)
  }
  if (diagnostics.unhandledRejections.length > 0) {
    failures.push(
      `unhandled rejection: ${diagnostics.unhandledRejections
        .map(reason => inspect(reason, { depth: 6 }))
        .join(' | ')}`
    )
  }
  if (diagnostics.uncaughtExceptions.length > 0) {
    failures.push(
      `uncaught exception: ${diagnostics.uncaughtExceptions.map(error => inspect(error, { depth: 6 })).join(' | ')}`
    )
  }
  if (failures.length > 0) {
    throw new Error(`Zero-diagnostic guard failed during ${phase}: ${failures.join('; ')}`)
  }
}

function resetDiagnostics() {
  diagnostics.errors.length = 0
  diagnostics.warnings.length = 0
  diagnostics.infos.length = 0
  diagnostics.unhandledRejections.length = 0
  diagnostics.uncaughtExceptions.length = 0
}

const guardedConsoleError = (...argumentsList) => {
  recordConsoleDiagnostic('errors', argumentsList)
}
const guardedConsoleWarn = (...argumentsList) => {
  recordConsoleDiagnostic('warnings', argumentsList)
}
const guardedConsoleInfo = (...argumentsList) => {
  recordConsoleDiagnostic('infos', argumentsList)
}

function rejectConsoleReplacement() {
  throw new Error('Replacing globalThis.console is prohibited by the zero-diagnostic guard')
}

function protectGlobalConsoleReference() {
  const consoleDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'console')
  if (consoleDescriptor === undefined || consoleDescriptor.configurable) {
    Object.defineProperty(globalThis, 'console', {
      configurable: false,
      enumerable: consoleDescriptor?.enumerable ?? true,
      get: () => guardedConsole,
      set: rejectConsoleReplacement
    })
    return
  }
  if ('value' in consoleDescriptor && consoleDescriptor.writable) {
    throw new Error('Zero-diagnostic guard cannot prevent replacement of globalThis.console')
  }
  if ('set' in consoleDescriptor && consoleDescriptor.set !== undefined) {
    throw new Error('Zero-diagnostic guard cannot prevent replacement of globalThis.console')
  }
}

function defineGuardedConsoleMethod(methodName, guardedMethod, expectationName) {
  Object.defineProperty(guardedConsole, methodName, {
    configurable: false,
    enumerable: true,
    get: () => guardedMethod,
    set: () => {
      throw new Error(`Direct console.${methodName} spies are prohibited; use ${expectationName} instead`)
    }
  }
  )
}

if (guardedConsole[consoleGuardMarker] !== true) {
  protectGlobalConsoleReference()
  defineGuardedConsoleMethod('error', guardedConsoleError, 'expectConsoleError')
  defineGuardedConsoleMethod('warn', guardedConsoleWarn, 'expectConsoleWarn')
  defineGuardedConsoleMethod('info', guardedConsoleInfo, 'expectConsoleInfo')
  Object.defineProperty(guardedConsole, consoleGuardMarker, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false
  })
}

function recordUnhandledRejection(reason) {
  diagnostics.unhandledRejections.push(reason)
  if (!testIsActive) {
    failOutsideActiveTest('unhandled rejection', inspect(reason, { depth: 6 }))
  }
}
function recordUncaughtException(error) {
  diagnostics.uncaughtExceptions.push(error)
}

process.on('unhandledRejection', recordUnhandledRejection)
process.on('uncaughtExceptionMonitor', recordUncaughtException)

global.expectConsoleError = (...expectedArguments) => {
  removeExactDiagnostic(diagnostics.errors, expectedArguments, 'error')
}
global.expectConsoleWarn = (...expectedArguments) => {
  removeExactDiagnostic(diagnostics.warnings, expectedArguments, 'warn')
}
global.expectConsoleInfo = (...expectedArguments) => {
  removeExactDiagnostic(diagnostics.infos, expectedArguments, 'info')
}
global.expectConsoleErrorMatching = (...expectedArguments) => {
  removeMatchingDiagnostic(diagnostics.errors, expectedArguments, 'error')
}
global.expectConsoleWarnMatching = (...expectedArguments) => {
  removeMatchingDiagnostic(diagnostics.warnings, expectedArguments, 'warn')
}
global.expectConsoleInfoMatching = (...expectedArguments) => {
  removeMatchingDiagnostic(diagnostics.infos, expectedArguments, 'info')
}

beforeEach(() => {
  reportUnexpectedDiagnostics('before test activation')
  resetDiagnostics()
  testIsActive = true
})

afterEach(async () => {
  try {
    await drainLateDiagnostics()
    testIsActive = false
    reportUnexpectedDiagnostics('test teardown')
  } finally {
    testIsActive = false
    resetDiagnostics()
  }
})

afterAll(async () => {
  try {
    await drainLateDiagnostics()
    reportUnexpectedDiagnostics('final teardown')
  } finally {
    process.removeListener('unhandledRejection', recordUnhandledRejection)
    process.removeListener('uncaughtExceptionMonitor', recordUncaughtException)
  }
})
