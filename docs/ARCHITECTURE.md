# Architecture

How graphical apps run **entirely in the browser** here, with no X server, no
streaming, and no remote backend.

## The big picture

Everything — the Wayland **compositor** and every **client app** — runs inside one
browser tab. There is no server doing rendering or compute; the only "servers" are
dumb static file hosts that deliver the HTML/JS/WASM bundles.

```
            ┌──────────────────────── browser tab ────────────────────────┐
            │                                                              │
            │   Greenfield compositor (TS + WASM)                          │
            │   - composites surfaces to a <canvas> via WebGL              │
            │   - input, focus, stacking, window management                │
            │   - draws server-side titlebars/frames                       │
            │        ▲                                                      │
            │        │  Wayland wire protocol over a MessagePort           │
            │        │  (the "unix socket")                                │
            │   ┌────┴───────────────┐   ┌────────────────────┐           │
            │   │ app iframe         │   │ app iframe         │   ...      │
            │   │  simple-shm (TS)   │   │  eyes (C → WASM)   │            │
            │   │  wl_shm buffers    │   │  wl_shm + pointer  │            │
            │   └────────────────────┘   └────────────────────┘           │
            └──────────────────────────────────────────────────────────────┘
```

Each app runs in a hidden `<iframe>`. The compositor and the app talk the **Wayland
wire protocol** to each other over a `MessageChannel` — that's the in-browser
equivalent of the unix domain socket a normal Wayland client connects to.

## Why Wayland (not X11)

X11's protocol is a *drawing* protocol full of synchronous round-trips, server-side
state, and shared-memory (`MIT-SHM`, `XRender` glyph uploads) assumptions that don't
map onto a browser sandbox. Modern toolkits also render client-side and ship pixmaps,
so an in-browser X server mostly degrades to pixel-blitting (i.e. VNC-without-the-network).

Wayland's model is simpler and a better fit: a client renders into a **buffer** and
hands it to the compositor; the compositor composites buffers. In the browser that
buffer is a `SharedArrayBuffer` (`wl_shm`) or an `ImageBitmap`/WebGL texture — passed
in-process over a `MessagePort`, no encoding, no network.

## The two app modes

Greenfield supports two ways to run an app. **This project uses only the first.**

| Mode | App runs… | Transport | Backend needed? |
|---|---|---|---|
| **`web://`** (used here) | in the browser, compiled to WASM/JS | in-process `MessagePort` | **No** — static file delivery only |
| `rem://` (not used) | natively on a server | WebSocket/KCP, **H.264-encoded frames** | Yes — a `compositor-proxy` |

The `rem://` path is where Greenfield's ffmpeg/H.264/WebCodecs machinery lives — it
decodes video-encoded framebuffers of *remote native apps*. We never use it; see
[GOTCHAS](GOTCHAS.md#h264) for how we made that machinery lazy so it isn't even
downloaded.

## How an app launches (`web://`)

The compositor's **web app launcher** (`packages/compositor/src/web/WebAppLauncher.ts`):

1. `fetch()`es the app's HTML from its URL (same origin in the showcase).
2. Injects it into a hidden `<iframe>` via `srcdoc`, rewriting `<head>` to add an
   **absolute** `<base href>` so the app's relative scripts/wasm resolve correctly
   (this was a bug we fixed — see GOTCHAS).
3. The app boots. When its Wayland client calls `wl_display_connect()`, the SDK's
   socket shim creates a `MessageChannel` and `postMessage`s one port up to the
   compositor as a `Connect` message. The compositor wires that port to a new Wayland
   `Client` (`packages/compositor/src/web/WebConnectionHandler.ts`).
4. From then on, Wayland requests/events flow as `Uint32Array` wire buffers over the
   port. File descriptors (e.g. `wl_shm` pool fds) are passed as transferred
   `SharedArrayBuffer`/`ImageBitmap`/`MessagePort` objects.

### App teardown

`MessagePort`s have **no close event**, so the compositor can't detect a disconnect at
the transport level. Instead the SDK's `Module.onExit` posts a `Terminate` message,
which the launcher uses to close the client. For C/WASM apps this requires the app to
actually *exit* the emscripten runtime — see [GOTCHAS](GOTCHAS.md#teardown).

## The buffer transport (why `web://` is cheap)

- **`wl_shm` (simple-shm, gf-hello, eyes):** the client allocates a buffer in a
  `SharedArrayBuffer`, draws pixels into it, and shares the fd. The compositor reads
  it directly and uploads it as a WebGL texture. Zero copy where possible.
- **WebBitmap / WebGL (webgl sample):** the client produces an `ImageBitmap` /
  GL texture handed straight to the compositor.

Because both live in the same browser process, there's no serialization of pixels over
a wire — this is the whole reason the `web://` model is efficient compared to streaming.

## Rendering & the compositor

The compositor renders each mapped surface as a textured quad to a `<canvas>` using
WebGL (`packages/compositor/src/render/`). Key pieces:

- `Scene.render(viewStack)` iterates front-to-back and draws each `View`.
- `SceneShader` draws a textured quad at a view's transform (`Mat4`).
- `Texture.setContent()` accepts any `TexImageSource` — including a `<canvas>` — which
  is what lets us rasterize titlebars with Canvas2D and upload them as textures.

The compositor itself uses a little **WASM** internally: `xkbcommon` (keyboard) and
`pixman`, both single-file-inlined into JS (`libs/compositor-wasm`).

## Two display frontends

The compositor core (Wayland, surfaces, seat, frame-callbacks) is the same; only the
**display frontend** differs. The showcase ships both:

| Mode | Page | How windows are shown |
|---|---|---|
| **Canvas** (default) | `index.html` | one WebGL `<canvas>`; the compositor composites all surfaces + draws server-side decorations into it |
| **DOM windows** | `dom.html` | each top-level surface is its own DOM `<div>` (real DOM titlebar + a `<canvas>` body); the **browser** does stacking; DOM handles drag/close/raise |

The DOM mode is enabled by one compositor hook: a `surfaceContentUpdated` userShell
event that hands each surface's current frame (an `ImageBitmap`) to the shell, which
`drawImage`s it into that window's own 2D canvas. A hidden full-size "driver" canvas
keeps the compositor's render loop and frame callbacks alive (its pixels are never
shown). See `packages/showcase/src/dom.ts`.

**Input into apps** is wired: because the browser already hit-tested which window an
event belongs to, the shell delivers events **directly to the known surface** (no scene
`pickView`). New `pointerMotion`/`pointerLeave`/`notifyKey` userShell actions feed the
seat (`Pointer.forwardLocalMotion`/`forwardLocalLeave`); each window canvas is 1:1 with
its surface, so `offsetX/Y` are surface-local coords. Verified: the eyes track the
cursor, and ESC closes simple-shm. (Button presses are intentionally **not** forwarded
yet — these demo apps map any body-click to `xdg_toplevel.move`, which would fight the
DOM-owned window position; a real app wouldn't.)

Trade-offs: DOM mode gives crisp DOM titlebars/text/buttons, browser-native stacking
and accessibility; it gives up unified WebGL compositing/effects.

## Server-side decorations (titlebars)

There are no server-side title bars in core Wayland — decorations are negotiated by
the optional `xdg-decoration` protocol, and who draws them is the long-running
SSD-vs-CSD debate (wlroots/KDE do SSD; GNOME/GTK do CSD). For a consistent look
across *all* apps without modifying them, this project draws decorations **in the
compositor**:

- **Protocol** (`XdgDecorationManager.ts`): implements `zxdg_decoration_manager_v1`
  and forces `server_side` mode, so any decoration-aware client (GTK/Qt) suppresses
  its own client-side decorations → **no double titlebars**. Our simple apps don't
  bind it; they're decorated anyway and draw nothing themselves, so no conflict.
- **Rendering** (`render/Decoration.ts`): a titlebar (title text + `×`) and border is
  rasterized with **Canvas2D**, uploaded as a WebGL texture, and drawn per-view in
  `Scene.renderView` — *in the scene*, so z-order is correct (a back window's titlebar
  is correctly occluded by a front window, unlike a DOM overlay would be).
- **Input** (`Pointer.ts` + `Renderer.pickDecoration`): a press on a titlebar starts a
  `MoveGrab` (drag to move); a press on the `×` calls `requestClose()` →
  `xdg_toplevel.close`. Active windows get a lighter titlebar.

See [GOTCHAS](GOTCHAS.md) for the canvas-resolution and teardown subtleties this
surfaced.

## The C → WASM SDK

To run a *native C* Wayland client in the browser, it's compiled with **emscripten**
against a WASM build of the Wayland libraries (the Greenfield SDK). We built a minimal
**sysroot** — `expat`, `libffi`, `wayland` (libwayland-client + the native
`wayland-scanner`), and `wayland-protocols` (xdg-shell) — enough for raw-`wl_shm`
clients. The SDK provides:

- `library_unixsockfs.js` — the emscripten JS library that bridges the Wayland unix
  socket to a `MessagePort`.
- `pre-main.js` — posts `Connect`/`Terminate` to the parent compositor.
- a main-thread build recipe (see [BUILD](BUILD.md) and [GOTCHAS](GOTCHAS.md) for why
  we *don't* use the stock `PROXY_TO_PTHREAD` worker recipe).

For richer drawing (anti-aliased vectors, text) the next step is to add **Cairo** to
the sysroot (image backend = pixman + cairo). Skia would be the wrong tool — multi-MB
and overkill for `wl_shm` clients.

## Cross-origin isolation

`wl_shm` uses `SharedArrayBuffer`, which requires the page to be **cross-origin
isolated** (`COOP: same-origin` + `COEP: require-corp`). The showcase:

- serves everything from **one origin** (compositor + samples + WASM), which removes
  cross-origin worker/CORP friction entirely;
- sets the headers in dev; for the static export, a bundled `coi-serviceworker.js`
  installs them client-side so it works on header-less static hosts (GitHub Pages,
  `python -m http.server`).
