#!/usr/bin/env bash
set -euo pipefail

echo "Preparing HolyMedia MCP workspace for OpenHands..."

cd "$(dirname "$0")/.."

python_cmd="${PYTHON:-python3}"

if ! command -v "$python_cmd" >/dev/null 2>&1; then
  echo "Python 3 is required for this repository." >&2
  exit 1
fi

if [ ! -d ".venv" ]; then
  "$python_cmd" -m venv .venv
fi

if [ -x ".venv/bin/python" ]; then
  venv_python=".venv/bin/python"
else
  venv_python="$python_cmd"
fi

"$venv_python" -m pip install --upgrade pip
"$venv_python" -m pip install -e ".[dev,google,meta,postgres,site-audit]"

if command -v node >/dev/null 2>&1; then
  node --check src/ad_mcp/web/static/app.js
else
  echo "Node.js is not installed; skipping app.js syntax check."
fi

"$venv_python" -m compileall src scripts

echo "HolyMedia MCP workspace is ready for agent work."

