#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
fail() { printf 'offsite-verify: ERROR: %s\n' "$1" >&2; exit 1; }
[[ $# -eq 1 ]] || fail 'usage: offsite-backup-verify.sh LOCAL_ARCHIVE'
archive="$1"
remote="${TASO_BACKUP_REMOTE:-}"
[[ -n "$remote" ]] || fail 'TASO_BACKUP_REMOTE is not configured'
[[ -f "$archive" && -f "$archive.sha256" && -f "$archive.meta" ]] || fail 'local archive or sidecars missing'
command -v rclone >/dev/null 2>&1 || fail 'rclone missing'
dir="$(cd "$(dirname "$archive")" && pwd)"
base="$(basename "$archive")"
[[ "$base" == taso-state-*.json.gz ]] || fail 'unexpected backup filename'
# Validate local source before trusting its reference digest.
"$(dirname "${BASH_SOURCE[0]}")/taso-backup-verify.sh" "$archive" >/dev/null || fail 'local archive integrity/schema invalid'
digest="$(awk 'NR==1 {print $1}' "$archive.sha256")"
[[ "$digest" =~ ^[0-9a-fA-F]{64}$ ]] || fail 'invalid local digest'
# A remote copy is never considered successful based solely on file existence.
# Read through rclone streaming; keep archive contents out of logs and disk.
remote_digest="$(rclone cat "${remote%/}/$base" | sha256sum | awk '{print $1}')" || fail 'remote archive unreadable'
[[ "$remote_digest" == "$digest" ]] || fail 'remote archive checksum mismatch'
remote_sidecar="$(rclone cat "${remote%/}/$base.sha256")" || fail 'remote checksum sidecar missing'
[[ "${remote_sidecar%% *}" == "$digest" ]] || fail 'remote checksum sidecar mismatch'
remote_meta="$(rclone cat "${remote%/}/$base.meta")" || fail 'remote metadata missing'
[[ "$remote_meta" == *"archive=$base"* && "$remote_meta" == *"sha256=$digest"* ]] || fail 'remote metadata mismatch'
printf 'offsite-verify: PASS archive_sha256=%s remote_archive=verified sidecars=verified\n' "$digest"
