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
  echo "::warning::No usable S3 backup target is configured. This first production bootstrap will keep daily local backups; off-site backup remains pending."
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
     node -e 'process.stdout.write(JSON.stringify({frequency:"0 2 * * *",enabled:true,save_s3:false,disable_local_backup:false,stop_during_backup:false,retention_amount_locally:7}))' > "$PAYLOAD"
     api PUT "applications/$app/storages/$sid/backups" "$(<"$PAYLOAD")" >/dev/null
     echo "Scheduled daily local backup for $name (S3 pending)."
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
 local uuid="$1" name="$2" status
 for _ in $(seq 1 60); do
   status="$(api GET "applications/$uuid"|jq -r '.status//"unknown"')"
   if [[ "$status" == running:* || "$status" == running ]]; then
     [[ "$status" != running:unhealthy ]] || { echo "::error::$name is unhealthy."; return 1; }
     echo "$name runtime state: $status"; return 0
   fi
   if [[ "$status" == exited:* || "$status" == exited || "$status" == errored* || "$status" == stopped* ]]; then echo "::error::$name failed ($status)."; return 1; fi
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
'''
replace_once(old_deploy, new_deploy, "deployment wait")

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
bash "$tmp"
