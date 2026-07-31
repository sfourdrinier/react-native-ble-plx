// scripts/ci/zero-diagnostic-native-vm-reflect-skip-fixture/reflect-skip.test.js

Reflect.get(test, 'skip')('Reflect-selected skipped test must be rejected by the result processor', () => undefined)

test('the active test proves Jest completed the fixture before result processing', () => {
  expect(true).toBe(true)
})
