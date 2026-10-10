#!/usr/bin/env bash
set -Eeuo pipefail

fail() {
  printf 'taso-backup-verify: %s\n' "$*" >&2
  exit 1
}

[[ $# -eq 1 ]] || fail "usage: $0 /path/to/taso-state-....json.gz"
ARCHIVE="$1"
CHECKSUM="${ARCHIVE}.sha256"
[[ -f "${ARCHIVE}" ]] || fail "archive not found: ${ARCHIVE}"
[[ -f "${CHECKSUM}" ]] || fail "checksum not found: ${CHECKSUM}"

(
  cd "$(dirname "${ARCHIVE}")"
  sha256sum -c "$(basename "${CHECKSUM}")"
)

gzip -t -- "${ARCHIVE}"
python3 - "${ARCHIVE}" <<'PY'
import gzip, json, sys
path = sys.argv[1]
with gzip.open(path, 'rt', encoding='utf-8') as handle:
    state = json.load(handle)
required = ('projects', 'manifests', 'milestones', 'knowledge', 'missions', 'events', 'conversations')
if not isinstance(state, dict):
    raise SystemExit('state root must be an object')
for key in required:
    if key not in state or not isinstance(state[key], list):
        raise SystemExit(f'missing or invalid state array: {key}')
print('snapshot=valid')
for key in required:
    print(f'{key}={len(state[key])}')
PY
