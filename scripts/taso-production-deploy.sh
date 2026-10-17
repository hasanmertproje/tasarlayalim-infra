#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
set +x
: "${COOLIFY_BASE_URL:=https://coolify.tasarlayalim.com}"
: "${COOLIFY_API_TOKEN:?COOLIFY_API_TOKEN is required}"
: "${TASO_PRODUCTION_DOMAIN:=taso.tasarlayalim.com}"
: "${TASO_SERVER_IPV4:=45.74.243.96}"
readonly API_BASE="${COOLIFY_BASE_URL%/}/api/v1"
readonly PROJECT_UUID=q8zrrvgln9f9zy1tz5q2db0w
readonly SERVER_UUID=h6e4ws8nwfi6stqjgrrhgaq6
readonly PROD_ENV_UUID=witrmsidlkntl6vbjgc9zxsl
readonly GH_APP_UUID=2fzt2ok1zrpemvsz2gxhw4nw
readonly REPOSITORY=hasanmertproje/tasarlayalim-infra
readonly TMP="$(mktemp -d)"
readonly RESP="$TMP/response.json" PAYLOAD="$TMP/payload.json"
trap 'rm -rf "$TMP"' EXIT

api() {
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
mask() { [[ -n "${1:-}" ]] && printf '::add-mask::%s\n' "$1"; }

echo "Preflight: production DNS."
dns="$(getent ahostsv4 "$TASO_PRODUCTION_DOMAIN" | awk '{print $1}' | sort -u || true)"
[[ "$dns" == "$TASO_SERVER_IPV4" ]] || {
  echo "::error::Production DNS must resolve only to the Taso server IPv4; no resources were changed."
  exit 1
}

echo "Preflight: Coolify source, target environment, and off-site backup."
apps="$(api GET applications)"
source_uuid="$(jq -r --arg repo "$REPOSITORY" '.[]|select(.name=="taso-core-v2" and .git_repository==$repo)|.uuid' <<<"$apps"|head -n1)"
[[ -n "$source_uuid" ]] || { echo "::error::Taso preview Core source is missing."; exit 1; }
jq -e --arg u "$PROJECT_UUID" 'any(.[];.uuid==$u)' <<<"$(api GET projects)" >/dev/null || { echo "::error::Taso Coolify project is missing."; exit 1; }
jq -e --arg u "$PROD_ENV_UUID" 'any(.[];.uuid==$u and .name=="production")' <<<"$(api GET "projects/$PROJECT_UUID/environments")" >/dev/null || { echo "::error::Production environment is missing."; exit 1; }
jq -e --arg u "$SERVER_UUID" 'any(.[];.uuid==$u)' <<<"$(api GET servers)" >/dev/null || { echo "::error::Coolify server is missing."; exit 1; }
jq -e --arg u "$GH_APP_UUID" 'any(.[];.uuid==$u)' <<<"$(api GET github-apps)" >/dev/null || { echo "::error::Private GitHub App is missing."; exit 1; }
S3_UUID="$(jq -r '[.[]|select(.is_usable==true)][0].uuid//empty' <<<"$(api GET s3-storages)")"
[[ -n "$S3_UUID" ]] || { echo "::error::No usable S3 backup target; no resources were changed."; exit 1; }

src_envs="$(api GET "applications/$source_uuid/envs")"
printf '%s' "$src_envs" > "$TMP/source-envs.json"
src() { jq -r --arg k "$1" '[.[]|select(.key==$k and .is_preview!=true)|.value//empty][0]//[.[]|select(.key==$k)|.value//empty][0]//empty' "$TMP/source-envs.json"; }
OWNER_EMAIL="$(src TASO_OWNER_EMAIL)"
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
NVIDIA_BASE="$(src TASO_PROVIDER_NVIDIA_BASE_URL)"
NVIDIA_MODEL="$(src TASO_PROVIDER_NVIDIA_MODEL)"
NVIDIA_CLASS="$(src TASO_PROVIDER_NVIDIA_DATA)"
: "${NVIDIA_BASE:=https://integrate.api.nvidia.com/v1}"
: "${NVIDIA_MODEL:=openai/gpt-oss-20b}"
: "${NVIDIA_CLASS:=public}"

echo "Preflight passed. Configuring separate production applications."
declare -A U
ensure_app() {
 local name="$1" base="$2" port="$3" alias="$4" domain="${5:-}" uuid
 uuid="$(jq -r --arg n "$name" '.[]|select(.name==$n)|.uuid' <<<"$apps"|head -n1)"
 if [[ -n "$uuid" ]]; then
   local detail
   detail="$(api GET "applications/$uuid")"
   jq -e --arg r "$REPOSITORY" '.environment_id==2 and .git_repository==$r and .git_branch=="main"' <<<"$detail" >/dev/null || {
    echo "::error::Existing $name is not this production resource; refusing to alter it."
    return 1
   }
 else
   APP_NAME="$name" APP_BASE="$base" APP_PORT="$port" APP_ALIAS="$alias" APP_DOMAIN="$domain" node -e '
    const b={project_uuid:"q8zrrvgln9f9zy1tz5q2db0w",server_uuid:"h6e4ws8nwfi6stqjgrrhgaq6",
    environment_name:"production",environment_uuid:"witrmsidlkntl6vbjgc9zxsl",
    github_app_uuid:"2fzt2ok1zrpemvsz2gxhw4nw",git_repository:"hasanmertproje/tasarlayalim-infra",
    git_branch:"main",build_pack:"dockerfile",name:process.env.APP_NAME,base_directory:process.env.APP_BASE,
    dockerfile_location:"/Dockerfile",ports_exposes:process.env.APP_PORT,custom_internal_name:process.env.APP_ALIAS,
    connect_to_docker_network:true,autogenerate_domain:false,is_auto_deploy_enabled:false,
    is_preview_deployments_enabled:false,instant_deploy:false,tags:["taso-production"]};
    if(process.env.APP_DOMAIN)b.domains="https://"+process.env.APP_DOMAIN;
    process.stdout.write(JSON.stringify(b))' > "$PAYLOAD"
   uuid="$(jq -r '.uuid//empty' <<<"$(api POST applications/private-github-app "$(<"$PAYLOAD")")")"
   [[ -n "$uuid" ]] || { echo "::error::Coolify did not return the resource UUID for $name."; return 1; }
   apps="$(api GET applications)"
 fi
 U["$name"]="$uuid"
 echo "Configured $name."
}
ensure_app taso-search-prod /docker/taso-search 8080 taso-search
ensure_app taso-browser-prod /docker/taso-browser 3100 taso-browser
ensure_app taso-speaker-prod /docker/taso-speaker 3200 taso-speaker
ensure_app taso-voice-prod /docker/taso-voice 8000 taso-voice
ensure_app taso-core-prod /taso 3000 taso-core-prod
ensure_app taso-ui-prod /taso-ui 80 taso-ui-prod "$TASO_PRODUCTION_DOMAIN"

ensure_storage() {
 local app="$1" name="$2" path="$3" backup="$4" all sid
 all="$(api GET "applications/$app/storages")"
 sid="$(jq -r --arg p "$path" '[.persistent_storages[]?|select(.mount_path==$p)][0].uuid//empty' <<<"$all")"
 if [[ -z "$sid" ]]; then
   STORAGE_NAME="$name" STORAGE_PATH="$path" node -e 'process.stdout.write(JSON.stringify({type:"persistent",name:process.env.STORAGE_NAME,mount_path:process.env.STORAGE_PATH}))' > "$PAYLOAD"
   api POST "applications/$app/storages" "$(<"$PAYLOAD")" >/dev/null
   sid="$(jq -r --arg p "$path" '[.persistent_storages[]?|select(.mount_path==$p)][0].uuid//empty' <<<"$(api GET "applications/$app/storages")")"
 fi
 [[ -n "$sid" ]] || { echo "::error::Persistent storage $path could not be configured."; return 1; }
 if [[ "$backup" == yes ]]; then
   BACKUP_S3="$S3_UUID" node -e 'process.stdout.write(JSON.stringify({frequency:"0 2 * * *",enabled:true,save_s3:true,disable_local_backup:false,stop_during_backup:false,s3_storage_uuid:process.env.BACKUP_S3,retention_amount_locally:7,retention_amount_s3:30}))' > "$PAYLOAD"
   api PUT "applications/$app/storages/$sid/backups" "$(<"$PAYLOAD")" >/dev/null
   echo "Scheduled daily local/S3 backup for $name."
 fi
 printf '%s' "$sid"
}
ensure_storage "${U[taso-core-prod]}" taso-core-prod-data /data yes >/dev/null
ensure_storage "${U[taso-speaker-prod]}" taso-speaker-prod-data /data yes >/dev/null
ensure_storage "${U[taso-voice-prod]}" taso-voice-prod-data /voices yes >/dev/null

envfile() { api GET "applications/$1/envs" > "$TMP/env-$1.json"; printf '%s' "$TMP/env-$1.json"; }
put() {
 local app="$1" f="$2" key="$3" value="$4" method body
 [[ -n "$value" ]] || { echo "::error::Required environment key $key is empty."; return 1; }
 mask "$value"
 if jq -e --arg k "$key" 'any(.[];.key==$k)' "$f" >/dev/null; then method=PATCH; else method=POST; fi
 ENV_KEY="$key" ENV_VALUE="$value" node -e 'process.stdout.write(JSON.stringify({key:process.env.ENV_KEY,value:process.env.ENV_VALUE,is_preview:false,is_shown_once:false}))' > "$PAYLOAD"
 body="$(<"$PAYLOAD")"
 api "$method" "applications/$app/envs" "$body" >/dev/null
}
core="${U[taso-core-prod]}"; ui="${U[taso-ui-prod]}"; browser="${U[taso-browser-prod]}"
speaker="${U[taso-speaker-prod]}"; voice="${U[taso-voice-prod]}"; search="${U[taso-search-prod]}"
cf="$(envfile "$core")"; uf="$(envfile "$ui")"; bf="$(envfile "$browser")"; sf="$(envfile "$speaker")"; vf="$(envfile "$voice")"; xf="$(envfile "$search")"
reuse() { jq -r --arg k "$2" '[.[]|select(.key==$k)|.value//empty][0]//empty' "$1"; }
# Existing Core credentials may encrypt persisted owner/TOTP state. An unreadable
# Coolify API response must NEVER be treated as permission to rotate either key.
is_unusable_production_secret() {
  local value="${1:-}"
  if [[ -z "${value//[[:space:]]/}" ]]; then return 0; fi
  case "$value" in masked|MASKED|redacted|REDACTED|NULL|null|'[hidden]'|'<hidden>'|'<redacted>') return 0 ;; esac
  if [[ "$value" =~ ^\*{3,}$ || "$value" =~ ^•{3,}$ ]]; then return 0; fi
  return 1
}
gateway="$(reuse "$cf" TASO_GATEWAY_SECRET)"
if is_unusable_production_secret "$gateway"; then
  if [[ "${core_preexisting:-unknown}" != false ]]; then
    echo "::error::Existing Core gateway secret is missing or unreadable; refusing automatic rotation." >&2
    exit 1
  fi
  gateway="$(openssl rand -hex 32)"
fi
authkey="$(reuse "$cf" TASO_AUTH_ENCRYPTION_KEY)"
if is_unusable_production_secret "$authkey"; then
  if [[ "${core_preexisting:-unknown}" != false ]]; then
    echo "::error::Existing Core auth encryption key is missing or unreadable; refusing automatic rotation." >&2
    exit 1
  fi
  authkey="$(openssl rand -hex 32)"
fi
browserkey="$(reuse "$bf" TASO_BROWSER_WORKER_SECRET)"; [[ -n "$browserkey" ]] || browserkey="$(openssl rand -hex 32)"
speakerkey="$(reuse "$sf" TASO_SPEAKER_SERVICE_SECRET)"; [[ -n "$speakerkey" ]] || speakerkey="$(openssl rand -hex 32)"
for v in "$gateway" "$authkey" "$browserkey" "$speakerkey"; do mask "$v"; done
owner_email="$(reuse "$cf" TASO_OWNER_EMAIL)"; [[ -n "$owner_email" ]] || owner_email="$OWNER_EMAIL"
owner_hash="$(reuse "$cf" TASO_OWNER_PASSWORD_HASH)"; [[ -n "$owner_hash" ]] || owner_hash="$OWNER_HASH"
nvidia="$(reuse "$cf" TASO_PROVIDER_NVIDIA_API_KEY)"; [[ -n "$nvidia" ]] || nvidia="$NVIDIA_KEY"
github="$(reuse "$cf" TASO_GITHUB_TOKEN)"; [[ -n "$github" ]] || github="$GITHUB_TOKEN"

for kv in \
 "NODE_ENV|production" "PORT|3000" "HOST|0.0.0.0" "TASO_OWNER_EMAIL|$owner_email" \
 "TASO_OWNER_PASSWORD_HASH|$owner_hash" "TASO_AUTH_ALLOW_INSECURE_BOOTSTRAP|0" \
 "TASO_SESSION_TTL_MS|43200000" "TASO_GATEWAY_SECRET|$gateway" "TASO_AUTH_ENCRYPTION_KEY|$authkey" \
 "TASO_AUTH_SECURITY_FILE|/data/taso-auth-security.json" "TASO_STATE_FILE|/data/taso-state.json" \
 "TASO_IDENTITY_FILE|/data/taso-identities.json" "TASO_CONTROL_PLANE_FILE|/data/taso-control-plane.json" \
 "TASO_INCIDENT_FILE|/data/taso-incidents.json" "TASO_PERSONALIZATION_FILE|/data/taso-personalization.json" \
 "TASO_GITHUB_TOKEN|$github" "TASO_GITHUB_API_URL|https://api.github.com" \
 "TASO_PROVIDER_NVIDIA_API_KEY|$nvidia" "TASO_PROVIDER_NVIDIA_BASE_URL|$NVIDIA_BASE" \
 "TASO_PROVIDER_NVIDIA_MODEL|$NVIDIA_MODEL" "TASO_PROVIDER_NVIDIA_DATA|$NVIDIA_CLASS" \
 "TASO_BROWSER_WORKER_URL|http://taso-browser:3100" "TASO_BROWSER_WORKER_SECRET|$browserkey" \
 "TASO_SEARCH_ENDPOINT|http://taso-search:8080/search" \
 "TASO_SPEAKER_SERVICE_URL|http://taso-speaker:3200" "TASO_SPEAKER_SERVICE_SECRET|$speakerkey" \
 "TASO_SPEAKER_CONFIDENCE_MIN|0.82" "TASO_LOCAL_VOICE_URL|http://taso-voice:8000" \
 "TASO_LOCAL_VOICE_TIMEOUT_MS|20000" "TASO_VOICE_REALTIME_ENABLED|false" \
 "TASO_VOICE_REALTIME_PAID_ALLOWED|false" "TASO_ALLOW_MOCK_PROVIDER|false"; do
 key="${kv%%|*}"; value="${kv#*|}"; put "$core" "$cf" "$key" "$value"
done
put "$browser" "$bf" PORT 3100
put "$browser" "$bf" TASO_BROWSER_WORKER_SECRET "$browserkey"
put "$browser" "$bf" TASO_BROWSER_ALLOWED_HOSTS "$TASO_PRODUCTION_DOMAIN"
put "$speaker" "$sf" PORT 3200
put "$speaker" "$sf" TASO_SPEAKER_SERVICE_SECRET "$speakerkey"
put "$speaker" "$sf" TASO_SPEAKER_DATA_DIR /data
put "$search" "$xf" PORT 8080
put "$voice" "$vf" PORT 8000
put "$voice" "$vf" TASO_VOICE_PACK_DIR /voices
put "$voice" "$vf" TASO_VOICE_DEVICE cpu
put "$ui" "$uf" TASO_CORE_UPSTREAM http://taso-core-prod:3000
put "$ui" "$uf" TASO_GATEWAY_SECRET "$gateway"

for app in "$core" "$ui" "$browser" "$speaker" "$voice" "$search"; do
 detail="$(api GET "applications/$app")"
 jq -e '.settings.connect_to_docker_network==true' <<<"$detail" >/dev/null || { echo "::error::Internal network attachment missing."; exit 1; }
done
for app in "$core" "$browser" "$speaker" "$voice" "$search"; do
 jq -e '(.fqdn//"")==""' <<<"$(api GET "applications/$app")" >/dev/null || { echo "::error::An internal app has a public domain."; exit 1; }
done

wait_running() {
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
deploy taso-search-prod "$search"
deploy taso-browser-prod "$browser"
deploy taso-speaker-prod "$speaker"
deploy taso-voice-prod "$voice"
deploy taso-core-prod "$core"
deploy taso-ui-prod "$ui"

echo "Checking public HTTPS routes."
ok=false
for _ in $(seq 1 40); do
 ui_code="$(curl --silent --output "$TMP/ui" --write-out '%{http_code}' --connect-timeout 10 --max-time 20 "https://$TASO_PRODUCTION_DOMAIN/health" || true)"
 core_code="$(curl --silent --output "$TMP/core" --write-out '%{http_code}' --connect-timeout 10 --max-time 20 "https://$TASO_PRODUCTION_DOMAIN/api/health" || true)"
 if [[ "$ui_code" == 200 && "$core_code" == 200 ]] && grep -q 'ok' "$TMP/ui" && jq -e . "$TMP/core" >/dev/null 2>&1; then ok=true; break; fi
 sleep 15
done
[[ "$ok" == true ]] || { echo "::error::Production UI/Core public health check failed."; exit 1; }
echo "Production UI and Core health passed: https://$TASO_PRODUCTION_DOMAIN"
