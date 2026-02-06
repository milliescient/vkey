#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "==> Creating Python venv..."
python3 -m venv .venv

echo "==> Activating venv and installing dependencies..."
source .venv/bin/activate
pip install -r requirements.txt

echo ""
echo "==> Client ready. Run with:"
echo "    source $SCRIPT_DIR/.venv/bin/activate && python3 $SCRIPT_DIR/client.py"
