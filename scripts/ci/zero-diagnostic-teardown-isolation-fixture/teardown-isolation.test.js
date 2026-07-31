// scripts/ci/zero-diagnostic-teardown-isolation-fixture/teardown-isolation.test.js

test('the first test deliberately leaves one diagnostic for teardown', () => {
  console.error('first teardown diagnostic')
})

test('the next test starts with clean diagnostic state', () => {
  expect(true).toBe(true)
})
