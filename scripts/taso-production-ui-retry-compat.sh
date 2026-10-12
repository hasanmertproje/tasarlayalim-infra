#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
set +x

bootstrap_src="scripts/taso-production-bootstrap.sh"

python3 - "$bootstrap_src" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()

old_failure_flow = ''' wait_deployment "$deployment_uuid" "$name"
 wait_running "$uuid" "$name"
'''
new_failure_flow = ''' wait_deployment "$deployment_uuid" "$name" || return 1
 wait_running "$uuid" "$name"
'''
flow_count = text.count(old_failure_flow)
if flow_count != 1:
    raise SystemExit(f"Deployment failure propagation patch refused: expected deploy wait sequence once, found {flow_count}")
text = text.replace(old_failure_flow, new_failure_flow, 1)

old_browser = """'''deploy taso-search-prod \"$search\"
deploy taso-browser-prod \"$browser\"
deploy_heavy_worker taso-speaker-prod \"$speaker\" docker/taso-speaker
deploy_heavy_worker taso-voice-prod \"$voice\" docker/taso-voice
'''"""
new_browser = """'''deploy taso-search-prod \"$search\"
deploy_browser_for_release() {
  if heavy_worker_unchanged_and_running \"$browser\" docker/taso-browser; then
    echo \"Skipping taso-browser-prod rebuild: source path 'docker/taso-browser' is unchanged since its latest successful deployment and the current runtime is already running.\"
    return 0
  fi

  if deploy taso-browser-prod \"$browser\"; then
    return 0
  fi

  local status
  status=\"$(api GET \"applications/$browser\" | jq -r '.status//\"unknown\"')\"
  case \"$status\" in
    running|running:*)
      [[ \"$status\" != running:unhealthy ]] || {
        echo \"::error::taso-browser-prod failed to deploy and the preserved runtime is unhealthy; refusing retry.\"
        return 1
      }
      ;;
    *)
      echo \"::error::taso-browser-prod failed to deploy and no healthy preserved runtime is available; refusing retry.\"
      return 1
      ;;
  esac

  echo \"::notice::taso-browser-prod changed since its latest successful deployment, but the first deployment failed while the previous runtime remained healthy; retrying exactly once.\"
  sleep 5
  deploy taso-browser-prod \"$browser\"
}
deploy_browser_for_release
deploy_heavy_worker taso-speaker-prod \"$speaker\" docker/taso-speaker
deploy_heavy_worker taso-voice-prod \"$voice\" docker/taso-voice
'''"""
browser_count = text.count(old_browser)
if browser_count != 1:
    raise SystemExit(f"Browser release compatibility patch refused: expected guarded worker deploy target once, found {browser_count}")
text = text.replace(old_browser, new_browser, 1)
path.write_text(text)
PY

bash -n "$bootstrap_src"
echo "Production deployment failure propagation and Browser unchanged-worker/retry compatibility patches validated."

src="scripts/taso-production-core-clone-compat.sh"

python3 - "$src" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
old = '''elif [[ "${owner_credential_mode:-}" == persisted ]]; then
  echo "Production Core persisted auth boundary remains in force with no plaintext owner credential configured."
fi
deploy taso-ui-prod "$ui"
'''
new = '''elif [[ "${owner_credential_mode:-}" == persisted ]]; then
  echo "Production Core persisted auth boundary remains in force with no plaintext owner credential configured."
fi

deploy_force_no_cache() {
  local name="$1" uuid="$2" result deployment_uuid
  echo "Force rebuilding $name without build cache."
  result="$(api POST "deploy?uuid=$uuid&force=true")"
  deployment_uuid="$(jq -r --arg u "$uuid" '[.deployments[]? | select(.resource_uuid==$u)][0].deployment_uuid // empty' <<<"$result")"
  [[ -n "$deployment_uuid" ]] || {
    echo "::error::Force deployment was not queued for $name."
    return 1
  }
  wait_deployment "$deployment_uuid" "$name" || return 1
  wait_running "$uuid" "$name"
}

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

  echo "::notice::taso-ui-prod normal deployment failed while the previous runtime remained healthy; retrying exactly once as a cacheless force rebuild."
  sleep 5
  deploy_force_no_cache taso-ui-prod "$ui"
}
deploy_ui_for_release
'''
count = text.count(old)
if count != 1:
    raise SystemExit(f"UI retry compatibility patch refused: expected UI deploy tail once, found {count}")
path.write_text(text.replace(old, new, 1))
PY

bash -n "$src"
echo "Production UI bounded cacheless-force retry compatibility patch validated."
exec bash scripts/taso-production-api-retry-compat.sh
