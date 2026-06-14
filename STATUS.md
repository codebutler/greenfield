# Greenfield in-browser demo — status

## Goal (ACHIEVED)
In-browser Wayland compositor (Greenfield) running hello-world apps fully
client-side, no remote servers — including a compiled-C **WASM** app — now
consolidated into ONE single-origin vite app with a button picker, a working
window manager (drag/resize), and a 100% static build export.

## Server-side window decorations (SSD) — added
- xdg-decoration protocol (zxdg_decoration_manager_v1) generated + implemented
  (XdgDecorationManager.ts, wired in Globals.ts). Forces server_side mode so
  decoration-aware clients (GTK/Qt) suppress their own CSD -> no DOUBLE titlebars.
  Our simple wl_shm apps don't bind it; they're decorated anyway and draw nothing.
- In-scene decorations (render/Decoration.ts): titlebar (title text + × close) +
  border, rasterized via Canvas2D -> WebGL texture, drawn per-view in Scene.renderView
  (correct z-order, unlike a DOM overlay). Active window titlebar is lighter.
  SceneShader.drawTexture() added; View.decoration field; FloatingDesktopSurface
  creates/updates it; View.setInitialPosition adds titlebar margin + cascade.
- Input (Pointer.ts + Renderer.pickDecoration): titlebar drag -> MoveGrab; × button ->
  requestClose() -> xdg_toplevel.close. BOTH WORK.
- Close teardown FIXED: C/WASM apps must call emscripten_force_exit(0) at the end of
  main() (gf-hello.c, eyes.c do this). Reason: with ASYNCIFY + USE_PTHREADS the runtime
  is kept alive after main returns, so Module.onExit (which posts 'Terminate' to the
  compositor, per sdk pre-main.js) never fired -> the compositor never tore the surface
  down. force_exit makes onExit fire -> Terminate -> WebAppLauncher closes the client ->
  xdg_toplevel destructor -> FloatingDesktopSurface.removed() (now also calls render()
  to clear the closed window's pixels). TS apps (simple-shm/webgl) already tore down via
  the JS client lib. MessagePort has no close event, so this onExit/Terminate path is the
  disconnect mechanism for web apps.

## ✅ Current state: the showcase (packages/showcase)
ONE vite server at http://localhost:8080 hosts the compositor + all samples.
Toolbar buttons (no URL bar) launch:
  - simple-shm  (TS, wl_shm)              -> rainbow circles
  - eyes        (C/WASM, wl_shm + pointer)-> a Wayland eyes app (pupils track cursor over window)
  - webgl       (TS, WebGL/ImageBitmap)   -> spinning quad
  - gf-hello    (C compiled to WASM)      -> gradient + orange square
Window manager = compositor `mode:'floating'`: stack, click-focus/raise, resize
by edge-drag, move by body-drag (clients issue xdg_toplevel.move on pointer press;
gf-hello.c does this via wl_pointer). Static export verified on a header-less
`python -m http.server` (coi-serviceworker provides cross-origin isolation).
Screenshots: packages/showcase/e2e/showcase-3apps.png, packages/showcase/e2e/showcase-dragged.png, packages/showcase/e2e/showcase-static-3apps.png

## Run
  ./restart.sh                 # single dev server :8080 (the showcase)
  ./open-browser.sh            # opens Chromium on the GNOME desktop w/ swiftshader flags
  ./serve-static.sh [port]     # vite build + serve dist/ via plain python http.server (default :8090)
  node packages/showcase/e2e/pw-showcase.js [http://localhost:8080/]   # headless verify (clicks samples + drags)

## Environment (survives reboot; sudo password = 'password' on this dev VM)
- Node v24.16.0 at ~/.local (arm64). ~/.local/bin on PATH.
- Build tooling: meson/ninja/cmake/gcc preexisting; installed autoconf/automake/
  libtool/m4 via apt (for expat/libffi sysroot builds).
- emsdk 3.1.46 at libs/compositor-wasm/emsdk; sdk/emsdk symlinks to it.
- System browser /usr/bin/chromium-browser (snap). VM hardware GL is broken ->
  always launch with: --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist

## How the @gfld libs were built
- `yarn install` via `node .yarn/releases/yarn-4.5.0.cjs`.
- Native wasm libs (compositor-wasm xkbcommon/pixman, compositor-ffmpeg-h264):
  PREBUILT npm dist 1.0.0-rc1 dropped in (wasm is single-file-inlined in JS).
- All other @gfld TS libs BUILT FROM SOURCE (repo HEAD is ahead of npm rc1; rc1's
  initScene API was incompatible). Rebuild TS libs:
    # (from the greenfield repo root)
node .yarn/releases/yarn-4.5.0.cjs workspaces foreach -A \
      --topological-dev --exclude '@gfld/compositor-wasm' \
      --exclude '@gfld/compositor-ffmpeg-h264' --exclude '@gfld/example-*' \
      --exclude '@gfld/compositor-shell' --exclude '@gfld/compositor-proxy*' run build

## The C/WASM SDK (for gf-hello)
- Built 4 minimal sysroot libs into sdk/sysroot via their build.sh, in order:
  expat, libffi (then manually copied ffitarget.h/fficonfig.h — script's trailing
  cp fails under set -e), wayland (native scanner + wasm client lib),
  wayland-protocols (xdg-shell). Full gtk4/cairo/pango sysroot NOT built (huge).
- App build: examples/webapps/gf-hello-c/build.sh. Uses a MAIN-THREAD emcc recipe,
  NOT the stock gfcc (which forces -sPROXY_TO_PTHREAD and breaks web apps — see below).

## Key fixes / gotchas discovered (in priority order)
1. WASM web app + emscripten pthreads: app runs in a srcdoc iframe whose ORIGIN is
   the compositor's. (a) A PROXY_TO_PTHREAD Worker is cross-origin if served from a
   different port (Worker SecurityError); (b) even same-origin, the Wayland connect
   handshake postMessages the MessagePort to window.parent, which doesn't exist in
   the Worker -> no window. FIX: serve SAME-ORIGIN + build WITHOUT PROXY_TO_PTHREAD
   (PTHREAD_POOL_SIZE=0, keep ASYNCIFY) so main()+handshake run on the iframe main
   thread. The single-origin showcase makes "same-origin" automatic.
2. compositor output <canvas>: use a FIXED resolution (width/height attrs) + CSS
   scale. Dynamically resizing the canvas buffer (ResizeObserver) clears the GL
   framebuffer without a full repaint -> windows render blank.
3. compositor/src/web/WebAppLauncher.ts (~L147): injected srcdoc <base href> was
   path-only -> cross-origin app scripts resolved to about:blank. FIXED to absolute
   `${url.origin}${dirPath}`. (Still in the tree; matters for multi-origin setups.)
4. Cross-origin isolation: dev/preview set COOP/COEP headers; static export relies
   on public/coi-serviceworker.js (one-time reload to gain isolation).
5. `pkill -f <pat>` self-matches our own shell command (exit 144). Kill by PORT
   (fuser 8080/tcp). Snap chromium: clear ~/snap/chromium/common/chromium/Singleton*
   between launches.
6. Headless chromium worker/iframe console is invisible to puppeteer AND playwright
   for srcdoc-iframe workers; debug via the compositor/main-thread side or route app
   stdout through postMessage (examples/webapps/gf-hello-c/debug-shell.html).

## packages/showcase/e2e/ harness (system /usr/bin/chromium-browser)
- pw-showcase.js [baseUrl]  — Playwright: click each sample, drag a window, screenshot. PRIMARY.
- pw-run.js <web-url> <shot> — launch a single web:// app in a bare compositor (older).
- run.js / run-url.js / diag*.js / *.js — puppeteer diagnostics from the build-up. Reference.

## Bundle / load optimizations done
- compositor/src/remote/wasm-buffer-decoder.ts: the two H.264 wasm decoder
  workers were module-level `new Worker(new URL('./H264NALDecoder.worker.js'))`
  constants -> spawned just by importing the module (Session.ts imports it). Made
  them lazy (getOpaqueWorker/getAlphaWorker, created on first real h264 decode).
  Result: web:// usage no longer downloads the ~1.8MB ffmpeg/h264 worker chunk
  (verified NO fetch on both dev and the static export). The chunk still ships in
  dist/ for remote (rem://) mode.
- Remaining big item: the ~5.9MB main bundle is dominated by the compositor's own
  inlined wasm — xkbcommon (~4.9MB, keyboard) + pixman (~0.75MB) via initWasm.
  NOT h264 (zero libav in main). Slimming that means code-splitting/deferring
  compositor-wasm or rebuilding xkbcommon smaller — not yet done.

## Possible next steps
- Animate gf-hello via wl_surface frame callbacks.
- Per-window controls (close/focus list) in the toolbar using userShell surface events.
- Code-split compositor-wasm (xkbcommon/pixman) so the page shell paints before the 4.9MB loads.
- Bigger app: build cairo/pango/glib sysroot -> a real toolkit (GTK) app (large effort; gtk4 marked broken).
