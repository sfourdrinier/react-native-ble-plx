// scripts/ci/zero-diagnostic-imported-focused-fixture/imported-focused.test.ts

import { test as importedTest } from '@jest/globals'

importedTest.only('imported focused test must be rejected before Jest executes it', () => undefined)

test('this ordinary test proves the nested TypeScript fixture is genuinely focused', () => {
  throw new Error('The focused-test policy did not run before this fixture executed')
})
