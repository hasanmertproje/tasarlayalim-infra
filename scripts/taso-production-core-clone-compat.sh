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
        raise SystemExit(f"core clone compatibility patch refused: expected {label} once, found {count}")
    text = text.replace(old, new, 1)

start = 'src_envs="$(api GET "applications/$source_uuid/envs")"\n'
end = ': "${NVIDIA_CLASS:=public}"\n'
if text.count(start) != 1 or text.count(end) != 1:
    raise SystemExit('core clone compatibility patch refused: source-secret block markers changed')
a = text.index(start)
b = text.index(end, a) + len(end)
text = text[:a] + '''echo "Production Core owner/provider secrets will be inherited through a Coolify configuration clone; CI will not read secret values."
''' + text[b:]

marker = '''}
ensure_app taso-search-prod /docker/taso-search 8080 taso-search
'''
clone_fn = '''}
core_preexisting=false
ensure_core_prod() {
 local uuid detail destination cloned moved envs env_uuid
 uuid="$(jq -r '.[]|select(.name=="taso-core-prod")|.uuid' <<<"$apps"|head -n1)"
 if [[ -n "$uuid" ]]; then
   core_preexisting=true
   detail="$(api GET "applications/$uuid")"
   jq -e --arg r "$REPOSITORY" '.environment_id==2 and .git_repository==$r and .git_branch=="main"' <<<"$detail" >/dev/null || {
     echo "::error::Existing taso-core-prod is not the expected production resource; refusing to alter it."
     return 1
   }
 else
   destination="$(api GET "applications/$source_uuid/destinations" | jq -r '.. | objects | (.uuid? // empty)' | head -n1)"
   [[ -n "$destination" ]] || { echo "::error::Source Core destination is unavailable."; return 1; }
   cloned="$(api POST "applications/$source_uuid/clone" "$(jq -nc --arg destination_uuid "$destination" '{destination_uuid:$destination_uuid,name:"taso-core-prod",clone_volumes:false}')")"
   uuid="$(jq -r '.uuid//empty' <<<"$cloned")"
   [[ -n "$uuid" ]] || { echo "::error::Coolify did not return a cloned Core UUID."; return 1; }
   moved="$(api POST "applications/$uuid/move" "$(jq -nc --arg environment_uuid "$PROD_ENV_UUID" '{environment_uuid:$environment_uuid}')")"
   jq -e --arg e "$PROD_ENV_UUID" '.environment_uuid==$e' <<<"$moved" >/dev/null || { echo "::error::Cloned Core was not moved to production environment."; return 1; }
 fi
 api PATCH "applications/$uuid" "$(jq -nc '{name:"taso-core-prod",git_branch:"main",base_directory:"/taso",dockerfile_location:"/Dockerfile",ports_exposes:"3000",domains:"",custom_internal_name:"taso-core-prod",connect_to_docker_network:true,is_auto_deploy_enabled:false,is_preview_deployments_enabled:false}')" >/dev/null
 apps="$(api GET applications)"
 detail="$(api GET "applications/$uuid")"
 jq -e --arg r "$REPOSITORY" '.environment_id==2 and .git_repository==$r and .git_branch=="main" and (.fqdn//"")==""' <<<"$detail" >/dev/null || {
   echo "::error::Cloned Core production placement validation failed."
   return 1
 }
 envs="$(api GET "applications/$uuid/envs")"
 while IFS= read -r env_uuid; do
   [[ -z "$env_uuid" ]] && continue
   api DELETE "applications/$uuid/envs/$env_uuid" >/dev/null
 done < <(jq -r '.[]|select((.key//"")|startswith("TASO_PREVIEW_QA_"))|.uuid//empty' <<<"$envs")
 U["taso-core-prod"]="$uuid"
 if [[ "$core_preexisting" == true ]]; then
   echo "Configured existing taso-core-prod in place; production volume data was preserved."
 else
   echo "Configured taso-core-prod from source configuration clone without cloning volume data."
 fi
}
ensure_app taso-search-prod /docker/taso-search 8080 taso-search
'''
replace_once(marker, clone_fn, 'ensure_core insertion point')
replace_once('''ensure_app taso-core-prod /taso 3000 taso-core-prod
''', '''ensure_core_prod
''', 'Core application creation call')

old_secret_reuse = '''owner_email="$(reuse "$cf" TASO_OWNER_EMAIL)"; [[ -n "$owner_email" ]] || owner_email="$OWNER_EMAIL"
owner_hash="$(reuse "$cf" TASO_OWNER_PASSWORD_HASH)"; [[ -n "$owner_hash" ]] || owner_hash="$OWNER_HASH"
nvidia="$(reuse "$cf" TASO_PROVIDER_NVIDIA_API_KEY)"; [[ -n "$nvidia" ]] || nvidia="$NVIDIA_KEY"
github="$(reuse "$cf" TASO_GITHUB_TOKEN)"; [[ -n "$github" ]] || github="$GITHUB_TOKEN"
'''
new_secret_reuse = '''jq -e 'any(.[];.key=="TASO_OWNER_EMAIL") and any(.[];.key=="TASO_PROVIDER_NVIDIA_API_KEY") and any(.[];.key=="TASO_GITHUB_TOKEN")' "$cf" >/dev/null || {
 echo "::error::Production Core is missing required owner/provider configuration keys; refusing production auth bootstrap."
 exit 1
}
if jq -e 'any(.[];.key=="TASO_OWNER_PASSWORD_HASH")' "$cf" >/dev/null; then
 owner_credential_mode=hash
elif jq -e 'any(.[];.key=="TASO_OWNER_PASSWORD")' "$cf" >/dev/null; then
 owner_credential_mode=migrate
 put "$core" "$cf" TASO_AUTH_MIGRATE_OWNER_PASSWORD 1
 echo "Owner credential requires one-time in-container hash migration; secret value remains outside CI."
elif [[ "$core_preexisting" == true ]]; then
 core_detail="$(api GET "applications/$core")"
 core_status="$(jq -r '.status//"unknown"' <<<"$core_detail")"
 core_storages="$(api GET "applications/$core/storages")"
 jq -e 'any(.persistent_storages[]?;.mount_path=="/data")' <<<"$core_storages" >/dev/null || {
   echo "::error::Existing production Core has no persistent /data storage for the owner credential hash."
   exit 1
 }
 case "$core_status" in
   running|running:*) [[ "$core_status" != running:unhealthy ]] || { echo "::error::Existing production Core is unhealthy; persisted owner credential state cannot be trusted for redeploy."; exit 1; } ;;
   *) echo "::error::Existing production Core is not running; persisted owner credential state cannot be proven before redeploy."; exit 1 ;;
 esac
 current_session="$(curl -fsS --connect-timeout 10 --max-time 20 "https://$TASO_PRODUCTION_DOMAIN/api/auth/session")" || {
   echo "::error::Current production authentication session gate is unavailable; persisted owner credential state cannot be proven."
   exit 1
 }
 jq -e '.configured==true and .authenticated==false' <<<"$current_session" >/dev/null || {
   echo "::error::Current production authentication session gate does not prove a configured owner credential."
   exit 1
 }
 owner_credential_mode=persisted
 echo "Existing production Core has a healthy configured auth boundary and persistent /data storage; reusing the persisted owner password hash without reading it."
else
 echo "::error::New production Core has no owner password hash or one-time plaintext migration key; refusing bootstrap."
 exit 1
fi
'''
replace_once(old_secret_reuse, new_secret_reuse, 'secret value reuse block')

for old, new, label in [
(''' "NODE_ENV|production" "PORT|3000" "HOST|0.0.0.0" "TASO_OWNER_EMAIL|$owner_email" \\
 "TASO_OWNER_PASSWORD_HASH|$owner_hash" "TASO_AUTH_ALLOW_INSECURE_BOOTSTRAP|0" \\
''', ''' "NODE_ENV|production" "PORT|3000" "HOST|0.0.0.0" "TASO_AUTH_ALLOW_INSECURE_BOOTSTRAP|0" \\
 "TASO_OWNER_PASSWORD_HASH_FILE|/data/taso-owner-password.hash" \\
''', 'owner env writes'),
(''' "TASO_GITHUB_TOKEN|$github" "TASO_GITHUB_API_URL|https://api.github.com" \\
 "TASO_PROVIDER_NVIDIA_API_KEY|$nvidia" "TASO_PROVIDER_NVIDIA_BASE_URL|$NVIDIA_BASE" \\
 "TASO_PROVIDER_NVIDIA_MODEL|$NVIDIA_MODEL" "TASO_PROVIDER_NVIDIA_DATA|$NVIDIA_CLASS" \\
''', ''' "TASO_GITHUB_API_URL|https://api.github.com" \\
''', 'provider secret env writes'),
]:
    replace_once(old, new, label)

replace_once(
'''deploy taso-core-prod "$core"
deploy taso-ui-prod "$ui"
''',
'''deploy taso-core-prod "$core"
if [[ "${owner_credential_mode:-hash}" == migrate ]]; then
  echo "Removing one-time plaintext owner credential from Coolify production configuration."
  core_envs="$(api GET "applications/$core/envs")"
  removed_password=false
  while IFS= read -r env_uuid; do
    [[ -z "$env_uuid" ]] && continue
    api DELETE "applications/$core/envs/$env_uuid" >/dev/null
    removed_password=true
  done < <(jq -r '.[]|select(.key=="TASO_OWNER_PASSWORD")|.uuid//empty' <<<"$core_envs")
  [[ "$removed_password" == true ]] || { echo "::error::One-time owner plaintext environment entry was not found for cleanup."; exit 1; }
  core_envs="$(api GET "applications/$core/envs")"
  while IFS= read -r env_uuid; do
    [[ -z "$env_uuid" ]] && continue
    api DELETE "applications/$core/envs/$env_uuid" >/dev/null
  done < <(jq -r '.[]|select(.key=="TASO_AUTH_MIGRATE_OWNER_PASSWORD")|.uuid//empty' <<<"$core_envs")
  core_envs="$(api GET "applications/$core/envs")"
  jq -e 'all(.[];.key!="TASO_OWNER_PASSWORD" and .key!="TASO_AUTH_MIGRATE_OWNER_PASSWORD")' <<<"$core_envs" >/dev/null || { echo "::error::One-time production owner credential cleanup did not converge."; exit 1; }
  echo "One-time plaintext owner credential removed; redeploying Core to prove persisted hash restart."
  deploy taso-core-prod "$core"
elif [[ "${owner_credential_mode:-}" == persisted ]]; then
  echo "Production Core will prove the persisted hash again by completing this normal deployment with no plaintext owner credential configured."
fi
deploy taso-ui-prod "$ui"
''',
'Core migration cleanup deployment',
)

path.write_text(text)
PY

bash -n "$src"
echo "Production Core clone compatibility patch validated."
exec bash scripts/taso-production-bootstrap.sh
