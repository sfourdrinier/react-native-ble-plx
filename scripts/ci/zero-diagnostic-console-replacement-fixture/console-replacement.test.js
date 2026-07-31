// scripts/ci/zero-diagnostic-console-replacement-fixture/console-replacement.test.js

test('console replacement cannot suppress a subsequent diagnostic', () => {
  try {
    globalThis.console = { error: () => undefined }
  } catch (error) {
    console.error('global console replacement was blocked', error)
    return
  }

  console.error('global console replacement unexpectedly succeeded')
})
