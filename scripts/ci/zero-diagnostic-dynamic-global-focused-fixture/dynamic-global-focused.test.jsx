// scripts/ci/zero-diagnostic-dynamic-global-focused-fixture/dynamic-global-focused.test.jsx

const testRoot = 'test'
const testMethod = 'only'

globalThis[testRoot][testMethod]('dynamic global focused test must be rejected before Jest executes it', () => undefined)

test('this ordinary test proves the nested JSX fixture is genuinely focused', () => {
  throw new Error('The focused-test policy did not run before this fixture executed')
})
