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

def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"secret compatibility patch refused: expected {label} once, found {count}")
    text = text.replace(old, new, 1)

replace_once(
'''src() { jq -r --arg k "$1" '[.[]|select(.key==$k and .is_preview!=true)|.value//empty][0]//[.[]|select(.key==$k)|.value//empty][0]//empty' "$TMP/source-envs.json"; }
''',
'''src() { jq -r --arg k "$1" '[.[]|select(.key==$k and .is_preview!=true)|(.real_value//.value//empty)][0]//[.[]|select(.key==$k)|(.real_value//.value//empty)][0]//empty' "$TMP/source-envs.json"; }
''',
"source env reader",
)

replace_once(
'''reuse() { jq -r --arg k "$2" '[.[]|select(.key==$k)|.value//empty][0]//empty' "$1"; }
''',
'''reuse() { jq -r --arg k "$2" '[.[]|select(.key==$k)|(.real_value//.value//empty)][0]//empty' "$1"; }
''',
"production env reader",
)

old_auth = '''OWNER_EMAIL="$(src TASO_OWNER_EMAIL)"
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
new_auth = '''OWNER_EMAIL="$(src TASO_OWNER_EMAIL)"
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
replace_once(old_auth, new_auth, "source auth block")

path.write_text(text)
PY

bash -n "$src"
echo "Production secret compatibility patch validated."
exec bash scripts/taso-production-bootstrap.sh
