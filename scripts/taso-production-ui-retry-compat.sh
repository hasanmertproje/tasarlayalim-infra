#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
set +x

src="scripts/taso-production-core-clone-compat.sh"

python3 - "$src" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()

browser_old = '''deploy taso-search-prod "$search"
deploy taso-browser-prod "$browser"
deploy taso-speaker-prod "$speaker"
'''
browser_new = '''deploy taso-search-prod "$search"
deploy_browser_for_release() {
  if deploy taso-browser-prod "$browser"; then
    return 0
  fi

  local status
  status="$(api GET "applications/$browser" | jq -r '.status//"unknown"')"
  case "$status" in
    running|running:*)
      [[ "$status" != running:unhealthy ]] || {
        echo "::error::taso-browser-prod failed to deploy and the preserved runtime is unhealthy; refusing retry."
        return 1
      }
      ;;
    *)
      echo "::error::taso-browser-prod failed to deploy and no healthy preserved runtime is available; refusing retry."
      return 1
      ;;
  esac

  echo "::notice::taso-browser-prod first deployment failed while the previous runtime remained healthy; retrying exactly once."
  sleep 5
  deploy taso-browser-prod "$browser"
}
deploy_browser_for_release
deploy taso-speaker-prod "$speaker"
'''
browser_count = text.count(browser_old)
if browser_count != 1:
    raise SystemExit(f"Browser retry compatibility patch refused: expected browser deploy sequence once, found {browser_count}")
text = text.replace(browser_old, browser_new, 1)

ui_old = '''elif [[ "${owner_credential_mode:-}" == persisted ]]; then
  echo "Production Core persisted auth boundary remains in force with no plaintext owner credential configured."
fi
deploy taso-ui-prod "$ui"
'''
ui_new = '''elif [[ "${owner_credential_mode:-}" == persisted ]]; then
  echo "Production Core persisted auth boundary remains in force with no plaintext owner credential configured."
fi

deploy_ui_for_release() {
  if deploy taso-ui-prod "$ui"; then
    return 0
  fi

  local status
  status="$(api GET "applications/$ui" | jq -r '.status//"unknown"')"
  case "$status" in
    running|running:*)
      [[ "$status" != running:unhealthy ]] || {
        echo "::error::taso-ui-prod failed to deploy and the preserved runtime is unhealthy; refusing retry."
        return 1
      }
      ;;
    *)
      echo "::error::taso-ui-prod failed to deploy and no healthy preserved runtime is available; refusing retry."
      return 1
      ;;
  esac

  echo "::notice::taso-ui-prod first deployment failed while the previous runtime remained healthy; retrying exactly once."
  sleep 5
  deploy taso-ui-prod "$ui"
}
deploy_ui_for_release
'''
ui_count = text.count(ui_old)
if ui_count != 1:
    raise SystemExit(f"UI retry compatibility patch refused: expected UI deploy tail once, found {ui_count}")
text = text.replace(ui_old, ui_new, 1)

path.write_text(text)
PY

bash -n "$src"
echo "Production Browser/UI single-retry compatibility patch validated."
exec bash scripts/taso-production-api-retry-compat.sh
