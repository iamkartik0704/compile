#!/usr/bin/env bash
# Smoke-test a built runtime image:
#   - container becomes healthy (noVNC serving + IDE process alive)
#   - IDE stays up (didn't crash after first paint)
#   - toolchains the IDE shells out to are present
#
# Usage: docker/smoke-test.sh <image[:tag]> [timeout-seconds]
set -euo pipefail

IMAGE="${1:?usage: $0 <image> [timeout]}"
TIMEOUT="${2:-120}"
NAME="compile-ide-smoke-$$-${RANDOM}"

cleanup() {
  status=$?
  if [ $status -ne 0 ]; then
    echo "──── container logs ────"
    docker logs "$NAME" 2>&1 | tail -n 200 || true
  fi
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  exit $status
}
trap cleanup EXIT

echo "▶ starting $IMAGE as $NAME"
docker run -d --name "$NAME" --shm-size=1g -e APP_RESTART=false -p 127.0.0.1::6080 "$IMAGE" >/dev/null

echo "▶ waiting up to ${TIMEOUT}s for healthy status"
deadline=$((SECONDS + TIMEOUT))
while :; do
  state=$(docker inspect -f '{{.State.Status}}' "$NAME")
  health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$NAME")
  [ "$state" != "running" ] && { echo "✗ container exited (state=$state)"; exit 1; }
  [ "$health" = "healthy" ] && break
  [ $SECONDS -ge $deadline ] && { echo "✗ timed out (health=$health)"; exit 1; }
  sleep 3
done
echo "✓ healthy"

echo "▶ checking the IDE survives 15s"
sleep 15
docker exec "$NAME" pgrep -x compile-editor >/dev/null \
  || { echo "✗ IDE process died"; exit 1; }
echo "✓ IDE running"

echo "▶ noVNC reachable from host"
port=$(docker port "$NAME" 6080/tcp | head -n1 | awk -F: '{print $NF}')
curl -fsS "http://127.0.0.1:${port}/vnc.html" >/dev/null || { echo "✗ noVNC not reachable on :$port"; exit 1; }
echo "✓ noVNC on :$port"

echo "▶ toolchains"
docker exec "$NAME" bash -lc '
  set -e
  g++ --version | head -n1
  gdb --version | head -n1
  clangd --version | head -n1
  python --version
  python -c "import debugpy; print(\"debugpy\", debugpy.__version__)"
  javac -version
  node --version
  git --version
'
echo "✓ smoke test passed"
