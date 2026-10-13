#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf -- "$TMP"' EXIT
mkdir -p "$TMP/scripts" "$TMP/backups"
cp "$ROOT/scripts/taso-backup-freshness.sh" "$TMP/scripts/"
chmod +x "$TMP/scripts/taso-backup-freshness.sh"
cat > "$TMP/scripts/taso-backup-verify.sh" <<'VERIFY'
#!/usr/bin/env bash
[[ -f "$1.sha256" ]] || exit 1
[[ "$(cat "$1.sha256")" == pass ]]
VERIFY
chmod +x "$TMP/scripts/taso-backup-verify.sh"
check_pass() { "$TMP/scripts/taso-backup-freshness.sh" >/dev/null || { echo "FAIL: $1"; exit 1; }; echo "PASS: $1"; }
check_fail() { if "$TMP/scripts/taso-backup-freshness.sh" >/dev/null 2>&1; then echo "FAIL: $1"; exit 1; fi; echo "PASS: $1"; }
export TASO_BACKUP_DIR="$TMP/backups" TASO_BACKUP_MAX_AGE_SECONDS=90000
check_fail 'empty backups'
f="$TMP/backups/taso-state-20261013T000000Z-test.json.gz"
printf x > "$f"
printf pass > "$f.sha256"
check_pass 'recent verified backup'
printf fail > "$f.sha256"
check_fail 'corrupt backup rejected'
printf pass > "$f.sha256"
touch -d '4 days ago' "$f"
check_fail 'stale backup rejected'
touch "$f"
TASO_BACKUP_MAX_AGE_SECONDS=invalid check_fail 'invalid age rejected'
TASO_BACKUP_MAX_AGE_SECONDS=90000 check_pass 'valid backup after recovery'
