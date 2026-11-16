#!/usr/bin/env bash
# Boots a virtual X display, VNC + noVNC, and the comπle Editor.
# Open http://localhost:${NOVNC_PORT}/ in a browser to use the IDE.
set -euo pipefail

: "${DISPLAY:=:99}"
: "${SCREEN_GEOMETRY:=1920x1080x24}"
: "${NOVNC_PORT:=6080}"
: "${VNC_PORT:=5900}"
: "${WORKSPACE:=/home/ide/workspace}"
: "${APP_RESTART:=true}"     # relaunch the IDE if the window is closed
: "${EXTRA_APP_ARGS:=}"

APP=/opt/compile-editor/compile-editor
log() { echo "[entrypoint] $*"; }

cleanup() {
  log "shutting down"
  jobs -p | xargs -r kill 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Stale lock from a previous unclean shutdown
rm -f "/tmp/.X${DISPLAY#:}-lock" "/tmp/.X11-unix/X${DISPLAY#:}" 2>/dev/null || true

log "starting Xvfb on ${DISPLAY} (${SCREEN_GEOMETRY})"
Xvfb "${DISPLAY}" -screen 0 "${SCREEN_GEOMETRY}" -ac -nolisten tcp +extension RANDR &
for _ in $(seq 1 50); do [ -e "/tmp/.X11-unix/X${DISPLAY#:}" ] && break; sleep 0.1; done

# Session D-Bus silences Chromium warnings and lets libnotify work
eval "$(dbus-launch --sh-syntax)"
export DBUS_SESSION_BUS_ADDRESS

openbox &

VNC_AUTH=(-nopw)
if [ -n "${VNC_PASSWORD:-}" ]; then
  mkdir -p "$HOME/.vnc"
  x11vnc -storepasswd "${VNC_PASSWORD}" "$HOME/.vnc/passwd" >/dev/null
  VNC_AUTH=(-rfbauth "$HOME/.vnc/passwd")
else
  log "WARNING: VNC_PASSWORD not set — the IDE is reachable without a password"
fi

# VNC only listens on loopback; the browser reaches it through websockify.
x11vnc -display "${DISPLAY}" -rfbport "${VNC_PORT}" -localhost -forever -shared \
       -noxdamage -quiet "${VNC_AUTH[@]}" &

log "noVNC on http://0.0.0.0:${NOVNC_PORT}/"
websockify --web /usr/share/novnc "${NOVNC_PORT}" "localhost:${VNC_PORT}" >/dev/null 2>&1 &

# --no-sandbox:          Chromium's sandbox needs privileges containers don't grant
# --password-store=basic: no GNOME keyring here; safeStorage falls back to a
#                         local key so API-key storage still works
# --disable-dev-shm-usage: avoid crashes when /dev/shm is small
APP_ARGS=(--no-sandbox --disable-gpu --disable-dev-shm-usage --password-store=basic)

run_app() {
  cd "${WORKSPACE}"
  # shellcheck disable=SC2086
  "${APP}" "${APP_ARGS[@]}" ${EXTRA_APP_ARGS} || true
}

if [ "${APP_RESTART}" = "true" ]; then
  while true; do
    log "launching comπle Editor"
    run_app
    log "IDE exited — restarting in 2s (set APP_RESTART=false to disable)"
    sleep 2
  done
else
  run_app
fi
