#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Check for tkinter (Homebrew Python needs: brew install python-tk@3.XX)
if ! python3 -c "import tkinter" 2>/dev/null; then
    echo "ERROR: tkinter not found."
    PY_VER=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
    echo ""
    echo "  If using Homebrew Python, run:"
    echo "    brew install python-tk@$PY_VER"
    echo ""
    echo "  Then re-run this script."
    exit 1
fi

echo "==> Creating Python venv..."
python3 -m venv .venv

echo "==> Activating venv and installing dependencies..."
source .venv/bin/activate
pip install -r requirements.txt

echo ""
echo "==> Client ready. Run with:"
echo "    source $SCRIPT_DIR/.venv/bin/activate && python3 $SCRIPT_DIR/client.py"
