#!/usr/bin/env bash
# Destructive operations are restricted to the ephemeral test directory.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf -- "$TMP"' EXIT
mkdir -p "$TMP/state" "$TMP/backups"
# Checkout currently lacks executable mode for the verifier; restore invokes it directly.
# Prepare executable permission for this isolated drill without changing production scripts.
chmod +x "$ROOT/scripts/taso-backup-verify.sh"
export TASO_STATE_FILE="$TMP/state/taso-state.json"
export TASO_BACKUP_DIR="$TMP/backups"
archive="$TMP/backups/taso-state-test.json.gz"
python3 - "$TASO_STATE_FILE" "$TMP/restored.json" <<'PY'
import json,sys
fields=('projects','manifests','milestones','knowledge','missions','events','conversations')
for path,marker in zip(sys.argv[1:],('before','after')):
    data={field:[] for field in fields}
    data['projects']=[{'id':marker}]
    with open(path,'w',encoding='utf8') as f: json.dump(data,f)
PY
gzip -c "$TMP/restored.json" > "$archive"
(cd "$TMP/backups"; sha256sum "$(basename "$archive")" > "$(basename "$archive").sha256")
assert_marker() {
  python3 - "$TASO_STATE_FILE" "$1" <<'PY'
import json,sys
with open(sys.argv[1],encoding='utf8') as f: data=json.load(f)
assert data['projects'][0]['id']==sys.argv[2]
PY
}
reject() {
  if "$@" >"$TMP/cmd.log" 2>&1; then
    printf 'FAIL: unexpected success: %s\n' "$*" >&2; exit 1
  fi
}
bash "$ROOT/scripts/taso-backup-verify.sh" "$archive" > /dev/null
echo 'PASS valid backup verifies'
bash "$ROOT/scripts/taso-restore.sh" "$archive" >"$TMP/verify.log"
grep -q 'mode=verify-only' "$TMP/verify.log"
assert_marker before
echo 'PASS dry run leaves original state intact'
reject bash "$ROOT/scripts/taso-restore.sh" --apply "$archive"
assert_marker before
echo 'PASS apply is denied without approval interlock'
TASO_RESTORE_APPROVED=YES bash "$ROOT/scripts/taso-restore.sh" --apply "$archive" >"$TMP/apply.log"
grep -q 'mode=applied' "$TMP/apply.log"
assert_marker after
shopt -s nullglob
safety=("$TMP/backups"/pre-restore-*-taso-state.json.gz)
[[ ${#safety[@]} -eq 1 ]]
bash "$ROOT/scripts/taso-backup-verify.sh" "${safety[0]}" > /dev/null
gzip -dc "${safety[0]}" > "$TMP/safety.json"
python3 - "$TMP/safety.json" <<'PY'
import json,sys
with open(sys.argv[1],encoding='utf8') as f: data=json.load(f)
assert data['projects'][0]['id']=='before'
PY
echo 'PASS isolated restore and pre-restore safety backup'
cp "$TMP/restored.json" "$TMP/broken.json"
printf 'tampering' >> "$archive"
reject bash "$ROOT/scripts/taso-restore.sh" "$archive"
assert_marker after
echo 'PASS tampered archive rejected without state mutation'
echo 'restore-drill=PASS'
