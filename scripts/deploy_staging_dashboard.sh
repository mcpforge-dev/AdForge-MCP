#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="/opt/adforge-mcp-staging"
SERVICE_USER="adforge"
WEB_SERVICE="adforge-mcp-staging-web"
MCP_SERVICE="adforge-mcp-staging-http"
NGINX_SERVICE="nginx"
DEFAULT_BASE_URL="https://staging-mcp.holymedia.kz"
ENV_FILE="/etc/adforge-mcp/adforge-mcp-staging.env"
TARGET_REF="${1:-origin/main}"

redact() {
  sed -E \
    -e 's/(Authorization:[[:space:]]*Bearer[[:space:]]+)[^[:space:]]+/\1<redacted>/Ig' \
    -e 's/((access_token|refresh_token|client_secret|app_secret|developer_token|beta_token|web_api_token|smtp_password|database_url)[=:][[:space:]]*)[^[:space:]"'\''&]+/\1<redacted>/Ig'
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

echo "HolyMedia MCP staging deploy"
echo "Target ref: ${TARGET_REF}"

if [[ "$EUID" -ne 0 ]]; then
  fail "Run this script as root with sudo so git/pip can run as ${SERVICE_USER} and systemd can be restarted."
fi

if [[ "$(pwd -P)" != "$PROJECT_DIR" ]]; then
  echo "WARNING: current directory is not ${PROJECT_DIR}; switching to ${PROJECT_DIR}."
  cd "$PROJECT_DIR" || fail "Project directory ${PROJECT_DIR} is not available."
fi

[[ -d .git ]] || fail "No git repository found in ${PROJECT_DIR}."

run_as_service_user() {
  sudo -u "$SERVICE_USER" "$@"
}

if ! run_as_service_user git diff --quiet || ! run_as_service_user git diff --cached --quiet; then
  run_as_service_user git status --short
  fail "Working tree is dirty. Commit, stash or inspect local changes before deploy."
fi

echo "Fetching origin..."
run_as_service_user git fetch origin --prune

target_commit="$(run_as_service_user git rev-parse --verify "${TARGET_REF}^{commit}")" || fail "Cannot resolve target ref ${TARGET_REF}."
echo "Checking out staging commit: ${target_commit:0:12}"
run_as_service_user git checkout --detach "$target_commit"

echo "Installing Python package in staging virtualenv..."
run_as_service_user ./.venv/bin/python -m pip install -e ".[google,meta]"

echo "Restarting staging services..."
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

echo "Checking public staging endpoints at ${base_url}..."
ready_file="$(mktemp)"
trap 'rm -f "$ready_file"' EXIT

curl -fsS "${base_url}/health" >/dev/null
curl -fsS "${base_url}/ready" -o "$ready_file"
curl -fsS "${base_url}/assets/app.js" >/dev/null
curl -fsS "${base_url}/assets/app.css" >/dev/null

if ! grep -q '"preview_only"' "$ready_file"; then
  fail "/ready response does not include preview_only diagnostics."
fi

mcp_status="$(curl -sS -o /dev/null -w "%{http_code}" "${base_url}/mcp")"
if [[ "$mcp_status" != "401" ]]; then
  fail "Expected ${base_url}/mcp without token to return 401, got ${mcp_status}."
fi

echo "Staging deploy check complete. Health, readiness, assets and protected MCP endpoint are reachable."
echo "Note: this script does not print env values, does not touch live services and does not overwrite OAuth credentials."
