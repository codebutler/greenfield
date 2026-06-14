# @gfld/showcase — single-origin, static Greenfield showcase

One vite app that embeds the in-browser Greenfield Wayland **compositor** and a
toolbar of **sample apps**. No URL bar — click a button to launch a sample. The
compositor and every sample are served from **one origin**, which removes all the
cross-origin worker/CORP friction. Exports as a **100% static site**.

## Samples (all run client-side in the browser, no remote server)
- **simple-shm** — TS Wayland client, raw `wl_shm` (rainbow circles).
- **webgl** — TS Wayland client, WebGL/ImageBitmap buffer (spinning quad).
- **gf-hello** — a Wayland client written in **C, compiled to WebAssembly**
  (gradient + orange square). Source: `../../examples/webapps/gf-hello-c/`.
  Its prebuilt output is vendored here under `public/gfapp/`.

## Window manager
`createCompositorSession({ mode: 'floating' })` is Greenfield's built-in WM:
windows stack, click-to-focus/raise, resize by dragging an edge, and **move by
dragging the body**. Wayland has no server-side title bars, so a client starts a
move by issuing `xdg_toplevel.move` on pointer-press — `gf-hello.c` does exactly
that (`wl_pointer` button → `xdg_toplevel_move`).

## Run (dev)
```
yarn start          # http://localhost:8080
```

## Build + serve as a static site (works on ANY static host)
```
yarn build          # -> dist/
# serve dist/ with anything, even a header-less server:
python3 -m http.server 8090 --bind 127.0.0.1   # then open http://localhost:8090
```
Cross-origin isolation (required for SharedArrayBuffer) is provided two ways:
- dev / hosts that allow it: COOP/COEP response headers (see `vite.config.ts`).
- header-less static hosts (GitHub Pages, plain http.server): the bundled
  `public/coi-serviceworker.js` installs the headers client-side and reloads once.

## Layout
```
index.html                 compositor canvas + toolbar buttons
src/main.ts                boots the compositor (floating mode), wires buttons
src/styles.css
samples/simple-shm/        TS sample (vite multi-page entry)
samples/webgl/             TS sample (vite multi-page entry, glsl shaders)
public/gfapp/              prebuilt gf-hello C/WASM (static passthrough)
public/coi-serviceworker.js
```

## Notes / gotchas
- The compositor output `<canvas>` has a FIXED resolution (width/height attrs);
  CSS scales it to fill. Do NOT resize the canvas buffer dynamically — that
  clears the GL framebuffer without a full repaint and windows go blank.
- The gf-hello WASM app must be built with the MAIN-THREAD recipe (no
  `-sPROXY_TO_PTHREAD`); see `examples/webapps/gf-hello-c/build.sh` / README.
- First load is heavy (~6 MB bundle with inlined compositor wasm, then wasm init
  under software WebGL on this VM). It's a one-time cost; nothing is streamed.
```
