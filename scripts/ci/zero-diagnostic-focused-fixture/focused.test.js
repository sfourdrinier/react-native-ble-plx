// scripts/ci/zero-diagnostic-focused-fixture/focused.test.js

const focusedTest = test.only

focusedTest('stored focused test must be rejected before Jest executes it', () => undefined)

test('this ordinary test proves the nested fixture is genuinely focused', () => {
  throw new Error('The focused-test policy did not run before this fixture executed')
})
