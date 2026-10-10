#!/usr/bin/env bash
set -Eeuo pipefail

STATE_FILE="${TASO_STATE_FILE:-/data/taso-state.json}"
BACKUP_DIR="${TASO_BACKUP_DIR:-/backups/taso}"
RETENTION_DAYS="${TASO_BACKUP_RETENTION_DAYS:-14}"
REMOTE="${TASO_BACKUP_REMOTE:-}"
NOW="$(date -u +%Y%m%dT%H%M%SZ)"
HOST_TAG="$(hostname 2>/dev/null | tr -cs 'A-Za-z0-9._-' '_' | sed 's/^_*//;s/_*$//' || true)"
HOST_TAG="${HOST_TAG:-unknown-host}"
BASE="taso-state-${NOW}-${HOST_TAG}.json"
TMP_DIR=""

cleanup() {
  [[ -n "${TMP_DIR}" && -d "${TMP_DIR}" ]] && rm -rf -- "${TMP_DIR}"
}
trap cleanup EXIT

fail() {
  printf 'taso-backup: %s\n' "$*" >&2
  exit 1
}

[[ -f "${STATE_FILE}" ]] || fail "state file not found: ${STATE_FILE}"
[[ "${RETENTION_DAYS}" =~ ^[0-9]+$ ]] || fail "TASO_BACKUP_RETENTION_DAYS must be a non-negative integer"

mkdir -p -- "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}" 2>/dev/null || true
TMP_DIR="$(mktemp -d "${BACKUP_DIR}/.taso-backup.XXXXXX")"
SNAPSHOT="${TMP_DIR}/${BASE}"
ARCHIVE="${BACKUP_DIR}/${BASE}.gz"
CHECKSUM="${ARCHIVE}.sha256"
METADATA="${ARCHIVE}.meta"

# Core persists with temp-file + atomic rename. Opening the current inode here gives
# us a stable point-in-time snapshot even if Core saves a newer state concurrently.
cp -- "${STATE_FILE}" "${SNAPSHOT}"
chmod 600 "${SNAPSHOT}" 2>/dev/null || true

python3 - "${SNAPSHOT}" <<'PY'
import json, sys
path = sys.argv[1]
with open(path, 'r', encoding='utf-8') as handle:
    state = json.load(handle)
required = ('projects', 'manifests', 'milestones', 'knowledge', 'missions', 'events', 'conversations')
if not isinstance(state, dict):
    raise SystemExit('state root must be an object')
for key in required:
    if key not in state or not isinstance(state[key], list):
        raise SystemExit(f'missing or invalid state array: {key}')
PY

gzip -c -- "${SNAPSHOT}" > "${ARCHIVE}.tmp"
chmod 600 "${ARCHIVE}.tmp" 2>/dev/null || true
mv -f -- "${ARCHIVE}.tmp" "${ARCHIVE}"

(
  cd "${BACKUP_DIR}"
  sha256sum "$(basename "${ARCHIVE}")" > "$(basename "${CHECKSUM}").tmp"
  mv -f -- "$(basename "${CHECKSUM}").tmp" "$(basename "${CHECKSUM}")"
)
chmod 600 "${CHECKSUM}" 2>/dev/null || true

cat > "${METADATA}.tmp" <<EOF
created_at_utc=${NOW}
source=${STATE_FILE}
host=${HOST_TAG}
archive=$(basename "${ARCHIVE}")
sha256=$(awk '{print $1}' "${CHECKSUM}")
EOF
mv -f -- "${METADATA}.tmp" "${METADATA}"
chmod 600 "${METADATA}" 2>/dev/null || true

# Local retention is finite by policy. Sidecars are removed with their archive age.
if (( RETENTION_DAYS >= 0 )); then
  find "${BACKUP_DIR}" -maxdepth 1 -type f \
    \( -name 'taso-state-*.json.gz' -o -name 'taso-state-*.json.gz.sha256' -o -name 'taso-state-*.json.gz.meta' \) \
    -mtime "+${RETENTION_DAYS}" -delete
fi

# Off-server replication is opt-in and deliberately fails closed when configured.
# Example: TASO_BACKUP_REMOTE='r2:taso-production/backups'
if [[ -n "${REMOTE}" ]]; then
  command -v rclone >/dev/null 2>&1 || fail "TASO_BACKUP_REMOTE is configured but rclone is unavailable"
  rclone copyto -- "${ARCHIVE}" "${REMOTE%/}/$(basename "${ARCHIVE}")"
  rclone copyto -- "${CHECKSUM}" "${REMOTE%/}/$(basename "${CHECKSUM}")"
  rclone copyto -- "${METADATA}" "${REMOTE%/}/$(basename "${METADATA}")"
fi

printf '%s\n' "${ARCHIVE}"
