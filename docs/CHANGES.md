# Changes vs. upstream Greenfield

`greenfield/` is a clone of https://github.com/udevbe/greenfield. This lists exactly
what we added or modified, grouped by feature. (Generated from `git status`; build
output, `node_modules`, `emsdk`, the SDK `sysroot/`, and generated dirs are excluded.)

## New top-level projects (ours)

| Path | What |
|---|---|
| `packages/showcase/` | The single-origin showcase app (compositor + button picker + static export) |
| `examples/webapps/gf-hello-c/` | "Hello world" Wayland client in C → WASM |
| `examples/webapps/wl-eyes/` | Wayland eyes app in C → WASM |

## Single-origin WASM apps (`web://`) + base-href fix

| File | Change |
|---|---|
| `packages/compositor/src/web/WebAppLauncher.ts` | Inject an **absolute** `<base href>` (`${url.origin}${dirPath}`) so cross-origin web apps' relative scripts load. (Also where `Connect`/`Terminate` are handled.) |
| `examples/webapps/simple-shm/vite.config.ts` | Port 9002 + COOP/COEP/CORP/CORS headers (for the original multi-server demo; superseded by the showcase) |
| `packages/compositor-shell/vite.config.ts` | (Now-unused) middleware that served gf-hello before the showcase existed; left as-is |

## Lazy H.264 decoder (bundle slimming)

| File | Change |
|---|---|
| `packages/compositor/src/remote/wasm-buffer-decoder.ts` | The two H.264 wasm decoder Workers were created at module top-level (downloaded even in `web://`-only mode). Made lazy (`getOpaqueWorker`/`getAlphaWorker`, created on first real decode). |

## xdg-decoration protocol (standard)

| File | Change |
|---|---|
| `protocol/xdg-decoration-unstable-v1.xml` | (new) copied from wayland-protocols |
| `libs/compositor-protocol/package.json` | added `generate:xdgdecoration` step |
| `libs/compositor-protocol/src/protocol/xdg_decoration_unstable_v1.ts` | (new) generated binding |
| `libs/compositor-protocol/src/protocol/index.ts` | barrel-export the new binding |
| `packages/compositor/src/XdgDecorationManager.ts` | (new) implements `zxdg_decoration_manager_v1`; forces `server_side` mode |
| `packages/compositor/src/Globals.ts` | construct + register the decoration manager global |

## Server-side decorations (rendering + input)

| File | Change |
|---|---|
| `packages/compositor/src/render/Decoration.ts` | (new) Canvas2D → texture titlebar/frame; per-scene texture; `hitTest()` |
| `packages/compositor/src/render/SceneShader.ts` | `drawTexture(texture, transform)` — draw an arbitrary textured quad |
| `packages/compositor/src/render/Scene.ts` | draw each view's decoration in `renderView` |
| `packages/compositor/src/render/Renderer.ts` | `pickDecoration()` — front-to-back titlebar hit-test |
| `packages/compositor/src/View.ts` | `decoration?` field; `setInitialPosition` adds titlebar margin + cascade |
| `packages/compositor/src/Pointer.ts` | intercept titlebar press → drag (`MoveGrab`) or close (`requestClose` + flush) |
| `packages/compositor/src/desktop/Desktop.ts` | `DesktopSurface` interface: `startInteractiveMove()`, `requestClose()` |
| `packages/compositor/src/desktop/FloatingDesktopSurface.ts` | create/update decoration; `startInteractiveMove`/`requestClose`; `removed()` now also `render()`s |
| `packages/compositor/src/desktop/AlwaysFullScreenDesktopSurface.ts` | implement the two new interface methods (no-op move) |

## DOM-windows display mode (alternative frontend)

| File | Change |
|---|---|
| `packages/compositor/src/UserShellApi.ts` | new `surfaceContentUpdated` event; `pointerMotion`/`pointerLeave`/`notifyKey` actions (direct input delivery) |
| `packages/compositor/src/render/Renderer.ts` | emit `surfaceContentUpdated` from `updateRenderStatesPixelContent` |
| `packages/compositor/src/Pointer.ts` | `forwardLocalMotion`/`forwardLocalLeave` — deliver pointer events to a known surface at local coords (bypass pickView) |
| `packages/showcase/dom.html`, `src/dom.ts`, `src/dom.css` | (new) the DOM-windows shell — each top-level surface becomes a DOM `<div>` + `<canvas>`; forwards pointer motion + keyboard |
| `packages/showcase/vite.config.ts`, `index.html` | add the `dom` build entry + a mode link |

## Prebuilt native-wasm dist (not in git — dropped in)

`libs/compositor-wasm/dist/` and `libs/compositor-ffmpeg-h264/dist/` contain the
**prebuilt npm `1.0.0-rc1`** dist (xkbcommon/pixman/ffmpeg, wasm single-file-inlined),
used instead of building those from source. See `docs/BUILD.md`.

## SDK sysroot (not in git — built locally)

`sdk/sysroot/` (+ `sdk/build-sysroot/`, `sdk/emsdk` symlink) were built from the SDK's
per-lib `build.sh` scripts: expat, libffi, wayland, wayland-protocols. See `docs/BUILD.md`.

## Notes

- The showcase's `simple-shm` copy (`packages/showcase/samples/simple-shm/src/index.ts`)
  has the **pointer → `xdg_toplevel.move`** drag support added; the original
  `examples/webapps/simple-shm/src/index.ts` is unchanged.
- `yarn.lock` changed from `yarn install` (added the showcase workspace + deps).
