#!/usr/bin/env bash
# Start the Greenfield showcase dev server. Fully client-side, no remote servers.
# Node lives in ~/.local. ONE vite server hosts everything (compositor + all
# samples + the C/WASM apps) at http://localhost:8080 . Pick a sample with the
# toolbar buttons; drag a window by its titlebar to move it, click × to close.
set -e
export PATH="$HOME/.local/bin:$PATH"
ROOT="$(cd "$(dirname "$(realpath "$0")")" && pwd)"   # the greenfield repo root
YARN="node $ROOT/.yarn/releases/yarn-4.5.0.cjs"

echo "node: $(node --version)"

# free 8080 (kill by PORT — never `pkill -f` a pattern that matches this script)
for pid in $(fuser 8080/tcp 2>/dev/null); do kill -9 "$pid" 2>/dev/null; done
sleep 1

( cd "$ROOT/packages/showcase" && $YARN start > /tmp/showcase.log 2>&1 & )
echo "showcase -> http://localhost:8080  [log: /tmp/showcase.log]"

echo "waiting for server..."
for i in $(seq 1 40); do
  sleep 1
  if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://localhost:8080/ || true)" = "200" ]; then
    echo "READY: http://localhost:8080  (canvas mode)  ·  http://localhost:8080/dom.html  (DOM-windows mode)"
    echo "Open it (or run ./open-browser.sh), then click a sample button."
    echo "Headless verify: node packages/showcase/e2e/pw-showcase.js"
    exit 0
  fi
done
echo "server did not become ready; check /tmp/showcase.log"
exit 1
