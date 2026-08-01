// __tests__/ZeroDiagnosticGuard.test.js

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  findJestPolicyViolations,
  findProhibitedJestProjectTestFiles,
  findProhibitedJestTestFiles,
  formatJestPolicyDiagnosticPath,
  hasProhibitedJestSyntax
} = require('../scripts/ci/jest-zero-diagnostic-global-setup')

const projectRoot = path.join(__dirname, '..')

function joinSyntax(parts) {
  return parts.join('')
}

function runNestedJest(configFileName) {
  const jestCli = require.resolve('jest/bin/jest')
  const configPath = path.join(projectRoot, 'scripts/ci', configFileName)

  return execFileSync(process.execPath, [jestCli, '--config', configPath, '--runInBand'], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: 'pipe'
  })
}

function expectNestedJestFailure(configFileName, expectedFailure) {
  expect(() => runNestedJest(configFileName)).toThrow(expectedFailure)
}

describe('zero-diagnostic Jest guard', () => {
  test('fails closed when a local expected console error was never emitted', () => {
    expect(() => expectConsoleError('missing expected diagnostic')).toThrow('Expected one local console.error call')
  })

  test('requires each deliberate console diagnostic to be consumed exactly once', () => {
    console.error('expected diagnostic', { operation: 'guard-test' })
    expectConsoleError('expected diagnostic', { operation: 'guard-test' })
  })

  test('supports structural matching for error values whose identity is not part of the contract', () => {
    console.error('expected diagnostic', new Error('expected failure'))
    expectConsoleErrorMatching('expected diagnostic', expect.objectContaining({ message: 'expected failure' }))
  })

  test('requires deliberate console info diagnostics to be consumed', () => {
    console.info('expected info diagnostic', { operation: 'guard-test' })
    expectConsoleInfo('expected info diagnostic', { operation: 'guard-test' })
  })

  test('prohibits direct console spies so they cannot bypass diagnostic accounting', () => {
    expect(() => jest.spyOn(console, 'error')).toThrow('Cannot redefine property: error')
  })

  test('prevents replacing the guarded global console by assignment', () => {
    const originalConsole = globalThis.console

    expect(() => {
      globalThis.console = { error: () => undefined }
    }).toThrow('Replacing globalThis.console is prohibited by the zero-diagnostic guard')

    expect(globalThis.console).toBe(originalConsole)
    console.error('guarded console remains active after replacement assignment')
    expectConsoleError('guarded console remains active after replacement assignment')
  })

  test('prevents replacing the guarded global console with Object.defineProperty', () => {
    const originalConsole = globalThis.console

    expect(() => {
      Object.defineProperty(globalThis, 'console', { value: { error: () => undefined } })
    }).toThrow('Cannot redefine property: console')

    expect(globalThis.console).toBe(originalConsole)
    console.warn('guarded console remains active after descriptor replacement')
    expectConsoleWarn('guarded console remains active after descriptor replacement')
  })

  test('rejects focused, skipped, todo, concurrent, stored, imported, and computed Jest syntax in every supported test extension', () => {
    const prohibitedForms = [
      ['f', 'it'],
      ['f', 'describe'],
      ['x', 'it'],
      ['x', 'describe'],
      ['x', 'test'],
      ['test', '.', 'only'],
      ['it', '.', 'skip'],
      ['describe', '.', 'todo'],
      ['test', '[', "'", 'only', "'", ']'],
      ['it', '[', '"', 'skip', '"', ']'],
      ['describe', '[', "'", 'todo', "'", ']'],
      ['test', '.', 'only', '.', 'each'],
      ['it', '.', 'skip', '.', 'each'],
      ['describe', '[', "'", 'todo', "'", ']', '[', "'", 'each', "'", ']'],
      ['test', '.', 'concurrent'],
      ['it', '.', 'concurrent', '.', 'each'],
      ['test', '.', 'concurrent', '.', 'only']
    ].map(joinSyntax)
    const astOnlyForms = [
      "test /* comments are not a policy bypass */ .only('focused', () => undefined)",
      "test?.only('focused', () => undefined)",
      "test[`only`]('focused', () => undefined)",
      "it?.['skip']('skipped', () => undefined)",
      "describe?.[`todo`]('todo')",
      "globalThis.test.only('global focused', () => undefined)",
      "global['it']?.['skip']('global skipped', () => undefined)",
      "test.each([[1]]).only('focused parameterized', () => undefined)",
      "test.each`value\\n${1}`.only('focused tagged parameterized', () => undefined)",
      "it.concurrent.each`value\\n${1}`('concurrent tagged parameterized', () => undefined)",
      "test[mode]('dynamic property cannot select a Jest policy method', () => undefined)",
      "const focused = test.only; focused('stored focused test', () => undefined)",
      "let focused; focused = test.only; focused('assigned focused test', () => undefined)",
      "const { only: focused } = test; focused('destructured focused test', () => undefined)",
      "const testAlias = test; testAlias.only('aliased focused test', () => undefined)",
      "const boundTest = test.bind(null); boundTest('bound test root', () => undefined)",
      "const parameterized = test.each; parameterized([[1]]).only('aliased parameterized focused test', () => undefined)",
      "const holder = { test }; holder.test.only('stored object focused test', () => undefined)",
      "import { test as importedTest } from '@jest/globals'; importedTest.only('imported focused test', () => undefined)",
      "import * as jestGlobals from '@jest/globals'; jestGlobals.test.concurrent('namespace concurrent test', () => undefined)",
      "const { test: requiredTest } = require('@jest/globals'); requiredTest.only('required focused test', () => undefined)",
      "const requiredGlobals = require('@jest/globals'); const focused = requiredGlobals.test.only; focused('required namespace focused test', () => undefined)",
      "const { test: requiredTest } = require('@jest/globals'); const focused = requiredTest.only.bind(null); focused('bound required focused test', () => undefined)",
      "require('@jest/globals').test.concurrent('direct chained CommonJS concurrent test', () => undefined)",
      "const requiredTest = require('@jest/globals').test; requiredTest.concurrent('stored chained CommonJS concurrent test', () => undefined)",
      "globalThis.fit('global focused alias', () => undefined)",
      "import * as jestGlobals from '@jest/globals'; jestGlobals.fit('namespace focused alias', () => undefined)",
      "globalThis[jestRoot].only('dynamic global focused test', () => undefined)",
      "import * as jestGlobals from '@jest/globals'; jestGlobals[jestRoot].skip('dynamic namespace skipped test', () => undefined)",
      "window['test']['only']('window focused test', () => undefined)",
      "const { test: windowTest } = window; windowTest.only('destructured window focused test', () => undefined)",
      "const key = 'test'; const { [key]: globalTest } = globalThis; globalTest.concurrent('computed global destructuring concurrent test', () => undefined)",
      "const key = 'test'; const { [key]: windowTest } = window; windowTest.concurrent('computed window destructuring concurrent test', () => undefined)",
      "const root = 'test'; const method = 'only'; globalThis[root][method]('dynamic global path', () => undefined)"
    ]
    for (const source of astOnlyForms) {
      expect(hasProhibitedJestSyntax(source)).toBe(true)
    }
    const temporaryTestsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ubm-zero-diagnostic-policy-'))
    try {
      const extensionCandidates = ['.js', '.jsx', '.cjs', '.mjs', '.ts', '.tsx']
      for (const [index, form] of prohibitedForms.entries()) {
        const source = `${form}(() => undefined)\n`
        const extension = extensionCandidates[index % extensionCandidates.length]
        const filePath = path.join(temporaryTestsRoot, `candidate-${index}${extension}`)
        fs.writeFileSync(filePath, source)
        expect(hasProhibitedJestSyntax(source)).toBe(true)
      }
      fs.writeFileSync(path.join(temporaryTestsRoot, 'normal.js'), 'test(() => undefined)\n')
      expect(findProhibitedJestTestFiles(temporaryTestsRoot)).toEqual(
        prohibitedForms
          .map((_, index) => {
            const extension = extensionCandidates[index % extensionCandidates.length]
            return path.join(temporaryTestsRoot, `candidate-${index}${extension}`)
          })
          .sort((left, right) => left.localeCompare(right))
      )
      expect(
        findJestPolicyViolations(
          "import { test as importedTest } from '@jest/globals'; importedTest('normal imported test', () => undefined)",
          'normal-imported.test.ts'
        )
      ).toEqual([])
      expect(
        findJestPolicyViolations(
          "import * as jestGlobals from '@jest/globals'; jestGlobals.test('normal namespace test', () => undefined)",
          'normal-namespace.test.tsx'
        )
      ).toEqual([])
      expect(findJestPolicyViolations('const value = appConfig[section][property]', 'normal-app-computed.test.js')).toEqual([])
      expect(findJestPolicyViolations('const value = globalThis[applicationKey]', 'normal-global-computed.test.js')).toEqual([])
      expect(
        findJestPolicyViolations(
          "Reflect.get(test, 'skip')('result-level skipped test', () => undefined)",
          'reflect-result-level.test.js'
        )
      ).toEqual([])
    } finally {
      fs.rmSync(temporaryTestsRoot, { recursive: true, force: true })
    }
  })

  test('fails closed when an active JavaScript test candidate has a parse error', () => {
    expect(() => hasProhibitedJestSyntax("test('unterminated', () => {", 'broken.mjs')).toThrow(
      'Unable to parse Jest test candidate broken.mjs'
    )
  })

  test('scans only the configured Jest roots and ignores configured inactive fixture paths', () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ubm-zero-diagnostic-project-roots-'))
    const activeRoot = path.join(temporaryRoot, 'active')
    const ignoredRoot = path.join(temporaryRoot, 'ignored')
    fs.mkdirSync(activeRoot)
    fs.mkdirSync(ignoredRoot)
    const activeViolation = path.join(activeRoot, 'active.test.cjs')
    const ignoredViolation = path.join(ignoredRoot, 'inactive.test.mjs')
    try {
      fs.writeFileSync(activeViolation, "test?.only('active focused test', () => undefined)\n")
      fs.writeFileSync(ignoredViolation, "test?.only('inactive fixture', () => undefined)\n")
      expect(
        findProhibitedJestProjectTestFiles({
          rootDir: temporaryRoot,
          roots: [activeRoot],
          testPathIgnorePatterns: [`${ignoredRoot.split(path.sep).join('/')}/`]
        })
      ).toEqual([activeViolation])
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true })
    }
  })

  test('falls back to the configured project root when Jest roots are not supplied', () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ubm-zero-diagnostic-default-project-root-'))
    const activeViolation = path.join(temporaryRoot, 'active.test.tsx')
    try {
      fs.writeFileSync(activeViolation, "test.only('focused test under the configured root', () => undefined)\n")
      expect(findProhibitedJestProjectTestFiles({ rootDir: temporaryRoot })).toEqual([activeViolation])
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true })
    }
  })

  test('formats policy diagnostic paths with POSIX separators from either platform spelling', () => {
    const canonicalPath = 'scripts/ci/zero-diagnostic-focused-fixture/focused.test.js'

    expect(formatJestPolicyDiagnosticPath(canonicalPath)).toBe(canonicalPath)
    expect(formatJestPolicyDiagnosticPath(canonicalPath.replaceAll('/', '\\'))).toBe(canonicalPath)
  })

  test('fails a nested Jest process when a timer emits a diagnostic after final teardown', () => {
    expectNestedJestFailure(
      'jest-zero-diagnostic-late-timer.config.js',
      /Zero-diagnostic guard received console\.error outside an active test/
    )
  })

  test('fails a nested Jest process before a stored focused test can hide an ordinary failure', () => {
    expectNestedJestFailure(
      'jest-zero-diagnostic-focused.config.js',
      /Focused, skipped, todo, or concurrent Jest tests are prohibited: scripts\/ci\/zero-diagnostic-focused-fixture\/focused\.test\.js/
    )
  })

  test('fails a nested Jest process before an imported focused TypeScript test can hide an ordinary failure', () => {
    expectNestedJestFailure(
      'jest-zero-diagnostic-imported-focused.config.js',
      /Focused, skipped, todo, or concurrent Jest tests are prohibited: scripts\/ci\/zero-diagnostic-imported-focused-fixture\/imported-focused\.test\.ts/
    )
  })

  test('fails a nested Jest process before a direct chained CommonJS concurrent test can hide an ordinary failure', () => {
    expectNestedJestFailure(
      'jest-zero-diagnostic-commonjs-focused.config.js',
      /Focused, skipped, todo, or concurrent Jest tests are prohibited: scripts\/ci\/zero-diagnostic-commonjs-focused-fixture\/commonjs-focused\.test\.js/
    )
  })

  test('fails a nested Jest process before a dynamic global focused JSX test can hide an ordinary failure', () => {
    expectNestedJestFailure(
      'jest-zero-diagnostic-dynamic-global-focused.config.js',
      /Focused, skipped, todo, or concurrent Jest tests are prohibited: scripts\/ci\/zero-diagnostic-dynamic-global-focused-fixture\/dynamic-global-focused\.test\.jsx/
    )
  })

  test('fails a nested Jest process before a computed global Jest root can hide an ordinary failure', () => {
    expectNestedJestFailure(
      'jest-zero-diagnostic-computed-global.config.js',
      /Focused, skipped, todo, or concurrent Jest tests are prohibited: scripts\/ci\/zero-diagnostic-computed-global-fixture\/computed-global\.test\.js/
    )
  })

  test('fails a nested Jest process when console replacement cannot suppress its diagnostic', () => {
    expectNestedJestFailure(
      'jest-zero-diagnostic-console-replacement.config.js',
      /Zero-diagnostic guard failed during test teardown: unexpected console\.error/
    )
  })

  test('fails a nested native-VM Jest process when Reflect selects a skipped test', () => {
    expectNestedJestFailure(
      'jest-zero-diagnostic-native-vm-reflect-skip.config.js',
      /Jest zero-diagnostic gate prohibits pending or todo tests \(pending=1, todo=0\)/
    )
  })

  test('resets teardown diagnostics after reporting so the next test starts clean', () => {
    let childFailure
    try {
      runNestedJest('jest-zero-diagnostic-teardown-isolation.config.js')
    } catch (error) {
      childFailure = error
    }

    expect(childFailure).toBeDefined()
    const childOutput = `${String(childFailure.stdout)}${String(childFailure.stderr)}`
    expect(childOutput).toMatch(/Tests:\s+1 failed,\s+1 passed,\s+2 total/)
    expect(childOutput).not.toContain('before test activation')
  })
})
