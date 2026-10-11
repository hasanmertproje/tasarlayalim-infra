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
old = '''api() {
  local method="$1" path="$2" body="${3:-}" code
  local args=(--silent --show-error --connect-timeout 15 --max-time 180
    --output "$RESP" --write-out '%{http_code}'
    --header "Authorization: Bearer $COOLIFY_API_TOKEN" --header 'Accept: application/json')
  if [[ -n "$body" ]]; then
    printf '%s' "$body" > "$PAYLOAD"
    args+=(--header 'Content-Type: application/json' --data-binary "@$PAYLOAD")
  fi
  code="$(curl "${args[@]}" -X "$method" "$API_BASE/$path")"
  if [[ ! "$code" =~ ^2 ]]; then
    echo "::error::Coolify API $method $path failed (HTTP $code)." >&2
    return 1
  fi
  cat "$RESP"
}
'''
new = '''api() {
  local method="$1" path="$2" body="${3:-}" code="" rc=0 attempt=1 max_attempts=1 delay=0
  local args=(--silent --show-error --connect-timeout 15 --max-time 180
    --output "$RESP" --write-out '%{http_code}'
    --header "Authorization: Bearer $COOLIFY_API_TOKEN" --header 'Accept: application/json')
  if [[ -n "$body" ]]; then
    printf '%s' "$body" > "$PAYLOAD"
    args+=(--header 'Content-Type: application/json' --data-binary "@$PAYLOAD")
  fi
  [[ "$method" == GET ]] && max_attempts=4
  while ((attempt<=max_attempts)); do
    : > "$RESP"
    rc=0
    code="$(curl "${args[@]}" -X "$method" "$API_BASE/$path")" || rc=$?
    if ((rc==0)) && [[ "$code" =~ ^2 ]]; then
      cat "$RESP"
      return 0
    fi
    if [[ "$method" == GET ]] && ((attempt<max_attempts)) && { ((rc!=0)) || [[ "$code" == 408 || "$code" == 429 || "$code" =~ ^5 ]]; }; then
      delay=$((attempt*3))
      echo "::notice::Coolify API GET $path had a transient failure (curl=$rc HTTP=${code:-000}); retrying after ${delay}s ($attempt/$max_attempts)." >&2
      sleep "$delay"
      ((attempt+=1))
      continue
    fi
    if ((rc!=0)); then
      echo "::error::Coolify API $method $path transport failed (curl=$rc HTTP=${code:-000})." >&2
    else
      echo "::error::Coolify API $method $path failed (HTTP ${code:-000})." >&2
    fi
    return 1
  done
  echo "::error::Coolify API $method $path exhausted retry attempts." >&2
  return 1
}
'''
count = text.count(old)
if count != 1:
    raise SystemExit(f"Coolify GET retry compatibility patch refused: expected api helper once, found {count}")
path.write_text(text.replace(old, new, 1))
PY

bash -n "$src"
echo "Coolify idempotent GET retry compatibility patch validated."
exec bash scripts/taso-production-core-clone-compat.sh
