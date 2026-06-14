# Build & rebuild guide

How every piece is built, and how to rebuild after changes. Commands assume the repo
the greenfield repo root and that Node is on `PATH`.

## Toolchain / environment

- **Node** v24 (arm64) installed under `~/.local/opt/`, symlinked into `~/.local/bin`
  (already on `PATH`). No system Node.
- **yarn** is pinned by the Greenfield repo and run via its bundled release:
  `node .yarn/releases/yarn-4.5.0.cjs <args>`. (Plain `yarn` is not on PATH.)
- **emscripten** (`emsdk` 3.1.46) lives at `libs/compositor-wasm/emsdk`;
  `sdk/emsdk` is a symlink to it.
- Native build tools used for the SDK sysroot: `meson`, `ninja`, `gcc`, plus
  `autoconf`/`automake`/`libtool` (installed via apt for expat/libffi).
- sudo password on this dev VM is `password` (local only).

## 1. The Greenfield workspace

```bash
# (from the greenfield repo root)
node .yarn/releases/yarn-4.5.0.cjs install
```

Two libraries are **native WASM** and painful to build (xkbcommon/pixman, ffmpeg):
we use the **prebuilt npm dist** for those instead of building from source —

- `@gfld/compositor-wasm` (xkbcommon + pixman, single-file-inlined wasm)
- `@gfld/compositor-ffmpeg-h264`

Their `dist/` was dropped into `libs/compositor-wasm/dist` and
`libs/compositor-ffmpeg-h264/dist` from npm `1.0.0-rc1`.

**Everything else is built from source** because the repo HEAD is ahead of the last
npm publish (the published `initScene` API was incompatible). Rebuild the TS libs:

```bash
# (from the greenfield repo root)
node .yarn/releases/yarn-4.5.0.cjs workspaces foreach -A --topological-dev \
  --exclude '@gfld/compositor-wasm' --exclude '@gfld/compositor-ffmpeg-h264' \
  --exclude '@gfld/example-*' --exclude '@gfld/compositor-shell' \
  --exclude '@gfld/compositor-proxy*' run build
```

To rebuild just the compositor after editing it:

```bash
node .yarn/releases/yarn-4.5.0.cjs workspace @gfld/compositor run build
```

### Adding a server protocol (e.g. xdg-decoration)

1. Drop the XML in `protocol/` (we copied `xdg-decoration-unstable-v1.xml`).
2. Add a `generate:<name>` script in `libs/compositor-protocol/package.json` and
   include it in `generate`.
3. Generate + barrel-export + build:
   ```bash
   cd libs/compositor-protocol
   node ../../.yarn/releases/yarn-4.5.0.cjs generate:xdgdecoration
   #   add `export * from './xdg_decoration_unstable_v1'` to src/protocol/index.ts
   node ../../.yarn/releases/yarn-4.5.0.cjs build
   ```
4. Implement the server class (see `packages/compositor/src/XdgDecorationManager.ts`)
   and register it in `Globals.ts`.

## 2. The C → WASM SDK sysroot

Built once into `sdk/sysroot/`. The full SDK (`sdk/build.sh`) compiles ~25
libraries incl. cairo/pango/gtk4 and takes hours; we built only the **4 minimal libs**
needed for a raw-`wl_shm` xdg-shell client:

```bash
cd sdk
export _SDK_DIR=$(pwd)
# emsdk: a symlink to the existing one is enough
ln -s ../libs/compositor-wasm/emsdk emsdk   # already done
# generate the toolchain ini files (build.sh does this):
printf '%s\n' "[constants]" "toolchain = '$_SDK_DIR/emsdk/upstream/emscripten'" > sysrootlibs/emscripten-toolchain.ini

bash sysrootlibs/expat/build.sh
bash sysrootlibs/libffi/build.sh        # then copy ffitarget.h/fficonfig.h (script's
                                        # trailing cp fails under set -e — see below)
bash sysrootlibs/wayland/build.sh       # native wayland-scanner + wasm libwayland-client
bash sysrootlibs/wayland-protocols/build.sh   # xdg-shell.xml etc.
```

libffi's `build.sh` exits nonzero on a trailing `cp` after the lib is already
installed; if `sysroot/include/ffitarget.h` is missing, copy it manually:

```bash
cp $(find sysrootlibs/libffi/repo -name ffitarget.h | head -1) sysroot/include/
cp $(find sysrootlibs/libffi/repo -name fficonfig.h | head -1) sysroot/include/
```

Result: `sysroot/lib/{libexpat,libffi,libwayland-client}.a`, headers, `xdg-shell.xml`,
and the native scanner at `build-sysroot/bin/wayland-scanner`.

**To add Cairo** (next step): build `pixman` then `cairo` (image backend, skip
freetype/fontconfig if no text) — `sdk/sysrootlibs/{pixman,cairo}/build.sh` exist.

## 3. A C → WASM app

See `examples/webapps/gf-hello-c/build.sh` (and `wl-eyes/build.sh`). The recipe:

```bash
# 1. generate xdg-shell client glue from XML
wayland-scanner client-header xdg-shell.xml generated/xdg-shell-client-protocol.h
wayland-scanner private-code  xdg-shell.xml generated/xdg-shell-protocol.c

# 2. compile with emcc — the MAIN-THREAD recipe (NOT the stock gfcc wrapper)
emcc \
  -sENVIRONMENT=web,worker -sEXIT_RUNTIME=1 \
  -sUSE_PTHREADS=1 -sPTHREAD_POOL_SIZE=0 \
  -sASYNCIFY -sASYNCIFY_IMPORTS=[__syscall_poll,_emscripten_receive_on_main_thread_js] \
  -sSTACK_SIZE=4MB \
  --js-library  $SDK/sysrootlibs/jslibraries/library_unixsockfs.js \
  --pre-js      $SDK/sysrootlibs/jslibraries/pre-main.js \
  --shell-file  $SDK/sysrootlibs/jslibraries/app_template.html \
  -O3 -pthread -msimd128 \
  -I$SYSROOT/include -Igenerated \
  src/app.c generated/xdg-shell-protocol.c \
  -L$SYSROOT/lib -lwayland-client -lffi -lm \
  -o dist/app.html
```

> **Do NOT use the stock `gfcc` wrapper.** It forces `-sPROXY_TO_PTHREAD`, which breaks
> `web://` apps. We run `main()` on the iframe main thread instead. The C source must
> also call `emscripten_force_exit(0)` at the end of `main()` so the window tears down
> on close. Both are explained in [GOTCHAS](GOTCHAS.md).

Output is `app.{html,js,wasm,worker.js}`. Copy it into the showcase's static dir:

```bash
cp dist/app.* ../../packages/showcase/public/<name>/
```

## 4. The showcase (single-origin app)

`packages/showcase/` is a vite multi-page app: the compositor shell
(`index.html` + `src/main.ts`) plus the TS samples as additional HTML entries, plus the
prebuilt C/WASM apps under `public/`.

```bash
cd packages/showcase
node ../../.yarn/releases/yarn-4.5.0.cjs start     # dev server, http://localhost:8080
node ../../.yarn/releases/yarn-4.5.0.cjs build     # -> dist/ (100% static export)
```

The static `dist/` works on any header-less static host thanks to
`public/coi-serviceworker.js`. Serve it with anything:

```bash
cd dist && python3 -m http.server 8090     # then open http://localhost:8090
```

## Run helpers (repo root)

- `./restart.sh` — frees port 8080 and starts the showcase dev server.
- `./open-browser.sh` — launches Chromium on this machine with SwiftShader flags +
  a snap-writable profile dir.
- `./serve-static.sh [port]` — `vite build` then serve `dist/` via plain python.

## Headless verification (`driver/`)

Uses the system Chromium (`/usr/bin/chromium-browser`) via Playwright/Puppeteer:

```bash
node packages/showcase/e2e/pw-showcase.js [http://localhost:8080/]   # launch samples, drag a window, screenshot
```

Always launch Chromium with SwiftShader flags on this GPU-less VM:
`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`.
