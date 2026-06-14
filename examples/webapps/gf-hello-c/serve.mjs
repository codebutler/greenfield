// Minimal static server for the gf-hello WASM app.
// Sets the cross-origin-isolation headers Greenfield needs to embed/fetch the
// app (SharedArrayBuffer + pthreads workers) from the compositor at :8080.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = join(fileURLToPath(new URL('.', import.meta.url)), 'dist')
const PORT = 9004
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
}

createServer(async (req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
  const rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, '')
  const file = join(DIST, rel === '/' ? 'gf-hello.html' : rel)
  const headers = {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
  }
  try {
    const body = await readFile(file)
    headers['Content-Type'] = TYPES[extname(file)] || 'application/octet-stream'
    res.writeHead(200, headers)
    res.end(body)
  } catch {
    res.writeHead(404, headers)
    res.end('not found: ' + rel)
  }
}).listen(PORT, 'localhost', () => {
  console.log(`gf-hello WASM app -> http://localhost:${PORT}/gf-hello.html`)
})
