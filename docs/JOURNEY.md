# The journey

A chronological narrative of how this project came together, including the research,
the decisions, and the dead-ends. Useful context for *why* things are the way they are.

## 0. The question

It started with: *"has anyone ported an X server to WASM and run it in a browser?"*

Research findings:
- **Yes, but only as experiments.** `roozbehid/XServer` (a WASM fork of pelya's
  SDL-based `xserver-xsdl`) is the closest; it compiles an actual X server to WASM but
  is a rough proof-of-concept with no demo.
- The common *practical* approach is to **not** run the X server in the browser — run
  Xorg/Xvfb host-side and stream pixels (xpra-html5, noVNC). That's "VNC without the
  network" and exactly what we wanted to avoid.
- The interesting alternative — rendering X **straight to canvas** — exists only in the
  dead `GothAck/javascript-x-server` (xlogo/xeyes to canvas) and the educational
  `Xplain`. The honest blocker: X11's `MIT-SHM`/`RENDER` assumptions mean modern apps
  degrade to bitmap-blitting anyway.
- The live, maintained frontier is **Wayland in the browser**: `udevbe/greenfield`, an
  in-browser Wayland compositor (TS + WASM + WebGL) that can run WASM-compiled apps
  *directly in the page*.

**Decision:** pursue Greenfield (Wayland), not an X server. Goal: a hello-world WASM
app running in-browser with **no remote servers**.

## 1. Getting Greenfield running (a hello-world, client-side)

- Installed Node v24 locally (arm64) — no system Node.
- `yarn install` on the Greenfield monorepo.
- Discovered the native-WASM libs (xkbcommon/pixman, ffmpeg) are painful to build, so
  used the **prebuilt npm dist** for those and built everything else from source.
- Hit the **`initScene` API mismatch** (repo ahead of npm) → fixed by building TS libs
  from source.
- Hit the **WebGL failure** in headless Chromium → fixed with SwiftShader flags.
- Hit the **cross-origin `<base href>` bug** → fixed to absolute origin.
- **Result:** Weston's `simple-shm` (a TS Wayland client) rendering its rainbow circles
  in the in-browser compositor, launched via `web://`, fully client-side. Verified with
  a headless Chromium screenshot.

## 2. A *real* compiled-C WASM app

`simple-shm` is a TS port. The user wanted an actual compiled-C WASM app. This needed a
C→WASM toolchain:
- Built a **minimal SDK sysroot** — expat, libffi, wayland (+ native scanner),
  wayland-protocols (xdg-shell). (The full SDK incl. cairo/pango/gtk4 is hours; gtk4 is
  even marked "broken".)
- Wrote **`gf-hello.c`** (raw `wl_shm` + xdg-shell, hand-painted gradient + square).
- Debugged the **`PROXY_TO_PTHREAD`** problem: the app loaded but never created a
  window. Root cause: the connect handshake needs `window.parent`, absent in the pthread
  Worker. Fixed with the **main-thread build recipe** (no PROXY_TO_PTHREAD + ASYNCIFY).
- **Result:** a native C program, compiled to WASM, drawing into a Wayland surface in
  the browser. Verified by screenshot (gradient + orange square).

## 3. One server, buttons, static export

Reworked the multi-server setup into a single-origin **showcase** (`packages/showcase`):
- one vite app embedding the compositor with a **button toolbar** (no URL bar);
- TS samples as vite multi-page entries; C/WASM apps as static `public/` files;
- **100% static export** that works on header-less hosts via a bundled
  `coi-serviceworker.js`.
- Single origin also *removed* the cross-origin worker/CORP friction.
- Fixed the **blank-canvas-on-dynamic-resize** bug (fixed canvas resolution).

## 4. Window manager

The user asked to drag windows around. Greenfield's `floating` compositor mode is
already a window manager (stacking, focus, resize, move). The catch: Wayland has no
server-side title bars, so a window starts a move when the **client** issues
`xdg_toplevel.move`. Added `wl_pointer` → `xdg_toplevel.move` to the C clients, and to
the showcase's `simple-shm` copy. Dragging works.

## 5. Bundle slimming (the H.264 detour)

The user asked why ffmpeg/H.264 was in the mix. Answer: it's the **remote-app** (`rem://`)
video pipeline — decoding H.264-encoded framebuffers of native apps streamed from a
`compositor-proxy`. Not used by `web://` apps.

Measured it (correcting two wrong guesses along the way): the H.264 worker was a
separate 1.8 MB chunk but was being **downloaded anyway** because two decoder Workers
were created at module top-level. **Fixed** by making them lazy → web-only usage no
longer downloads them.

## 6. A Wayland eyes app (`eyes`)

Decided against **Skia** (multi-MB, wrong tool); chose hand-rasterization for now
(Cairo is the right next step). Wrote **`eyes.c`**: two anti-aliased eyes (2×2
supersampled into the `wl_shm` buffer) whose pupils follow the pointer via
`wl_pointer.motion`. Note the honest Wayland limitation: a client only gets pointer
events over its own surface, so the eyes track while the cursor is over the window.
(There's no standard protocol for the global pointer position — by design.)

## 7. Server-side decorations + xdg-decoration

The user wanted consistent titlebars/frames across all apps, with the `xdg-decoration`
protocol to avoid double decorations. Implemented in three phases:
1. **Protocol** — generated `xdg-decoration` bindings, implemented
   `XdgDecorationManager` forcing `server_side` mode (no double titlebars for
   CSD-capable clients).
2. **Rendering** — `render/Decoration.ts` rasterizes a titlebar (title + `×`) + border
   with Canvas2D, uploaded as a texture and drawn per-view *in the scene* (correct
   z-order). Active window = lighter titlebar.
3. **Input** — `Renderer.pickDecoration` + `Pointer.ts`: titlebar drag → `MoveGrab`;
   `×` → `requestClose()`.

## 8. The teardown fix

Close *looked* broken: the `×` correctly sent `xdg_toplevel.close`, the app exited — but
the window's pixels stayed. Traced it precisely: `Module.onExit` (which posts
`Terminate`) never fired because ASYNCIFY/pthreads keep the runtime alive after `main`
returns; and `MessagePort` has no close event. **Fixed** with `emscripten_force_exit(0)`
in the C apps (so `onExit`/`Terminate` fires) plus a `render()` in
`FloatingDesktopSurface.removed()`. Verified all four samples close cleanly.

## Where it ended up

A single-origin, statically-exportable in-browser Wayland desktop with four samples
(two of them native C compiled to WASM), a working floating window manager, and
consistent server-side decorations with working drag and close — all client-side, no
remote servers. See [ARCHITECTURE](ARCHITECTURE.md).

## Open threads / next steps

- **Cairo** in the SDK sysroot → richer vector/text apps (the agreed next step).
- A bigger app via the full sysroot (cairo/pango/glib) — a real GTK app (large effort).
- Code-split the compositor's own ~4.9 MB xkbcommon wasm out of the entry bundle for
  faster first paint.
- (Considered and declined: a custom global-pointer protocol — keeping things standard.)
