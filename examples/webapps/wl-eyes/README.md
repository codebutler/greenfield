# wl-eyes — a Wayland eyes app in C, compiled to WebAssembly

A native Wayland client written in C (`src/eyes.c`), compiled to WebAssembly with the
Greenfield SDK, running **directly in the browser** inside the in-browser Greenfield
Wayland compositor. No proxy, no h264 — pure `wl_shm` + `xdg-shell` +
`wl_pointer`.

Two anti-aliased eyes (2×2 supersampled into the shared-memory buffer) whose pupils
follow the pointer.

## Wayland note

A Wayland client only receives pointer events **while the cursor is over its own
surface** (the security model — there is no global pointer like X11's). So the eyes
track the cursor when it is over the window, and freeze at the last position when it
leaves. There is no standard Wayland protocol to read the global pointer position.

## What it demonstrates

- a real native C Wayland client running as WASM in the page;
- `wl_pointer` input → both pupil tracking (`motion`) and window dragging
  (left-press → `xdg_toplevel_move`);
- a double-buffered `wl_shm` redraw loop driven by pointer motion;
- clean teardown on close via `emscripten_force_exit(0)` (so the compositor removes the
  window — see the project `docs/GOTCHAS.md`).

## Build

Prereqs: the minimal SDK sysroot (`expat`, `libffi`, `wayland`, `wayland-protocols`)
built into `../../../sdk/sysroot` — see the project `docs/BUILD.md`.

```bash
bash build.sh        # wayland-scanner + emcc -> dist/eyes.{html,js,wasm,worker.js}
```

`build.sh` uses the **main-thread** emcc recipe (no `-sPROXY_TO_PTHREAD`); that is
required for Greenfield `web://` apps — see `../gf-hello-c/README.md` and
`docs/GOTCHAS.md` for why.

## Run

It's wired into the showcase as the **eyes** button. Its prebuilt output is vendored at
`packages/showcase/public/eyes/`. To update it there after a rebuild:

```bash
cp dist/eyes.* ../../../packages/showcase/public/eyes/
```

Then `./restart.sh` (repo root) and click **eyes** in the toolbar.
