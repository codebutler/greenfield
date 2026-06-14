# gf-hello — a compiled-C Wayland client running as WASM in the browser

A minimal "hello world" Wayland client written in C (`src/gf-hello.c`), compiled
to WebAssembly with the Greenfield SDK, and run **directly in the browser**
inside the in-browser Greenfield Wayland compositor. No remote server.

It uses only `libwayland-client` + `xdg-shell` + raw `wl_shm` (no cairo/toolkit):
it allocates a shared-memory buffer, paints a gradient + white cross + orange
square into it, and presents it as an `xdg_toplevel` window.

## Build

Prereqs (built once into `../../../sdk/sysroot`): `expat`, `libffi`, `wayland`,
`wayland-protocols` — the 4 minimal SDK sysroot libs. See `sdk/sysrootlibs/*/build.sh`.

```
bash build.sh        # wayland-scanner + emcc -> dist/gf-hello.{html,js,wasm,worker.js}
```

NOTE: `build.sh` uses the stock `gfcc` wrapper which forces `-sPROXY_TO_PTHREAD`
(main runs in a pthread Worker). That does NOT work for a Greenfield **web** app:
the app runs in a `srcdoc` iframe, and the Wayland connect handshake must
`postMessage` the MessagePort to `window.parent`, which only exists on the iframe
main thread. The Worker has no `window.parent`, so the handshake never fires and
no window appears.

The **working** build runs `main()` on the iframe main thread instead — drop
`-sPROXY_TO_PTHREAD`, set `-sPTHREAD_POOL_SIZE=0`, keep `-sASYNCIFY`
(`__syscall_poll` is async-unwound so the blocking `wl_display_dispatch` loop
yields to the event loop without a Worker). Pthreads stay enabled only for ABI
compatibility with the `-pthread`-built sysroot libs. This is what produced
`dist/` (see the emcc invocation in the project notes / STATUS.md).

## Run (fully client-side, no remote server)

The app's pthread-capable build is cross-origin-isolated and (for any future
Worker use) must be **same-origin** with the compositor. So it is served from the
compositor's own origin via a small vite middleware in
`packages/compositor-shell/vite.config.ts` at `/gfapp/`.

1. `../../../.. /restart.sh` (or start `compositor-shell`)
2. Open http://localhost:8080
3. Type `web://localhost:8080/gfapp/gf-hello.html` and press Enter.
