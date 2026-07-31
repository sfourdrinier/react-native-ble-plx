// scripts/ci/zero-diagnostic-commonjs-focused-fixture/commonjs-focused.test.js

require('@jest/globals').test.concurrent(
  'direct chained CommonJS concurrent test must be rejected before Jest executes it',
  () => undefined
)

test('this ordinary failing test proves the nested CommonJS concurrent fixture cannot hide it', () => {
  throw new Error('The concurrent-test policy did not run before this fixture executed')
})
