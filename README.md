# wayland-wasm — running Wayland apps in the browser with Greenfield

This project explores running graphical Unix apps **entirely client-side in a web
browser** — no X server, no VNC/RDP streaming, no remote backend. It builds on
[Greenfield](https://github.com/udevbe/greenfield), an in-browser **Wayland**
compositor, and adds:

- a single-origin **showcase** app (one server, button picker, 100% static export);
- two **native C Wayland clients compiled to WebAssembly** (`gf-hello`, `eyes`)
  that run directly in the page;
- a from-scratch **C → WASM build toolchain** (a minimal Greenfield SDK sysroot);
- **server-side window decorations** (titlebars, drag, close) implemented in the
  compositor, with the standard `xdg-decoration` protocol to avoid double titlebars;
- a headless **verification harness** (`driver/`) driving real Chromium.

It started as the question *"has anyone ported an X server to WASM?"* and turned
into a working in-browser Wayland desktop. The full story is in
[`docs/JOURNEY.md`](docs/JOURNEY.md).

> **Why Wayland, not X?** X11's protocol assumes synchronous round-trips and shared
> memory that map badly onto a browser sandbox. Wayland's model — clients hand the
> compositor buffers, the compositor composites — fits the browser cleanly. See
> [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Quick start

Everything runs locally; nothing is streamed from a server.

```bash
# 1. start the single dev server (compositor + all samples) on http://localhost:8080
./restart.sh

# 2. open it in a browser
./open-browser.sh           # opens Chromium on this machine (with software-WebGL flags)
#   ...or browse to http://localhost:8080 yourself (use localhost, see Gotchas)

# 3. in the page, click a sample button (simple-shm / webgl / gf-hello / eyes).
#    Drag a window by its titlebar to move it; click × to close it.
```

Other entry points:

```bash
./serve-static.sh           # vite build + serve the 100% static export via plain python http.server
node packages/showcase/e2e/pw-showcase.js   # headless verification (launch samples, drag a window, screenshot)
```

If WebGL fails in your browser, see [Gotchas](docs/GOTCHAS.md) — on a GPU-less VM
you must launch Chromium with SwiftShader flags (the scripts above already do).

---

## What's here

This is an extended fork of [Greenfield](https://github.com/udevbe/greenfield): our
work is integrated directly into the repo tree — compositor features in
`packages/compositor/`, apps in `examples/webapps/`, the showcase in
`packages/showcase/`, the C→WASM SDK in `sdk/`, docs in `docs/`, and the e2e harness in
`packages/showcase/e2e/`. Paths below are relative to the repo root. For the exact diff
vs. upstream Greenfield, see [docs/CHANGES.md](docs/CHANGES.md).

| Path | What it is |
|---|---|
| `packages/showcase/` | **The single-origin showcase** (compositor + buttons + static export; canvas + DOM modes) |
| `examples/webapps/gf-hello-c/` | "Hello world" Wayland client in **C → WASM** (gradient + square) |
| `examples/webapps/wl-eyes/` | A Wayland eyes app in C → WASM (pupils track the pointer) |
| `packages/compositor/`, `libs/`, `protocol/` | Our compositor changes: server-side decorations, xdg-decoration, lazy h264, DOM-mode hooks |
| `sdk/` | The C→WASM SDK; we built a minimal `sysroot/` (expat, libffi, wayland, xdg-shell) |
| `docs/` | Architecture, build guide, gotchas, changes, and the session journey |
| `packages/showcase/e2e/` | Headless Chromium harness (Playwright + Puppeteer) used to verify everything |
| `STATUS.md` | Terse operational state / resume notes |
| `./{restart,open-browser,serve-static}.sh` | Run helpers |

## The samples

| Button | Language | Buffer path | Notes |
|---|---|---|---|
| **simple-shm** | TS (Weston port) | `wl_shm` (SharedArrayBuffer) | rainbow concentric circles |
| **webgl** | TS | WebBitmap / WebGL | spinning quad |
| **gf-hello** | **C → WASM** | `wl_shm` | gradient + cross + orange square |
| **eyes** | **C → WASM** | `wl_shm` + `wl_pointer` | pupils follow the cursor over the window |

All four run in the browser, composited by the in-browser Wayland compositor, with
server-side titlebars. No remote server is involved.

### Two display modes

The same compositor, two frontends (toggle via the link in the toolbar):
- **Canvas mode** (`/`) — one WebGL canvas composites everything; decorations drawn
  in-scene.
- **DOM windows mode** (`/dom.html`) — each window is its own DOM `<div>` + `<canvas>`,
  with real DOM titlebars; the browser does the stacking. See
  [ARCHITECTURE](docs/ARCHITECTURE.md#two-display-frontends).

## Documentation

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — how the in-browser Wayland stack
  works: the compositor, `web://` vs `rem://`, the buffer transport, the showcase,
  server-side decorations, and the C→WASM SDK.
- **[docs/BUILD.md](docs/BUILD.md)** — how everything is built and how to rebuild it:
  Node/yarn setup, prebuilt-dist-vs-source, the SDK sysroot, compiling a C→WASM app,
  the showcase dev/build/static-export.
- **[docs/GOTCHAS.md](docs/GOTCHAS.md)** — every non-obvious thing we hit and fixed
  (the most valuable doc): base-href, `PROXY_TO_PTHREAD`, canvas resolution, COOP/COEP,
  SwiftShader, `emscripten_force_exit` teardown, lazy h264, and more.
- **[docs/CHANGES.md](docs/CHANGES.md)** — exactly what we added/modified vs. upstream
  Greenfield, grouped by feature (it's a clone, so this is the "diff" map).
- **[docs/JOURNEY.md](docs/JOURNEY.md)** — the chronological story of the session.
- **[STATUS.md](STATUS.md)** — quick operational resume notes.

## Environment notes

- Built and tested on an **arm64** Linux VM (QEMU). Node v24 lives in `~/.local`.
- The VM has **no working GPU**; WebGL runs via SwiftShader (software). The run
  scripts pass the needed Chromium flags.
- Greenfield is **AGPL-3.0**; our additions live alongside it under the same tree.
