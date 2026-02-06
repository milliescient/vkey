#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

usage() {
    echo "Usage: ./setup.sh [server|client|all]"
    echo ""
    echo "  server  - Install Node.js deps (run on Linux remote)"
    echo "  client  - Create Python venv + install deps (run on MacBook)"
    echo "  all     - Both"
    exit 1
}

setup_server() {
    echo "==============================="
    echo "  Setting up server"
    echo "==============================="
    bash "$SCRIPT_DIR/server/setup.sh"
    echo ""
}

setup_client() {
    echo "==============================="
    echo "  Setting up client"
    echo "==============================="
    bash "$SCRIPT_DIR/client/setup.sh"
    echo ""
}

TARGET="${1:-all}"

case "$TARGET" in
    server) setup_server ;;
    client) setup_client ;;
    all)    setup_server; setup_client ;;
    *)      usage ;;
esac

echo "Done."
