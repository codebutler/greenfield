import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

// Serve a compiled WASM web app (gf-hello) from the COMPOSITOR's OWN origin.
// emscripten pthread apps spawn a Worker; the app runs in a srcdoc iframe whose
// origin is inherited from the compositor (:8080), so the worker script must be
// same-origin. Hosting the app's dist here (raw static, no vite transforms)
// makes `web://localhost:8080/gfapp/gf-hello.html` fully same-origin.
const GFAPP_DIST = join(__dirname, '../../examples/webapps/gf-hello-c/dist')
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
}

function serveGfApp() {
  return {
    name: 'serve-gfapp',
    configureServer(server: any) {
      server.middlewares.use('/gfapp', async (req: any, res: any, next: any) => {
        try {
          const rel = normalize((req.url || '/').split('?')[0]).replace(/^(\.\.[/\\])+/, '')
          const file = join(GFAPP_DIST, rel === '/' ? 'gf-hello.html' : rel)
          const body = await readFile(file)
          res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream')
          res.end(body)
        } catch {
          next()
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [preact(), serveGfApp()],
  server: {
    host: 'localhost',
    port: 8080,
    strictPort: true,
    cors: false,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})
