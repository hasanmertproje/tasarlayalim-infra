#!/usr/bin/env bash
set -Eeuo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT
mkdir -p "$tmp/local" "$tmp/remote" "$tmp/bin"
python3 - "$tmp/state.json" <<'PY'
import json,sys
fields=('projects','manifests','milestones','knowledge','missions','events','conversations')
with open(sys.argv[1],'w') as f: json.dump({k:[] for k in fields},f)
PY
base=taso-state-20261013T000000Z-test.json.gz
gzip -c "$tmp/state.json" > "$tmp/local/$base"
(cd "$tmp/local"; sha256sum "$base" > "$base.sha256")
digest="$(awk '{print $1}' "$tmp/local/$base.sha256")"
printf 'archive=%s\nsha256=%s\n' "$base" "$digest" > "$tmp/local/$base.meta"
cp "$tmp/local/$base"* "$tmp/remote/"
cat > "$tmp/bin/rclone" <<'STUB'
#!/usr/bin/env bash
[[ "$1" == cat ]] || exit 2
file="${2#test:}"
cat -- "$file"
STUB
chmod +x "$tmp/bin/rclone"
export PATH="$tmp/bin:$PATH" TASO_BACKUP_REMOTE="test:$tmp/remote"
check_ok(){ bash "$root/scripts/taso-offsite-backup-verify.sh" "$tmp/local/$base" >/dev/null || exit 1; echo "PASS $1"; }
check_fail(){ if bash "$root/scripts/taso-offsite-backup-verify.sh" "$tmp/local/$base" >/dev/null 2>&1;then echo "FAIL $1";exit 1;fi;echo "PASS $1"; }
check_ok 'matching remote archive'
printf 'corruption' >> "$tmp/remote/$base"
check_fail 'corrupted remote archive rejected'
cp "$tmp/local/$base" "$tmp/remote/$base"
rm "$tmp/remote/$base.sha256"
check_fail 'missing remote checksum rejected'
cp "$tmp/local/$base.sha256" "$tmp/remote/$base.sha256"
printf 'archive=wrong\n' > "$tmp/remote/$base.meta"
check_fail 'tampered metadata rejected'
cp "$tmp/local/$base.meta" "$tmp/remote/$base.meta"
TASO_BACKUP_REMOTE='' check_fail 'missing remote configuration rejected'
check_ok 'restored valid remote'
