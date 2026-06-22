#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="/opt/adforge-mcp"
WEB_SERVICE="adforge-mcp-web"
MCP_SERVICE="adforge-mcp-http"
NGINX_SERVICE="nginx"
DEFAULT_BASE_URL="https://77.240.38.131.sslip.io"
ENV_FILE="/etc/adforge-mcp/adforge-mcp.env"

redact() {
  sed -E \
    -e 's/(Authorization:[[:space:]]*Bearer[[:space:]]+)[^[:space:]]+/\1<redacted>/Ig' \
    -e 's/((access_token|refresh_token|client_secret|app_secret|developer_token|beta_token)[=:][[:space:]]*)[^[:space:]"'\''&]+/\1<redacted>/Ig'
}

show_journal_summary() {
  local service="$1"
  echo "---- redacted journal summary: ${service} ----"
  sudo journalctl -u "$service" -n 80 --no-pager 2>/dev/null | redact || true
}

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

echo "HolyMedia MCP live dashboard deploy"

if [[ "$(pwd -P)" != "$PROJECT_DIR" ]]; then
  echo "WARNING: current directory is not ${PROJECT_DIR}; switching to ${PROJECT_DIR}."
  cd "$PROJECT_DIR" || fail "Project directory ${PROJECT_DIR} is not available."
fi

[[ -d .git ]] || fail "No git repository found in ${PROJECT_DIR}."

if ! git diff --quiet || ! git diff --cached --quiet; then
  git status --short
  fail "Working tree is dirty. Commit, stash or inspect local changes before deploy."
fi

echo "Fetching origin/main..."
git fetch origin main

local_head="$(git rev-parse HEAD)"
remote_head="$(git rev-parse origin/main)"
base_head="$(git merge-base HEAD origin/main)"

if [[ "$local_head" != "$remote_head" && "$local_head" != "$base_head" ]]; then
  fail "Local branch cannot fast-forward to origin/main. Resolve divergence manually."
fi

echo "Applying fast-forward pull..."
git pull --ff-only origin main
echo "Current commit: $(git rev-parse --short HEAD)"

echo "Restarting ${WEB_SERVICE} only..."
if ! sudo systemctl restart "$WEB_SERVICE"; then
  show_journal_summary "$WEB_SERVICE"
  fail "Restart failed for ${WEB_SERVICE}."
fi

for service in "$WEB_SERVICE" "$MCP_SERVICE" "$NGINX_SERVICE"; do
  if sudo systemctl is-active --quiet "$service"; then
    echo "OK: ${service} is active."
  else
    echo "ERROR: ${service} is not active."
    show_journal_summary "$service"
    exit 1
  fi
done

base_url="$DEFAULT_BASE_URL"
if [[ -r "$ENV_FILE" ]]; then
  configured_url="$(awk -F= '$1=="AD_MCP_PUBLIC_BASE_URL" {print $2}' "$ENV_FILE" | tail -n 1)"
  configured_url="${configured_url#\"}"
  configured_url="${configured_url%\"}"
  configured_url="${configured_url#\'}"
  configured_url="${configured_url%\'}"
  if [[ -n "${configured_url:-}" ]]; then
    base_url="$configured_url"
  fi
fi
base_url="${base_url%/}"

echo "Checking public endpoints at ${base_url}..."
curl -fsS "${base_url}/health" >/dev/null
curl -fsS "${base_url}/ready" >/dev/null
curl -fsS "${base_url}/assets/app.js" >/dev/null
curl -fsS "${base_url}/assets/app.css" >/dev/null

echo "Deploy check complete. Dashboard assets and readiness endpoints are reachable."
echo "Note: this script does not print env values, does not touch tokens/connections.json and does not overwrite OAuth credentials."
