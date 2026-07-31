// scripts/ci/jest-zero-diagnostic-results.js

module.exports = results => {
  if (results.numPendingTests > 0 || results.numTodoTests > 0) {
    throw new Error(
      `Jest zero-diagnostic gate prohibits pending or todo tests (pending=${results.numPendingTests}, todo=${results.numTodoTests})`
    )
  }
  return results
}
