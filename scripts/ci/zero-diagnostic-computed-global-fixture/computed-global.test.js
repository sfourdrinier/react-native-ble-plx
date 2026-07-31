// scripts/ci/zero-diagnostic-computed-global-fixture/computed-global.test.js

const key = 'test'
const { [key]: focusedTest } = globalThis

focusedTest.concurrent('computed global Jest root must be rejected before Jest executes it', () => undefined)

test('this ordinary failing test proves the computed global fixture cannot hide it', () => {
  throw new Error('The computed-global policy did not run before this fixture executed')
})
