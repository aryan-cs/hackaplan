#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
API_BASE_URL="${API_BASE_URL:-http://localhost:${BACKEND_PORT}}"

backend_pid=""
frontend_pid=""

cleanup() {
  if [[ -n "${backend_pid}" ]] && kill -0 "${backend_pid}" 2>/dev/null; then
    kill "${backend_pid}" 2>/dev/null || true
  fi
  if [[ -n "${frontend_pid}" ]] && kill -0 "${frontend_pid}" 2>/dev/null; then
    kill "${frontend_pid}" 2>/dev/null || true
  fi
}

handle_shutdown_signal() {
  cleanup
  exit 0
}

trap cleanup EXIT
trap handle_shutdown_signal INT TERM

require_command() {
  local command_name="$1"
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Missing required command: ${command_name}" >&2
    exit 1
  fi
}

file_hash() {
  local file_path="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${file_path}" | awk '{print $1}'
    return
  fi
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "${file_path}" | awk '{print $1}'
    return
  fi
  echo "No supported hash tool found (sha256sum or shasum)." >&2
  exit 1
}

ensure_backend_env() {
  local requirements_hash
  local stored_hash
  local hash_file

  if [[ ! -d "${BACKEND_DIR}/.venv" ]]; then
    echo "Creating backend virtual environment..."
    python3 -m venv "${BACKEND_DIR}/.venv"
  fi

  if [[ ! -x "${BACKEND_DIR}/.venv/bin/pip" ]]; then
    echo "Backend virtual environment is not valid. Remove backend/.venv and retry." >&2
    exit 1
  fi

  hash_file="${BACKEND_DIR}/.venv/.requirements.sha256"
  requirements_hash="$(file_hash "${BACKEND_DIR}/requirements.txt")"
  stored_hash="$(cat "${hash_file}" 2>/dev/null || true)"

  if [[ "${requirements_hash}" != "${stored_hash}" ]]; then
    echo "Installing backend dependencies..."
    "${BACKEND_DIR}/.venv/bin/pip" install -r "${BACKEND_DIR}/requirements.txt"
    echo "${requirements_hash}" > "${hash_file}"
  fi
}

ensure_frontend_deps() {
  if [[ ! -d "${FRONTEND_DIR}/node_modules" ]] || [[ "${FRONTEND_DIR}/package-lock.json" -nt "${FRONTEND_DIR}/node_modules" ]] || [[ "${FRONTEND_DIR}/package.json" -nt "${FRONTEND_DIR}/node_modules" ]]; then
    echo "Installing frontend dependencies..."
    npm --prefix "${FRONTEND_DIR}" install
  fi
}

require_command "python3"
require_command "npm"

ensure_backend_env
ensure_frontend_deps

echo "Starting backend on http://localhost:${BACKEND_PORT}"
(
  cd "${BACKEND_DIR}"
  HACKAPLAN_CORS_ORIGINS="${HACKAPLAN_CORS_ORIGINS:-http://localhost:${FRONTEND_PORT}}" \
    "${BACKEND_DIR}/.venv/bin/uvicorn" app.main:app --host 0.0.0.0 --port "${BACKEND_PORT}"
) &
backend_pid=$!

echo "Starting frontend on http://localhost:${FRONTEND_PORT}"
(
  cd "${FRONTEND_DIR}"
  VITE_API_BASE_URL="${API_BASE_URL}" \
    VITE_ENABLE_LIVE_LOOKUPS="${VITE_ENABLE_LIVE_LOOKUPS:-true}" \
    npm run dev -- --host 0.0.0.0 --port "${FRONTEND_PORT}"
) &
frontend_pid=$!

echo "Both services are running."
echo "Frontend: http://localhost:${FRONTEND_PORT}"
echo "Backend:  http://localhost:${BACKEND_PORT}"
echo "Press Ctrl+C to stop both."

while true; do
  if ! kill -0 "${backend_pid}" 2>/dev/null; then
    echo "Backend process exited."
    exit 1
  fi
  if ! kill -0 "${frontend_pid}" 2>/dev/null; then
    echo "Frontend process exited."
    exit 1
  fi
  sleep 1
done
