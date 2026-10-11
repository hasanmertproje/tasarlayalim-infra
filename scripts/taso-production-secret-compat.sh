#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
set +x

src="scripts/taso-production-deploy.sh"
python3 - "$src" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
old = '''OWNER_EMAIL="$(src TASO_OWNER_EMAIL)"
OWNER_PASSWORD="$(src TASO_OWNER_PASSWORD)"
NVIDIA_KEY="$(src TASO_PROVIDER_NVIDIA_API_KEY)"
GITHUB_TOKEN="$(src TASO_GITHUB_TOKEN)"
[[ -n "$OWNER_EMAIL" && -n "$OWNER_PASSWORD" && -n "$NVIDIA_KEY" && -n "$GITHUB_TOKEN" ]] || {
 echo "::error::Preview owner login, NVIDIA key, or dedicated GitHub token is unavailable; no resources were changed."
 exit 1
}
for v in "$OWNER_EMAIL" "$OWNER_PASSWORD" "$NVIDIA_KEY" "$GITHUB_TOKEN"; do mask "$v"; done
OWNER_HASH="$(OWNER_PASSWORD="$OWNER_PASSWORD" node -e 'const c=require("node:crypto"),s=c.randomBytes(16),h=c.scryptSync(process.env.OWNER_PASSWORD,s,32);process.stdout.write("scrypt$"+s.toString("base64")+"$"+h.toString("base64"))')"
mask "$OWNER_HASH"
'''
new = '''OWNER_EMAIL="$(src TASO_OWNER_EMAIL)"
OWNER_PASSWORD="$(src TASO_OWNER_PASSWORD)"
OWNER_HASH="$(src TASO_OWNER_PASSWORD_HASH)"
NVIDIA_KEY="$(src TASO_PROVIDER_NVIDIA_API_KEY)"
GITHUB_TOKEN="$(src TASO_GITHUB_TOKEN)"
missing=()
[[ -n "$OWNER_EMAIL" ]] || missing+=(TASO_OWNER_EMAIL)
[[ -n "$OWNER_PASSWORD" || -n "$OWNER_HASH" ]] || missing+=(TASO_OWNER_PASSWORD_HASH)
[[ -n "$NVIDIA_KEY" ]] || missing+=(TASO_PROVIDER_NVIDIA_API_KEY)
[[ -n "$GITHUB_TOKEN" ]] || missing+=(TASO_GITHUB_TOKEN)
if ((${#missing[@]})); then
 echo "::error::Required production bootstrap inputs are unavailable: ${missing[*]}; no resources were changed."
 exit 1
fi
for v in "$OWNER_EMAIL" "$OWNER_PASSWORD" "$OWNER_HASH" "$NVIDIA_KEY" "$GITHUB_TOKEN"; do mask "$v"; done
if [[ -z "$OWNER_HASH" ]]; then
 OWNER_HASH="$(OWNER_PASSWORD="$OWNER_PASSWORD" node -e 'const c=require("node:crypto"),s=c.randomBytes(16),h=c.scryptSync(process.env.OWNER_PASSWORD,s,32);process.stdout.write("scrypt$"+s.toString("base64")+"$"+h.toString("base64"))')"
fi
mask "$OWNER_HASH"
'''
if text.count(old) != 1:
    raise SystemExit(f"secret compatibility patch refused: expected source auth block once, found {text.count(old)}")
path.write_text(text.replace(old, new, 1))
PY

bash -n "$src"
echo "Production secret compatibility patch validated."
exec bash scripts/taso-production-bootstrap.sh
