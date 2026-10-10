#!/usr/bin/env bash
set -Eeuo pipefail

STATE_FILE="${TASO_STATE_FILE:-/data/taso-state.json}"
BACKUP_DIR="${TASO_BACKUP_DIR:-/backups/taso}"
APPLY=0
ARCHIVE=""

fail() {
  printf 'taso-restore: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage:
  taso-restore.sh /path/to/taso-state-....json.gz
  taso-restore.sh --apply /path/to/taso-state-....json.gz

Without --apply this command only verifies the backup and reports the target.
Applying a restore is HIGH IMPACT: stop/drain Taso Core first, obtain explicit
production approval, then run with --apply. The current state is safety-backed-up
before replacement.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    --*) fail "unknown option: $1" ;;
    *) [[ -z "${ARCHIVE}" ]] || fail "only one backup archive may be supplied"; ARCHIVE="$1"; shift ;;
  esac
done

[[ -n "${ARCHIVE}" ]] || { usage >&2; exit 2; }
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"${SCRIPT_DIR}/taso-backup-verify.sh" "${ARCHIVE}"

printf 'target=%s\n' "${STATE_FILE}"
printf 'archive=%s\n' "${ARCHIVE}"

if (( APPLY == 0 )); then
  printf '%s\n' 'mode=verify-only'
  printf '%s\n' 'restore NOT applied; use --apply only after explicit production approval and Core drain/stop'
  exit 0
fi

[[ "${TASO_RESTORE_APPROVED:-}" == "YES" ]] || fail "refusing HIGH IMPACT restore: set TASO_RESTORE_APPROVED=YES after explicit approval"

mkdir -p -- "$(dirname "${STATE_FILE}")" "${BACKUP_DIR}"
chmod 700 "$(dirname "${STATE_FILE}")" 2>/dev/null || true
chmod 700 "${BACKUP_DIR}" 2>/dev/null || true

NOW="$(date -u +%Y%m%dT%H%M%SZ)"
SAFETY=""
if [[ -f "${STATE_FILE}" ]]; then
  SAFETY="${BACKUP_DIR}/pre-restore-${NOW}-taso-state.json.gz"
  gzip -c -- "${STATE_FILE}" > "${SAFETY}.tmp"
  mv -f -- "${SAFETY}.tmp" "${SAFETY}"
  chmod 600 "${SAFETY}" 2>/dev/null || true
  (
    cd "${BACKUP_DIR}"
    sha256sum "$(basename "${SAFETY}")" > "$(basename "${SAFETY}").sha256"
  )
  chmod 600 "${SAFETY}.sha256" 2>/dev/null || true
fi

TMP="${STATE_FILE}.restore.$$"
cleanup() { rm -f -- "${TMP}"; }
trap cleanup EXIT

gzip -dc -- "${ARCHIVE}" > "${TMP}"
chmod 600 "${TMP}" 2>/dev/null || true

python3 - "${TMP}" <<'PY'
import json, sys
with open(sys.argv[1], 'r', encoding='utf-8') as handle:
    state = json.load(handle)
required = ('projects', 'manifests', 'milestones', 'knowledge', 'missions', 'events', 'conversations')
if not isinstance(state, dict) or any(not isinstance(state.get(key), list) for key in required):
    raise SystemExit('restored state schema validation failed')
PY

# Same atomic replacement pattern used by Core's JsonStateStore.
mv -f -- "${TMP}" "${STATE_FILE}"
trap - EXIT

printf '%s\n' 'mode=applied'
[[ -n "${SAFETY}" ]] && printf 'pre_restore_backup=%s\n' "${SAFETY}"
printf '%s\n' 'restart Core and verify /health plus project/mission state before reopening traffic'
