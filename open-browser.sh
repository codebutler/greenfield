#!/usr/bin/env bash
# Open the Greenfield showcase in Chromium on this machine's GNOME desktop,
# forcing software WebGL (this QEMU VM's hardware GL is broken, and Greenfield
# renders via WebGL2). Then click a sample button in the toolbar.
export XDG_RUNTIME_DIR=/run/user/1000
export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus
export DISPLAY=:0

# close any prior instance so the profile lock is free
pkill -9 chromium 2>/dev/null; sleep 2
rm -f "$HOME/snap/chromium/common/chromium/Singleton"* 2>/dev/null

setsid chromium-browser --new-window \
  --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist \
  "http://localhost:8080" >/tmp/chromium-gui.log 2>&1 < /dev/null &

echo "Opened http://localhost:8080 — click a sample button in the toolbar."
echo "  http://localhost:8080            canvas mode (one WebGL canvas)"
echo "  http://localhost:8080/dom.html   DOM-windows mode (each window its own canvas)"
