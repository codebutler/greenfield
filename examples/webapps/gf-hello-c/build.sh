#!/usr/bin/env bash
# Build gf-hello.c -> WebAssembly for Greenfield (runs in-browser as a web app).
# Output: dist/gf-hello.{html,js,wasm,worker.js}
#
# NOTE: we deliberately do NOT use the stock `gfcc` wrapper. gfcc forces
# -sPROXY_TO_PTHREAD (main runs in a Worker), which breaks Greenfield *web* apps:
# the app runs in a srcdoc iframe and the Wayland connect handshake must
# postMessage the MessagePort to window.parent, which only exists on the iframe
# main thread. So we run main() on the main thread (no PROXY_TO_PTHREAD,
# PTHREAD_POOL_SIZE=0) and rely on ASYNCIFY to yield the blocking
# wl_display_dispatch() loop back to the event loop. Pthreads stay enabled only
# for ABI compatibility with the -pthread-built sysroot libs.
set -e
cd "$(dirname "$(realpath -- "$0")")"

SDK="$(cd "$(dirname "$(realpath -- "$0")")/../../../sdk" && pwd)"
SYSROOT="$SDK/sysroot"
SCANNER="$SDK/build-sysroot/bin/wayland-scanner"
XDG_XML="$SYSROOT/share/wayland-protocols/stable/xdg-shell/xdg-shell.xml"
EMCC="$SDK/emsdk/upstream/emscripten/emcc"

mkdir -p generated dist

echo "=== generating xdg-shell protocol glue ==="
"$SCANNER" client-header "$XDG_XML" generated/xdg-shell-client-protocol.h
"$SCANNER" private-code  "$XDG_XML" generated/xdg-shell-protocol.c

echo "=== compiling to wasm (main-thread recipe) ==="
source "$SDK/emsdk/emsdk_env.sh" >/dev/null 2>&1
"$EMCC" \
  -sENVIRONMENT=web,worker -sEXIT_RUNTIME=1 \
  -sUSE_PTHREADS=1 -sPTHREAD_POOL_SIZE=0 \
  -sASYNCIFY -sASYNCIFY_IMPORTS=[__syscall_poll,_emscripten_receive_on_main_thread_js] -sSTACK_SIZE=4MB \
  --js-library "$SDK/sysrootlibs/jslibraries/library_unixsockfs.js" \
  --pre-js "$SDK/sysrootlibs/jslibraries/pre-main.js" \
  --shell-file "$SDK/sysrootlibs/jslibraries/app_template.html" \
  -O3 -pthread -msimd128 \
  -I"$SYSROOT/include" -Igenerated \
  src/gf-hello.c generated/xdg-shell-protocol.c \
  -L"$SYSROOT/lib" -lwayland-client -lffi \
  -o dist/gf-hello.html

echo "=== output ==="
ls -la dist/
