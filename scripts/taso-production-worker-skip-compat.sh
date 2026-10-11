#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
set +x

src="scripts/taso-production-bootstrap.sh"

python3 - "$src" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
old = '''deploy taso-search-prod "$search"
deploy taso-browser-prod "$browser"
deploy_heavy_worker taso-speaker-prod "$speaker" docker/taso-speaker
deploy_heavy_worker taso-voice-prod "$voice" docker/taso-voice
'''
new = '''deploy_heavy_worker taso-search-prod "$search" docker/taso-search
deploy_heavy_worker taso-browser-prod "$browser" docker/taso-browser
deploy_heavy_worker taso-speaker-prod "$speaker" docker/taso-speaker
deploy_heavy_worker taso-voice-prod "$voice" docker/taso-voice
'''
count = text.count(old)
if count != 1:
    raise SystemExit(f"worker preservation patch refused: expected deployment plan once, found {count}")
path.write_text(text.replace(old, new, 1))
PY

bash -n "$src"
echo "Production unchanged-worker preservation patch validated."
exec bash scripts/taso-production-ui-retry-compat.sh
