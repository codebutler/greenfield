import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    host: "localhost",
    port: 9002,
    strictPort: true,
    cors: true,
    headers: {
      // Allow the cross-origin-isolated compositor (:8080) to embed/fetch this
      // app's resources under COEP: require-corp.
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
    },
  },
  build: {
    rollupOptions: {
      input: {
        app: './app.html'
      }
    }
  }
});
