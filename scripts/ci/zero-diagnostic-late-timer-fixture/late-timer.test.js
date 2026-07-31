// scripts/ci/zero-diagnostic-late-timer-fixture/late-timer.test.js

test('cannot emit a diagnostic after its teardown has completed', () => {
  setTimeout(() => {
    console.error('late diagnostic escaped its test lifecycle')
  }, 25)
})
