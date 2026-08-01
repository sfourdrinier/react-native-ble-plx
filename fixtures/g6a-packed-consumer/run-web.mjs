// fixtures/g6a-packed-consumer/run-web.mjs

const hostTimeoutMs = Number(process.env.G6A_HOST_TIMEOUT_MS ?? 30000)
let hostTimeoutHandle = null
const hostTimeout = new Promise((_, reject) => {
  hostTimeoutHandle = setTimeout(() => {
    reject(new Error(`[g6a-packed-consumer/web] vendor protocol proof exceeded its ${String(hostTimeoutMs)}ms host timeout`))
  }, hostTimeoutMs)
})

Promise.race([
  import('./web-heart-rate-protocol.mjs').then(({ runWebHeartRateProtocol }) => runWebHeartRateProtocol()),
  hostTimeout
])
  .then(result => {
    process.stdout.write(`${JSON.stringify(result)}\n`)
  })
  .catch(error => {
    console.error('[g6a-packed-consumer/web] vendor protocol proof failed:', error)
    process.exitCode = 1
  })
  .finally(() => {
    if (hostTimeoutHandle !== null) {
      clearTimeout(hostTimeoutHandle)
    }
  })
