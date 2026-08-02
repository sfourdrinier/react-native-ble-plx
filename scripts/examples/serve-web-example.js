// scripts/examples/serve-web-example.js

'use strict'

const fs = require('fs')
const http = require('http')
const path = require('path')

const root = path.resolve(__dirname, '../../example-web/dist')
const files = Object.freeze({
  '/': Object.freeze({ path: path.join(root, 'index.html'), contentType: 'text/html; charset=utf-8' }),
  '/index.html': Object.freeze({ path: path.join(root, 'index.html'), contentType: 'text/html; charset=utf-8' }),
  '/app.js': Object.freeze({ path: path.join(root, 'app.js'), contentType: 'text/javascript; charset=utf-8' })
})

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
  const file = files[pathname]
  if (file === undefined) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Not found.\n')
    return
  }
  fs.readFile(file.path, (error, bytes) => {
    if (error !== null) {
      console.error('[serve-web-example] Static asset read failed:', error)
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('Static asset unavailable.\n')
      return
    }
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': file.contentType,
      'cross-origin-opener-policy': 'same-origin'
    })
    response.end(bytes)
  })
})

server.on('error', error => {
  console.error('[serve-web-example] Server failed:', error)
  process.exitCode = 1
})

server.listen(5173, '127.0.0.1', () => {
  console.log('Unified BLE Web example: http://localhost:5173')
})
