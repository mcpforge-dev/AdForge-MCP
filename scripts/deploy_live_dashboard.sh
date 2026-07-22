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

wait_for_url() {
  local url="$1"
  local output_file="${2:-/dev/null}"
  local attempt
  for attempt in {1..20}; do
    if curl --connect-timeout 5 --max-time 15 -fsS "$url" -o "$output_file"; then
      return 0
    fi
    sleep 2
  done
  fail "Endpoint did not become ready: ${url}"
}

wait_for_status() {
  local url="$1"
  local expected="$2"
  local attempt status
  for attempt in {1..20}; do
    status="$(curl --connect-timeout 5 --max-time 15 -sS -o /dev/null -w "%{http_code}" "$url" || true)"
    if [[ "$status" == "$expected" ]]; then
      return 0
    fi
    sleep 2
  done
  fail "Expected ${url} to return ${expected}, got ${status:-no response}."
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

echo "Restarting live services..."
for service in "$WEB_SERVICE" "$MCP_SERVICE"; do
  if ! sudo systemctl restart "$service"; then
    show_journal_summary "$service"
    fail "Restart failed for ${service}."
  fi
done

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
wait_for_url "${base_url}/health"
wait_for_url "${base_url}/ready"
wait_for_url "${base_url}/assets/app.js"
wait_for_url "${base_url}/assets/app.css"
wait_for_status "${base_url}/mcp" "401"

echo "Deploy check complete. Dashboard assets, readiness and protected MCP endpoint are reachable."
echo "Note: this script does not print env values, does not touch tokens/connections.json and does not overwrite OAuth credentials."
