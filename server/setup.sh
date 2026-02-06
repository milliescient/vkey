#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "==> Installing server dependencies..."
npm install

echo ""
echo "==> Server ready. Run with:"
echo "    node $SCRIPT_DIR/server.js"
