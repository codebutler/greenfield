#!/usr/bin/env bash
# Build the showcase as a 100% static site and serve the dist/ folder with a
# DUMB static server (no COOP/COEP headers) to prove the export works anywhere.
# The bundled coi-serviceworker.js makes the page cross-origin isolated itself.
set -e
export PATH="$HOME/.local/bin:$PATH"
ROOT="$(cd "$(dirname "$(realpath "$0")")" && pwd)"   # the greenfield repo root
SHOWCASE="$ROOT/packages/showcase"
YARN="node $ROOT/.yarn/releases/yarn-4.5.0.cjs"
PORT="${1:-8090}"

echo "=== building static export ==="
( cd "$SHOWCASE" && $YARN build )

for pid in $(fuser ${PORT}/tcp 2>/dev/null); do kill -9 "$pid" 2>/dev/null; done
echo "=== serving $SHOWCASE/dist on http://localhost:${PORT} (plain static, no special headers) ==="
cd "$SHOWCASE/dist"
exec python3 -m http.server "$PORT" --bind 127.0.0.1
