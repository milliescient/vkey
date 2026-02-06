#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

usage() {
    echo "Usage: ./run.sh [server|client]"
    echo ""
    echo "  server  - Start the WebSocket server (on Linux remote)"
    echo "  client  - Start the tkinter client (on MacBook)"
    exit 1
}

run_server() {
    node "$SCRIPT_DIR/server/server.js"
}

run_client() {
    "$SCRIPT_DIR/client/.venv/bin/python" "$SCRIPT_DIR/client/client.py" "$@"
}

TARGET="${1:-}"
shift || true

case "$TARGET" in
    server) run_server ;;
    client) run_client "$@" ;;
    *)      usage ;;
esac