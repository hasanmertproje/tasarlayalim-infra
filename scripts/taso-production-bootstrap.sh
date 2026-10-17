#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
set +x

src="scripts/taso-production-deploy.sh"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

python3 - "$src" "$tmp" <<'PY'
from pathlib import Path
import sys

src = Path(sys.argv[1])
out = Path(sys.argv[2])
text = src.read_text()

def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"bootstrap patch refused: expected exactly one {label} block, found {count}")
    text = text.replace(old, new, 1)

replace_once(
'''S3_UUID="$(jq -r '[.[]|select(.is_usable==true)][0].uuid//empty' <<<"$(api GET s3-storages)")"
[[ -n "$S3_UUID" ]] || { echo "::error::No usable S3 backup target; no resources were changed."; exit 1; }
''',
'''S3_UUID="$(jq -r '[.[]|select(.is_usable==true)][0].uuid//empty' <<<"$(api GET s3-storages)")"
if [[ -z "$S3_UUID" ]]; then
  echo "::error::No usable S3 backup target; refusing production mutation until off-site backup is available." >&2
  exit 1
else
  echo "Usable S3 backup target found; local + off-site backups will be configured."
fi
''',
"S3 preflight",
)

replace_once(
''' if [[ "$backup" == yes ]]; then
   BACKUP_S3="$S3_UUID" node -e 'process.stdout.write(JSON.stringify({frequency:"0 2 * * *",enabled:true,save_s3:true,disable_local_backup:false,stop_during_backup:false,s3_storage_uuid:process.env.BACKUP_S3,retention_amount_locally:7,retention_amount_s3:30}))' > "$PAYLOAD"
   api PUT "applications/$app/storages/$sid/backups" "$(<"$PAYLOAD")" >/dev/null
   echo "Scheduled daily local/S3 backup for $name."
 fi
''',
''' if [[ "$backup" == yes ]]; then
   if [[ -n "$S3_UUID" ]]; then
     BACKUP_S3="$S3_UUID" node -e 'process.stdout.write(JSON.stringify({frequency:"0 2 * * *",enabled:true,save_s3:true,disable_local_backup:false,stop_during_backup:false,s3_storage_uuid:process.env.BACKUP_S3,retention_amount_locally:7,retention_amount_s3:30}))' > "$PAYLOAD"
     api PUT "applications/$app/storages/$sid/backups" "$(<"$PAYLOAD")" >/dev/null
     echo "Scheduled daily local/S3 backup for $name."
   else
     echo "::error::Internal backup preflight violation: S3 target missing." >&2
     return 1
   fi
 fi
''',
"backup schedule",
)

replace_once(
'''speakerkey="$(reuse "$sf" TASO_SPEAKER_SERVICE_SECRET)"; [[ -n "$speakerkey" ]] || speakerkey="$(openssl rand -hex 32)"
for v in "$gateway" "$authkey" "$browserkey" "$speakerkey"; do mask "$v"; done
''',
'''speakerkey="$(reuse "$sf" TASO_SPEAKER_SERVICE_SECRET)"; [[ -n "$speakerkey" ]] || speakerkey="$(openssl rand -hex 32)"
searchkey="$(reuse "$xf" SEARXNG_SECRET)"; [[ -n "$searchkey" ]] || searchkey="$(openssl rand -hex 32)"
for v in "$gateway" "$authkey" "$browserkey" "$speakerkey" "$searchkey"; do mask "$v"; done
''',
"search secret bootstrap",
)

replace_once(
'''put "$search" "$xf" PORT 8080
''',
'''put "$search" "$xf" PORT 8080
put "$search" "$xf" SEARXNG_SECRET "$searchkey"
''',
"search environment",
)

replace_once(
'''ensure_app taso-ui-prod /taso-ui 80 taso-ui-prod "$TASO_PRODUCTION_DOMAIN"
''',
'''ensure_app taso-ui-prod /taso-ui 80 taso-ui-prod "$TASO_PRODUCTION_DOMAIN"

guard_production_domain_owner() {
 local ui_uuid="${U[taso-ui-prod]}" snapshot conflicts detail current basic desired owners
 desired="https://$TASO_PRODUCTION_DOMAIN"
 snapshot="$(api GET applications)"
 conflicts="$(jq -r --arg d "$TASO_PRODUCTION_DOMAIN" --arg ui "$ui_uuid" '
   .[]
   | select(.uuid != $ui)
   | (.fqdn // "") as $fqdn
   | select(($fqdn | split(",") | map(gsub("^ +| +$"; "")) | any(. == ("https://" + $d) or . == ("http://" + $d) or . == $d)))
   | "\(.name // "unknown")|\(.uuid // "unknown")|\($fqdn)"
 ' <<<"$snapshot")"
 if [[ -n "$conflicts" ]]; then
   echo "::error::Production domain is also owned by another Coolify resource; refusing automatic routing changes."
   while IFS='|' read -r conflict_name conflict_uuid conflict_fqdn; do
     [[ -n "$conflict_uuid" ]] || continue
     echo "::error::Conflicting owner name=$conflict_name uuid=$conflict_uuid fqdn=$conflict_fqdn"
   done <<<"$conflicts"
   return 1
 fi

 detail="$(api GET "applications/$ui_uuid")"
 jq -e --arg r "$REPOSITORY" '.name=="taso-ui-prod" and .environment_id==2 and .git_repository==$r and .git_branch=="main"' <<<"$detail" >/dev/null || {
   echo "::error::Production UI identity guard failed while enforcing domain ownership."
   return 1
 }
 current="$(jq -r '.fqdn // ""' <<<"$detail")"
 if [[ "$current" != "$desired" ]]; then
   api PATCH "applications/$ui_uuid" "$(jq -nc --arg domains "$desired" '{domains:$domains}')" >/dev/null
   detail="$(api GET "applications/$ui_uuid")"
 fi
 basic="$(jq -r '.is_http_basic_auth_enabled // false' <<<"$detail")"
 if [[ "$basic" == true ]]; then
   api PATCH "applications/$ui_uuid" '{"is_http_basic_auth_enabled":false}' >/dev/null
   detail="$(api GET "applications/$ui_uuid")"
 fi
 jq -e --arg wanted "$desired" '.fqdn==$wanted and (.is_http_basic_auth_enabled//false)==false' <<<"$detail" >/dev/null || {
   echo "::error::Production UI canonical domain/auth state did not converge."
   return 1
 }

 snapshot="$(api GET applications)"
 owners="$(jq -c --arg d "$TASO_PRODUCTION_DOMAIN" '
   [.[]
    | (.fqdn // "") as $fqdn
    | select(($fqdn | split(",") | map(gsub("^ +| +$"; "")) | any(. == ("https://" + $d) or . == ("http://" + $d) or . == $d)))
    | {uuid,name,fqdn}]
 ' <<<"$snapshot")"
 jq -e --arg ui "$ui_uuid" 'length==1 and .[0].uuid==$ui' <<<"$owners" >/dev/null || {
   echo "::error::Production domain ownership must resolve uniquely to taso-ui-prod."
   jq -r '.[] | "::error::Observed owner name=\(.name // "unknown") uuid=\(.uuid // "unknown") fqdn=\(.fqdn // "")"' <<<"$owners"
   return 1
 }
 echo "Production domain ownership guard passed: taso-ui-prod is the unique owner and outer Basic Auth is disabled."
}
guard_production_domain_owner
''',
"production domain ownership guard",
)

old_deploy = '''wait_running() {
 local uuid="$1" name="$2" status tries=0
 while ((tries<180)); do
   status="$(api GET "applications/$uuid"|jq -r '.status//"unknown"')"
   if [[ "$status" == running:* ]]; then
     [[ "$status" != running:unhealthy ]] || { echo "::error::$name is unhealthy."; return 1; }
     echo "$name is running ($status)."; return 0
   fi
   if [[ "$status" == exited:* || "$status" == errored* || "$status" == stopped* ]]; then echo "::error::$name failed ($status)."; return 1; fi
   sleep 10; ((tries+=1))
 done
 echo "::error::Timed out waiting for $name."; return 1
}
deploy() {
 local name="$1" uuid="$2" result
 echo "Deploying $name."
 result="$(api POST "deploy?uuid=$uuid")"
 jq -e --arg u "$uuid" '(.deployments//[])|any(.resource_uuid==$u)' <<<"$result" >/dev/null || { echo "::error::Deployment was not queued for $name."; return 1; }
 wait_running "$uuid" "$name"
}
'''
new_deploy = '''wait_deployment() {
 local deployment_uuid="$1" name="$2" status
 for _ in $(seq 1 180); do
   status="$(api GET "deployments/$deployment_uuid"|jq -r '.status//"unknown"')"
   case "$status" in
     finished) echo "$name deployment finished: $deployment_uuid"; return 0 ;;
     failed|cancelled|cancelled-by-user) echo "::error::$name deployment $deployment_uuid entered $status."; return 1 ;;
   esac
   sleep 5
 done
 echo "::error::Timed out waiting for $name deployment $deployment_uuid."; return 1
}
wait_running() {
 local uuid="$1" name="$2" status unhealthy_checks=0 max_unhealthy_checks=24
 for _ in $(seq 1 60); do
   status="$(api GET "applications/$uuid"|jq -r '.status//"unknown"')"
   if [[ "$status" == running:* || "$status" == running ]]; then
     if [[ "$status" == running:unhealthy ]]; then
       ((unhealthy_checks+=1))
       if ((unhealthy_checks>=max_unhealthy_checks)); then
         echo "::error::$name remained unhealthy for the full stabilization window."
         return 1
       fi
       echo "::notice::$name is temporarily unhealthy after deployment ($status); waiting for stabilization ($unhealthy_checks/$max_unhealthy_checks)."
       sleep 5
       continue
     fi
     echo "$name runtime state: $status"; return 0
   fi
   if [[ "$status" == exited:unhealthy || "$status" == exited ]]; then
     ((unhealthy_checks+=1))
     if ((unhealthy_checks>=max_unhealthy_checks)); then
       echo "::error::$name remained exited/unhealthy for the full stabilization window ($status)."
       return 1
     fi
     echo "::notice::$name is temporarily exited/unhealthy after deployment ($status); waiting for platform restart ($unhealthy_checks/$max_unhealthy_checks)."
     sleep 5
     continue
   fi
   if [[ "$status" == errored* || "$status" == stopped* ]]; then echo "::error::$name failed ($status)."; return 1; fi
   sleep 5
 done
 echo "::error::Timed out waiting for $name runtime state."; return 1
}
deploy() {
 local name="$1" uuid="$2" result deployment_uuid
 echo "Deploying $name."
 result="$(api POST "deploy?uuid=$uuid")"
 deployment_uuid="$(jq -r --arg u "$uuid" '[.deployments[]?|select(.resource_uuid==$u)][0].deployment_uuid//empty' <<<"$result")"
 [[ -n "$deployment_uuid" ]] || { echo "::error::Deployment was not queued with a deployment UUID for $name."; return 1; }
 wait_deployment "$deployment_uuid" "$name"
 wait_running "$uuid" "$name"
}
latest_finished_commit() {
 local uuid="$1" history
 history="$(api GET "deployments/applications/$uuid?skip=0&take=25")" || return 1
 jq -r '[.. | objects
   | select((.status // "") == "finished")
   | select(((.commit // .git_commit_sha // "") | test("^[0-9A-Fa-f]{40}$")))]
   | sort_by(.created_at // "") | reverse | .[0]
   | (.commit // .git_commit_sha // empty)' <<<"$history"
}
heavy_worker_unchanged_and_running() {
 local uuid="$1" source_path="$2" status last_commit
 status="$(api GET "applications/$uuid" | jq -r '.status // "unknown"')"
 case "$status" in
   running|running:*) [[ "$status" != running:unhealthy ]] || return 1 ;;
   *) return 1 ;;
 esac
 last_commit="$(latest_finished_commit "$uuid" || true)"
 [[ "$last_commit" =~ ^[0-9A-Fa-f]{40}$ ]] || return 1
 if ! git cat-file -e "$last_commit^{commit}" 2>/dev/null; then
   git fetch --no-tags --depth=1 origin "$last_commit" >/dev/null 2>&1 || return 1
 fi
 git diff --quiet "$last_commit" HEAD -- "$source_path"
}
deploy_heavy_worker() {
 local name="$1" uuid="$2" source_path="$3"
 if [[ "${TASO_FORCE_HEAVY_WORKER_DEPLOY:-0}" == 1 ]]; then
   echo "Force deployment requested for $name."
   deploy "$name" "$uuid"
   return
 fi
 if heavy_worker_unchanged_and_running "$uuid" "$source_path"; then
   echo "Skipping $name rebuild: source path '$source_path' is unchanged since its latest successful deployment and the current runtime is already running."
   return 0
 fi
 deploy "$name" "$uuid"
}
'''
replace_once(old_deploy, new_deploy, "deployment wait")

replace_once(
'''deploy taso-search-prod "$search"
deploy taso-browser-prod "$browser"
deploy taso-speaker-prod "$speaker"
deploy taso-voice-prod "$voice"
''',
'''deploy taso-search-prod "$search"
deploy taso-browser-prod "$browser"
deploy_heavy_worker taso-speaker-prod "$speaker" docker/taso-speaker
deploy_heavy_worker taso-voice-prod "$voice" docker/taso-voice
''',
"heavy worker deployment plan",
)

replace_once(
'''echo "Production UI and Core health passed: https://$TASO_PRODUCTION_DOMAIN"
''',
'''echo "Production UI and Core health passed: https://$TASO_PRODUCTION_DOMAIN"
echo "Checking production authentication session gate."
session="$(curl -fsS --connect-timeout 10 --max-time 20 "https://$TASO_PRODUCTION_DOMAIN/api/auth/session")"
jq -e '.configured==true and .authenticated==false' <<<"$session" >/dev/null || { echo "::error::Production authentication session gate failed."; exit 1; }
echo "Production authentication session gate passed."
''',
"production acceptance tail",
)

out.write_text(text)
PY

bash -n "$tmp"
echo "Guarded production bootstrap patch validated."
if [[ "${TASO_PATCH_VALIDATE_ONLY:-0}" == 1 ]]; then
  echo "Full production compatibility patch chain validated without Coolify mutations."
  exit 0
fi
bash "$tmp"
