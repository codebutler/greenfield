#!/usr/bin/env bash
# Build eyes.c -> WebAssembly for Greenfield (web:// mode). Main-thread recipe
# (no -sPROXY_TO_PTHREAD; see examples/webapps/gf-hello-c/README.md for why).
set -e
cd "$(dirname "$(realpath -- "$0")")"

SDK="$(cd "$(dirname "$(realpath -- "$0")")/../../../sdk" && pwd)"
SYSROOT="$SDK/sysroot"
SCANNER="$SDK/build-sysroot/bin/wayland-scanner"
XDG_XML="$SYSROOT/share/wayland-protocols/stable/xdg-shell/xdg-shell.xml"
EMCC="$SDK/emsdk/upstream/emscripten/emcc"

mkdir -p generated dist
"$SCANNER" client-header "$XDG_XML" generated/xdg-shell-client-protocol.h
"$SCANNER" private-code  "$XDG_XML" generated/xdg-shell-protocol.c

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
  src/eyes.c generated/xdg-shell-protocol.c \
  -L"$SYSROOT/lib" -lwayland-client -lffi -lm \
  -o dist/eyes.html

echo "=== output ==="
ls -la dist/
