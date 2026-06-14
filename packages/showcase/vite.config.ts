import { resolve } from 'node:path'
import glsl from 'vite-plugin-glsl'
import { defineConfig } from 'vite'

// Single-origin showcase. Everything — the compositor SPA and every sample web
// app — is built and served from ONE origin, which removes all the cross-origin
// worker / CORP friction. Served at the site root (base '/').
//
// Cross-origin isolation (needed for SharedArrayBuffer):
//  - dev: the headers below.
//  - static export: public/coi-serviceworker.js installs the same headers
//    client-side, so the built `dist/` works on header-less static hosts too.
export default defineConfig({
  base: '/',
  plugins: [glsl()],
  server: {
    host: 'localhost',
    port: 8080,
    strictPort: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    host: 'localhost',
    port: 8080,
    strictPort: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        // the compositor + toolbar shell (single-canvas mode)
        main: resolve(__dirname, 'index.html'),
        // alternative DOM-windows mode (each window is its own canvas + DOM frame)
        dom: resolve(__dirname, 'dom.html'),
        // sample web apps, each its own entry; emitted under samples/<name>/app.html
        'simple-shm': resolve(__dirname, 'samples/simple-shm/app.html'),
        webgl: resolve(__dirname, 'samples/webgl/app.html'),
      },
    },
  },
})
