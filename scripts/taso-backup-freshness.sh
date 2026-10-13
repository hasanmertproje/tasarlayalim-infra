#!/usr/bin/env bash
set -Eeuo pipefail

BACKUP_DIR="${TASO_BACKUP_DIR:-/backups/taso}"
MAX_AGE_SECONDS="${TASO_BACKUP_MAX_AGE_SECONDS:-90000}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

fail() { printf 'taso-backup-freshness: ERROR: %s\n' "$*" >&2; exit 1; }
[[ "$MAX_AGE_SECONDS" =~ ^[0-9]+$ ]] || fail 'TASO_BACKUP_MAX_AGE_SECONDS must be a non-negative integer'
[[ -d "$BACKUP_DIR" ]] || fail 'backup directory does not exist'

latest=''
latest_mtime=-1
while IFS= read -r -d '' file; do
  mtime="$(stat -c %Y -- "$file")" || fail 'could not stat archive'
  if (( mtime > latest_mtime )); then
    latest="$file"
    latest_mtime="$mtime"
  fi
done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'taso-state-*.json.gz' -print0)

[[ -n "$latest" ]] || fail 'no state archives found'
now="$(date -u +%s)"
age=$(( now - latest_mtime ))
(( age >= 0 )) || fail 'latest archive timestamp lies in the future'
(( age <= MAX_AGE_SECONDS )) || fail "latest backup is stale (age_seconds=${age}, limit_seconds=${MAX_AGE_SECONDS})"
"$SCRIPT_DIR/taso-backup-verify.sh" "$latest" >/dev/null || fail 'latest backup failed integrity/schema verification'
printf 'taso-backup-freshness: OK age_seconds=%s limit_seconds=%s integrity=verified\n' "$age" "$MAX_AGE_SECONDS"
