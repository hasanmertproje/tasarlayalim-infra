#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
set +x
: "${COOLIFY_BASE_URL:=https://coolify.tasarlayalim.com}"
: "${COOLIFY_API_TOKEN:?COOLIFY_API_TOKEN is required}"
: "${TASO_PREVIEW_DOMAIN:=taso-urgent.demo.tasarlayalim.com}"
: "${TASO_PREVIEW_BRANCH:?TASO_PREVIEW_BRANCH is required}"
readonly API_BASE="${COOLIFY_BASE_URL%/}/api/v1"
readonly PROJECT_UUID=q8zrrvgln9f9zy1tz5q2db0w
readonly SERVER_UUID=h6e4ws8nwfi6stqjgrrhgaq6
readonly ENV_UUID=cy0sluzw26gnwozrqwiupqep
readonly GH_APP_UUID=2fzt2ok1zrpemvsz2gxhw4nw
readonly REPOSITORY=hasanmertproje/tasarlayalim-infra
readonly SOURCE_CORE=3slhlwoxz7bwdlnjpl7viw0f
readonly TMP="$(mktemp -d)" RESP="$TMP/response.json" PAYLOAD="$TMP/payload.json"
trap 'rm -rf "$TMP"' EXIT
api(){ local method="$1" path="$2" body="${3:-}" code; local args=(--silent --show-error --connect-timeout 15 --max-time 180 --output "$RESP" --write-out '%{http_code}' --header "Authorization: Bearer $COOLIFY_API_TOKEN" --header 'Accept: application/json'); if [[ -n "$body" ]];then printf '%s' "$body">"$PAYLOAD";args+=(--header 'Content-Type: application/json' --data-binary "@$PAYLOAD");fi;code="$(curl "${args[@]}" -X "$method" "$API_BASE/$path")";[[ "$code" =~ ^2 ]]||{ echo "::error::Coolify API $method $path failed (HTTP $code)." >&2;cat "$RESP"|jq -r '.message//.error//empty' >&2||true;return 1;};cat "$RESP";}
mask(){ [[ -n "${1:-}" ]]&&printf '::add-mask::%s\n' "$1"; }
apps="$(api GET applications)";src_envs="$(api GET "applications/$SOURCE_CORE/envs")";printf '%s' "$src_envs">"$TMP/source-envs.json"
src(){ jq -r --arg k "$1" '[.[]|select(.key==$k and .is_preview!=true)|.value//empty][0]//[.[]|select(.key==$k)|.value//empty][0]//empty' "$TMP/source-envs.json";}
owner_email="$(src TASO_OWNER_EMAIL)";owner_hash="$(src TASO_OWNER_PASSWORD_HASH)";owner_password="$(src TASO_OWNER_PASSWORD)";nvidia="$(src TASO_PROVIDER_NVIDIA_API_KEY)";nvidia_base="$(src TASO_PROVIDER_NVIDIA_BASE_URL)";nvidia_model="$(src TASO_PROVIDER_NVIDIA_MODEL)";nvidia_data="$(src TASO_PROVIDER_NVIDIA_DATA)";github_token="$(src TASO_GITHUB_TOKEN)"
[[ -n "$owner_email"&&-n "$nvidia" ]]||{ echo '::error::Preview owner or AI provider configuration is incomplete.';exit 1; }
[[ -n "$owner_hash"||-n "$owner_password" ]]||{ echo '::error::Preview owner credential is unavailable.';exit 1; }
: "${nvidia_base:=https://integrate.api.nvidia.com/v1}";: "${nvidia_model:=openai/gpt-oss-20b}";: "${nvidia_data:=private_code}"
for value in "$owner_email" "$owner_hash" "$owner_password" "$nvidia" "$github_token";do mask "$value";done
ensure_app(){ local name="$1" base="$2" port="$3" alias="$4" domain="${5:-}" uuid detail;uuid="$(jq -r --arg n "$name" '.[]|select(.name==$n)|.uuid'<<<"$apps"|head -n1)";if [[ -n "$uuid" ]];then detail="$(api GET "applications/$uuid")";jq -e --arg r "$REPOSITORY" '.environment_id==3 and .git_repository==$r'<<<"$detail">/dev/null||{ echo "::error::Refusing to alter unexpected app $name.";return 1;};else APP_NAME="$name" APP_BASE="$base" APP_PORT="$port" APP_ALIAS="$alias" APP_DOMAIN="$domain" node - <<'NODE' >"$PAYLOAD"
const b={project_uuid:'q8zrrvgln9f9zy1tz5q2db0w',server_uuid:'h6e4ws8nwfi6stqjgrrhgaq6',environment_name:'v2-preview',environment_uuid:'cy0sluzw26gnwozrqwiupqep',github_app_uuid:'2fzt2ok1zrpemvsz2gxhw4nw',git_repository:'hasanmertproje/tasarlayalim-infra',git_branch:process.env.TASO_PREVIEW_BRANCH,build_pack:'dockerfile',name:process.env.APP_NAME,base_directory:process.env.APP_BASE,dockerfile_location:'/Dockerfile',ports_exposes:process.env.APP_PORT,custom_internal_name:process.env.APP_ALIAS,connect_to_docker_network:true,autogenerate_domain:false,is_auto_deploy_enabled:false,is_preview_deployments_enabled:false,instant_deploy:false,tags:['taso-urgent-preview']};if(process.env.APP_DOMAIN)b.domains='https://'+process.env.APP_DOMAIN;process.stdout.write(JSON.stringify(b));
NODE
uuid="$(jq -r '.uuid//empty'<<<"$(api POST applications/private-github-app "$(<"$PAYLOAD")")")";[[ -n "$uuid" ]]||return 1;apps="$(api GET applications)";fi;printf '%s' "$uuid";}
search="$(ensure_app taso-urgent-search /docker/taso-search 8080 taso-urgent-search)";core="$(ensure_app taso-urgent-core /taso 3000 taso-urgent-core)";ui="$(ensure_app taso-urgent-ui /taso-ui 80 taso-urgent-ui "$TASO_PREVIEW_DOMAIN")"
put(){ local app="$1" key="$2" value="$3" file method body;[[ -n "$value" ]]||return 0;mask "$value";file="$TMP/env-$app.json";api GET "applications/$app/envs">"$file";if jq -e --arg k "$key" 'any(.[];.key==$k)' "$file">/dev/null;then method=PATCH;else method=POST;fi;ENV_KEY="$key" ENV_VALUE="$value" node -e 'process.stdout.write(JSON.stringify({key:process.env.ENV_KEY,value:process.env.ENV_VALUE,is_preview:false,is_shown_once:false}))'>"$PAYLOAD";body="$(<"$PAYLOAD")";api "$method" "applications/$app/envs" "$body">/dev/null;}
gateway="$(openssl rand -hex 32)";authkey="$(openssl rand -hex 32)";qa_email="qa-$(date +%s)@preview.tasarlayalim.local";qa_password="$(openssl rand -base64 42|tr -d '\n')";qa_expiry="$(( $(date +%s%3N)+3600000 ))";for value in "$gateway" "$authkey" "$qa_email" "$qa_password";do mask "$value";done
for kv in "NODE_ENV|production" "TASO_DEPLOYMENT_ENV|preview" "TASO_OWNER_EMAIL|$owner_email" "TASO_OWNER_PASSWORD_HASH|$owner_hash" "TASO_OWNER_PASSWORD|$owner_password" "TASO_AUTH_ALLOW_INSECURE_BOOTSTRAP|0" "TASO_SESSION_TTL_MS|43200000" "TASO_GATEWAY_SECRET|$gateway" "TASO_AUTH_ENCRYPTION_KEY|$authkey" "TASO_AUTH_SECURITY_FILE|/data/taso-auth-security.json" "TASO_STATE_FILE|/data/taso-state.json" "TASO_IDENTITY_FILE|/data/taso-identities.json" "TASO_CONTROL_PLANE_FILE|/data/taso-control-plane.json" "TASO_INCIDENT_FILE|/data/taso-incidents.json" "TASO_PERSONALIZATION_FILE|/data/taso-personalization.json" "TASO_PROVIDER_NVIDIA_API_KEY|$nvidia" "TASO_PROVIDER_NVIDIA_BASE_URL|$nvidia_base" "TASO_PROVIDER_NVIDIA_MODEL|$nvidia_model" "TASO_PROVIDER_NVIDIA_DATA|$nvidia_data" "TASO_GITHUB_TOKEN|$github_token" "TASO_SEARCH_ENDPOINT|http://taso-urgent-search:8080/search" "TASO_PREVIEW_QA_EMAIL|$qa_email" "TASO_PREVIEW_QA_PASSWORD|$qa_password" "TASO_PREVIEW_QA_EXPIRES_AT|$qa_expiry";do put "$core" "${kv%%|*}" "${kv#*|}";done
put "$search" PORT 8080;put "$ui" TASO_CORE_UPSTREAM http://taso-urgent-core:3000;put "$ui" TASO_GATEWAY_SECRET "$gateway"
for app in "$search" "$core" "$ui";do api PATCH "applications/$app" "$(jq -nc --arg branch "$TASO_PREVIEW_BRANCH" '{git_branch:$branch,connect_to_docker_network:true}')">/dev/null;done
for tuple in "search:$search" "core:$core" "ui:$ui";do name="${tuple%%:*}";uuid="${tuple#*:}";queued="$(api POST "deploy?uuid=$uuid")";jq -e --arg u "$uuid" '(.deployments//[])|any(.resource_uuid==$u)'<<<"$queued">/dev/null||{ echo "::error::$name deploy was not queued";exit 1;};done
wait_running(){ local uuid="$1" label="$2" status;for _ in $(seq 1 90);do status="$(api GET "applications/$uuid"|jq -r '.status//"unknown"')";[[ "$status" == running:healthy ]]&&return 0;[[ "$status" == exited*||"$status" == degraded* ]]&&{ echo "::error::$label entered $status";return 1;};sleep 5;done;echo "::error::$label did not become healthy";return 1;}
wait_running "$search" search;wait_running "$core" core;wait_running "$ui" ui
for _ in $(seq 1 24);do curl -fsS "https://$TASO_PREVIEW_DOMAIN/health">/dev/null&&break;sleep 5;done
curl -fsS "https://$TASO_PREVIEW_DOMAIN/health">/dev/null
session="$(curl -fsS "https://$TASO_PREVIEW_DOMAIN/api/auth/session")";jq -e '.configured==true and .authenticated==false'<<<"$session">/dev/null
jar="$TMP/cookies";login="$(curl -fsS -c "$jar" -H 'content-type: application/json' --data-binary "$(jq -nc --arg email "$qa_email" --arg password "$qa_password" '{email:$email,password:$password}')" "https://$TASO_PREVIEW_DOMAIN/api/auth/login")";challenge="$(jq -r '.challengeId//empty'<<<"$login")";secret="$(jq -r '.secret//empty'<<<"$login")";[[ -n "$challenge"&&-n "$secret" ]]||{ echo '::error::QA login did not start TOTP enrollment.';exit 1;};mask "$secret"
code="$(TOTP_SECRET="$secret" node - <<'NODE'
const c=require('node:crypto'),a='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',s=process.env.TOTP_SECRET.replace(/=+$/,'');let bits=0,v=0,b=[];for(const x of s){v=(v<<5)|a.indexOf(x);bits+=5;if(bits>=8){b.push((v>>>(bits-8))&255);bits-=8}}const q=Buffer.alloc(8);q.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const d=c.createHmac('sha1',Buffer.from(b)).update(q).digest(),o=d.at(-1)&15,n=((d[o]&127)<<24)|((d[o+1]&255)<<16)|((d[o+2]&255)<<8)|(d[o+3]&255);process.stdout.write(String(n%1e6).padStart(6,'0'));
NODE
)";mask "$code"
enrolled="$(curl -fsS -b "$jar" -c "$jar" -H 'content-type: application/json' --data-binary "$(jq -nc --arg challengeId "$challenge" --arg code "$code" '{challengeId:$challengeId,code:$code,deviceName:"GitHub Actions preview QA"}')" "https://$TASO_PREVIEW_DOMAIN/api/auth/2fa/setup/confirm")";jq -e '.authenticated==true'<<<"$enrolled">/dev/null
projects="$(curl -fsS -b "$jar" "https://$TASO_PREVIEW_DOMAIN/api/v1/projects")";project_id="$(jq -r '.projects[0].id//empty'<<<"$projects")";[[ -n "$project_id" ]]||exit 1
chat="$(curl -fsS -b "$jar" -H 'content-type: application/json' --data-binary "$(jq -nc --arg projectId "$project_id" '{projectId:$projectId,text:"Merhaba Taso. Kendini tek cümlede tanıt."}')" "https://$TASO_PREVIEW_DOMAIN/api/v1/conversations/messages")";jq -e '.assistantMessage.replyMode=="ai" and (.assistantMessage.content|length>10)'<<<"$chat">/dev/null
web="$(curl -fsS -b "$jar" -H 'content-type: application/json' --data-binary "$(jq -nc --arg projectId "$project_id" '{projectId:$projectId,text:"OpenAI resmi sitesini webde ara ve kaynakla yanıtla.",webSearch:true}')" "https://$TASO_PREVIEW_DOMAIN/api/v1/conversations/messages")";jq -e '.assistantMessage.replyMode=="ai" and (.assistantMessage.sources|length>0)'<<<"$web">/dev/null
printf '### TASO urgent preview verified\n- URL: https://%s\n- UI health: PASS\n- Session gate: PASS\n- Real AI chat: PASS\n- Web search with sources: PASS\n- QA account expires automatically within one hour.\n' "$TASO_PREVIEW_DOMAIN" >>"${GITHUB_STEP_SUMMARY:-/dev/null}"
