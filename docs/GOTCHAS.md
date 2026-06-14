# Gotchas & lessons learned

Every non-obvious thing this project hit, with symptom → cause → fix. This is the
doc to read before debugging anything weird.

---

## Build / workspace

### Repo HEAD is ahead of the npm publish
**Symptom:** dropping in all prebuilt `@gfld` npm dist made the compositor throw
`Cannot read properties of undefined (reading 'addEventListener')` — the dist's
`initScene` API was `(sceneId, canvas)` but the repo's `App.tsx` called it with a
single `() => ({canvas, id})` callback.
**Fix:** build the TS libs **from source**; only use prebuilt dist for the two
*native-wasm* packages (`compositor-wasm`, `compositor-ffmpeg-h264`). See [BUILD](BUILD.md#1-the-greenfield-workspace).

### libffi build "fails" but actually succeeded
`sdk/sysrootlibs/libffi/build.sh` exits nonzero on a trailing `cp fficonfig.h` *after*
the library is already installed (the script uses `set -e`). The `.a` and `ffi.h` are
fine; just copy `ffitarget.h`/`fficonfig.h` into `sysroot/include/` manually.

### `wl-eyes` / `gf-hello` won't run if built with the SDK `gfcc` wrapper
See [PROXY_TO_PTHREAD](#proxy_to_pthread) below.

---

## Cross-origin isolation & headers

### SharedArrayBuffer needs cross-origin isolation
`wl_shm` clients use `SharedArrayBuffer`, which requires `COOP: same-origin` +
`COEP: require-corp` (the page must be **cross-origin isolated**). Over a raw IP or
plain HTTP it's disabled and apps silently render nothing.
**Use `localhost`** (or an SSH-forwarded `localhost`) — it's a secure context even
over HTTP. Don't use the VM's LAN IP.

### Static export on a header-less host
A `vite build` is static files; a plain server (GitHub Pages, `python -m http.server`)
won't send COOP/COEP. The showcase bundles `public/coi-serviceworker.js`
(gzuidhof/coi-serviceworker) which installs those headers client-side via a service
worker and reloads once. Verified: the static build is cross-origin isolated and runs
on a plain python server with no header config.

### <a name="base-href"></a>Cross-origin web apps loaded into an empty iframe
**Symptom:** launching a `web://` app from a *different origin* showed an app tab but a
blank window; the iframe's `baseURI` was `about:blank` and its scripts never loaded.
**Cause:** `WebAppLauncher` injected a **path-only** `<base href>` (e.g. `//`); a
`srcdoc` document resolves relative URLs against the embedder, so the app's
`./src/index.ts` resolved to nothing.
**Fix:** inject an **absolute** base href (`${url.origin}${dirPath}`) — see
`packages/compositor/src/web/WebAppLauncher.ts`. (In the single-origin showcase this is
moot, but the fix is correct for multi-origin setups.)

---

## emscripten / WASM apps

### <a name="proxy_to_pthread"></a>`PROXY_TO_PTHREAD` breaks `web://` apps
**Symptom:** a C/WASM app loaded (Module present, wasm fetched) but never created a
window; nothing was posted to the compositor.
**Cause:** the stock `gfcc` wrapper forces `-sPROXY_TO_PTHREAD`, so `main()` runs in a
Worker. But the app runs in a `srcdoc` iframe, and the Wayland connect handshake must
`postMessage` the MessagePort to **`window.parent`** — which doesn't exist in a Worker.
(And if the app is served cross-origin, the pthread Worker URL is cross-origin →
`SecurityError`.)
**Fix:** build with the **main-thread recipe** — drop `-sPROXY_TO_PTHREAD`, set
`-sPTHREAD_POOL_SIZE=0`, keep `-sASYNCIFY` (so the blocking `wl_display_dispatch()` loop
yields to the event loop via async-unwound `__syscall_poll`). Pthreads stay enabled
only for ABI compatibility with the `-pthread`-built sysroot libs. See
`examples/webapps/gf-hello-c/build.sh`.

### <a name="teardown"></a>Closed windows didn't disappear (`emscripten_force_exit`)
**Symptom:** clicking a window's `×` sent `xdg_toplevel.close`, the app handled it and
exited its loop and returned from `main()` — but the window's pixels stayed on screen
forever.
**Cause chain:**
1. `MessagePort` has **no close event**, so the compositor can't detect a disconnect at
   the transport level.
2. The SDK's intended signal is `Module.onExit` → `postMessage('Terminate')`.
3. But with `ASYNCIFY` + `USE_PTHREADS`, the emscripten runtime is **kept alive** after
   `main()` returns, so `onExit` never fires → no `Terminate` → the compositor never
   closes the client → `FloatingDesktopSurface.removed()` is never called.
**Fix (two parts):**
- App: call `emscripten_force_exit(0)` at the end of `main()` (after
  `wl_display_disconnect`) so the runtime actually exits and `onExit` fires.
- Compositor: `FloatingDesktopSurface.removed()` now also calls `renderer.render()` so
  the closed window's pixels are cleared from the scene.
TS apps (simple-shm/webgl) already tore down correctly via the JS client lib.

### Worker/iframe console is invisible to the debugger
Neither Puppeteer nor Playwright surfaced the console of a Worker inside a `srcdoc`
iframe. To debug a WASM app, either observe the **compositor/main-thread** side, or
route the app's stdout to the parent via `postMessage` (see
`examples/webapps/gf-hello-c/debug-shell.html`, which mirrors `Module.print` into the
DOM and posts it up).

---

## Compositor rendering

### Don't dynamically resize the output `<canvas>` buffer
**Symptom:** windows rendered blank even though apps connected and committed buffers.
**Cause:** resizing `canvas.width/height` at runtime (e.g. via a ResizeObserver) clears
the WebGL framebuffer without a full repaint.
**Fix:** give the output `<canvas>` a **fixed resolution** (width/height attributes) and
let CSS scale it to fit (mirrors the known-good `compositor-shell` setup). The compositor
also resizes the canvas to `clientWidth/clientHeight` in `Scene.ensureResolution`, so
scene coords end up ~1:1 with CSS pixels.

### Decorations in-scene vs DOM overlay
Server-side titlebars are drawn **in the WebGL scene** (Canvas2D → texture, per view),
*not* as a DOM overlay. A DOM overlay floats above the single shared canvas, so a back
window's titlebar would incorrectly appear over a front window. In-scene drawing gets
z-order right for free.

### Decoration input is intercepted before the client
Titlebars live *above* the surface, where no client surface exists.
`Renderer.pickDecoration()` hit-tests front-to-back: if a surface is on top at that
point the click goes to the client; otherwise a titlebar hit starts a `MoveGrab` (drag)
or calls `requestClose()` (×). The press is **not** forwarded to the client.
Note: sending `xdg_toplevel.close` from a pointer handler needs an explicit
`session.flush()` (it's an event sent outside a client request).

### `pkill -f` self-matches your own command
**Symptom:** scripts mysteriously die with exit code 144.
**Cause:** `pkill -f compositor-shell` (or `-f vite`) matches the *current shell's*
command line, which contains that string — so it kills its own parent.
**Fix:** kill by **port** (`fuser 8080/tcp`) or by exact process name (`pkill -x chrome`).

---

## H.264 / remote decoder <a name="h264"></a>

### The ffmpeg/H.264 worker was downloaded even in web-only mode
**Symptom:** the ~1.8 MB `H264NALDecoder.worker` chunk was fetched on every session,
though `web://` apps never decode H.264.
**Cause:** `remote/wasm-buffer-decoder.ts` created the two decoder workers at **module
top level** (`const opaqueWorker = new Worker(...)`), so merely importing the module
(which `Session.ts` does) spawned them.
**Fix:** make them **lazy** (`getOpaqueWorker()`/`getAlphaWorker()`, created on first
real wasm h264 decode). Verified: web-only usage no longer downloads the worker, on
both dev and the static build. The chunk still ships in `dist/` for `rem://` mode.

---

## Browser / OS (this VM)

### No GPU → WebGL needs SwiftShader, explicitly
The VM has no working hardware GL (`EGL_BAD_ATTRIBUTE`, GPU process exits). Chromium
won't auto-fall-back to software WebGL anymore. Launch with:
```
--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist
```
Without these the compositor canvas shows "This browser doesn't support WebGL!".
`open-browser.sh` and the `driver/` scripts already pass them.

### snap Chromium can't use a custom profile under `~/.local`
**Symptom:** a `.desktop` launcher with `--user-data-dir=~/.local/share/...` silently
failed to start (empty profile, no window).
**Cause:** snap Chromium's AppArmor confinement can't access hidden dot-directories
(`~/.local`).
**Fix:** put the profile in the snap's own writable area, e.g.
`--user-data-dir=/home/$USER/snap/chromium/common/<name>`. The `~/.local/share/applications/chromium-swgl.desktop`
launcher ("Chromium (sw gl)") uses this.

### snap Chromium SingletonLock
Launching a second Chromium with the default profile while one is running fails on
`SingletonLock`. Use a dedicated `--user-data-dir` (in the snap-writable area) so the
SwiftShader instance is independent. Clear stale locks with
`rm -f ~/snap/chromium/common/chromium/Singleton*`.
