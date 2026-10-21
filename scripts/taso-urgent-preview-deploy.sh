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
readonly TMP="$(mktemp -d)"
readonly RESP="$TMP/response.json"
readonly PAYLOAD="$TMP/payload.json"
trap 'rm -rf "$TMP"' EXIT
api(){
 local method="$1" path="$2" body="${3:-}" code="" attempt=1 curl_ok=0
 local args=(--silent --show-error --connect-timeout 15 --max-time 180 --output "$RESP" --write-out '%{http_code}' --header "Authorization: Bearer $COOLIFY_API_TOKEN" --header 'Accept: application/json')
 if [[ -n "$body" ]];then printf '%s' "$body">"$PAYLOAD";args+=(--header 'Content-Type: application/json' --data-binary "@$PAYLOAD");fi
 while :;do
  : >"$RESP"
  if code="$(curl "${args[@]}" -X "$method" "$API_BASE/$path")";then curl_ok=1;else curl_ok=0;fi
  if [[ "$curl_ok" == 1 && "$code" =~ ^2 ]];then cat "$RESP";return 0;fi
  # Retry only idempotent GETs on transport errors or 5xx. Never replay POST/PATCH mutations.
  if [[ "$method" == GET && "$attempt" -lt 3 && ( "$curl_ok" == 0 || "$code" == 000 || "$code" =~ ^5[0-9][0-9]$ ) ]];then
   attempt=$((attempt+1));echo "::warning::Transient Coolify GET failure; retrying safe read ($attempt/3)." >&2;sleep "$attempt";continue
  fi
  echo "::error::Coolify API $method $path failed (HTTP ${code:-000})." >&2
  # Do not emit raw Coolify error messages: they may contain credentials or request data.
  return 1
 done
}
mask(){ [[ -n "${1:-}" ]]&&printf '::add-mask::%s\n' "$1"; }
apps="$(api GET applications)"
ensure_app(){ local name="$1" base="$2" port="$3" alias="$4" domain="${5:-}" uuid detail;uuid="$(jq -r --arg n "$name" '.[]|select(.name==$n)|.uuid'<<<"$apps"|head -n1)";if [[ -n "$uuid" ]];then detail="$(api GET "applications/$uuid")";jq -e --arg r "$REPOSITORY" '.environment_id==3 and .git_repository==$r'<<<"$detail">/dev/null||{ echo "::error::Refusing to alter unexpected app $name.";return 1;};else APP_NAME="$name" APP_BASE="$base" APP_PORT="$port" APP_ALIAS="$alias" APP_DOMAIN="$domain" node - <<'NODE' >"$PAYLOAD"
const b={project_uuid:'q8zrrvgln9f9zy1tz5q2db0w',server_uuid:'h6e4ws8nwfi6stqjgrrhgaq6',environment_name:'v2-preview',environment_uuid:'cy0sluzw26gnwozrqwiupqep',github_app_uuid:'2fzt2ok1zrpemvsz2gxhw4nw',git_repository:'hasanmertproje/tasarlayalim-infra',git_branch:process.env.TASO_PREVIEW_BRANCH,build_pack:'dockerfile',name:process.env.APP_NAME,base_directory:process.env.APP_BASE,dockerfile_location:'/Dockerfile',ports_exposes:process.env.APP_PORT,custom_internal_name:process.env.APP_ALIAS,connect_to_docker_network:true,autogenerate_domain:false,is_auto_deploy_enabled:false,is_preview_deployments_enabled:false,instant_deploy:false,tags:['taso-urgent-preview']};if(process.env.APP_DOMAIN)b.domains='https://'+process.env.APP_DOMAIN;process.stdout.write(JSON.stringify(b));
NODE
uuid="$(jq -r '.uuid//empty'<<<"$(api POST applications/private-github-app "$(<"$PAYLOAD")")")";[[ -n "$uuid" ]]||return 1;apps="$(api GET applications)";fi;printf '%s' "$uuid";}
ensure_core(){ local uuid detail destination cloned;uuid="$(jq -r '.[]|select(.name=="taso-urgent-core")|.uuid'<<<"$apps"|head -n1)";if [[ -n "$uuid" ]];then detail="$(api GET "applications/$uuid")";jq -e --arg r "$REPOSITORY" '.environment_id==3 and .git_repository==$r'<<<"$detail">/dev/null||{ echo '::error::Refusing to alter unexpected urgent core.';return 1;};else destination="$(api GET "applications/$SOURCE_CORE/destinations"|jq -r '.. | objects | (.uuid? // empty)'|head -n1)";[[ -n "$destination" ]]||{ echo '::error::Source Core destination is unavailable.';return 1;};cloned="$(api POST "applications/$SOURCE_CORE/clone" "$(jq -nc --arg destination_uuid "$destination" '{destination_uuid:$destination_uuid,name:"taso-urgent-core",clone_volumes:false}')")";uuid="$(jq -r '.uuid//empty'<<<"$cloned")";[[ -n "$uuid" ]]||return 1;apps="$(api GET applications)";fi;api PATCH "applications/$uuid" "$(jq -nc --arg branch "$TASO_PREVIEW_BRANCH" '{name:"taso-urgent-core",git_branch:$branch,base_directory:"/taso",dockerfile_location:"/Dockerfile",ports_exposes:"3000",domains:"",custom_internal_name:"taso-urgent-core",connect_to_docker_network:true}')" >/dev/null;printf '%s' "$uuid";}
search="$(ensure_app taso-urgent-search /docker/taso-search 8080 taso-urgent-search)";core="$(ensure_core)";ui="$(ensure_app taso-urgent-ui /taso-ui 80 taso-urgent-ui "$TASO_PREVIEW_DOMAIN")"
ensure_storage(){ local app="$1" all sid;all="$(api GET "applications/$app/storages")";sid="$(jq -r '[.persistent_storages[]?|select(.mount_path=="/data")][0].uuid//empty'<<<"$all")";if [[ -z "$sid" ]];then api POST "applications/$app/storages" '{"type":"persistent","name":"taso-urgent-core-data","mount_path":"/data"}' >/dev/null;fi;}
ensure_storage "$core"
put(){ local app="$1" key="$2" value="$3" file method body;[[ -n "$value" ]]||return 0;mask "$value";file="$TMP/env-$app.json";api GET "applications/$app/envs">"$file";if jq -e --arg k "$key" 'any(.[];.key==$k)' "$file">/dev/null;then method=PATCH;else method=POST;fi;ENV_KEY="$key" ENV_VALUE="$value" node -e 'process.stdout.write(JSON.stringify({key:process.env.ENV_KEY,value:process.env.ENV_VALUE,is_preview:false,is_shown_once:false}))'>"$PAYLOAD";body="$(<"$PAYLOAD")";api "$method" "applications/$app/envs" "$body">/dev/null;}
gateway="$(openssl rand -hex 32)";authkey="$(openssl rand -hex 32)";search_secret="$(openssl rand -hex 32)";qa_email="qa-$(date +%s)@preview.tasarlayalim.local";qa_password="$(openssl rand -base64 42|tr -d '\n')";qa_expiry="$(( $(date +%s%3N)+3600000 ))";# The generated .local QA email is an identifier, not a credential. Masking its epoch suffix redacts unrelated timing/request-ID digits.
for value in "$gateway" "$authkey" "$search_secret" "$qa_password";do mask "$value";done
for kv in "NODE_ENV|production" "TASO_DEPLOYMENT_ENV|preview" "TASO_CONVERSATION_PROVIDER_TIMEOUT_MS|18000" "TASO_CONVERSATION_TOTAL_TIMEOUT_MS|35000" "TASO_AUTH_ALLOW_INSECURE_BOOTSTRAP|1" "TASO_SESSION_TTL_MS|43200000" "TASO_GATEWAY_SECRET|$gateway" "TASO_AUTH_ENCRYPTION_KEY|$authkey" "TASO_AUTH_SECURITY_FILE|/data/taso-auth-security.json" "TASO_STATE_FILE|/data/taso-state.json" "TASO_IDENTITY_FILE|/data/taso-identities.json" "TASO_CONTROL_PLANE_FILE|/data/taso-control-plane.json" "TASO_INCIDENT_FILE|/data/taso-incidents.json" "TASO_PERSONALIZATION_FILE|/data/taso-personalization.json" "TASO_SEARCH_ENDPOINT|http://taso-urgent-search:8080/search" "TASO_PREVIEW_QA_EMAIL|$qa_email" "TASO_PREVIEW_QA_PASSWORD|$qa_password" "TASO_PREVIEW_QA_EXPIRES_AT|$qa_expiry";do put "$core" "${kv%%|*}" "${kv#*|}";done
put "$search" PORT 8080;put "$search" SEARXNG_SECRET "$search_secret";put "$ui" TASO_CORE_UPSTREAM http://taso-urgent-core:3000;put "$ui" TASO_GATEWAY_SECRET "$gateway"
for app in "$search" "$core" "$ui";do api PATCH "applications/$app" "$(jq -nc --arg branch "$TASO_PREVIEW_BRANCH" '{git_branch:$branch,connect_to_docker_network:true}')">/dev/null;done
wait_deployment(){ local deployment_uuid="$1" label="$2" status detail;for _ in $(seq 1 120);do detail="$(api GET "deployments/$deployment_uuid")";status="$(jq -r '.status//"unknown"'<<<"$detail")";case "$status" in finished) echo "$label deployment finished: $deployment_uuid";return 0;; failed|cancelled|cancelled-by-user) printf '%s' "$detail" | node scripts/taso-preview-deployment-diagnostic.mjs;echo "::error::$label deployment entered $status (redacted category above).";return 1;; esac;sleep 5;done;detail="$(api GET "deployments/$deployment_uuid")";printf '%s' "$detail" | node scripts/taso-preview-deployment-diagnostic.mjs;echo "::error::$label deployment did not finish within bounded 10 minute window.";return 1;}
for tuple in "search:$search" "core:$core" "ui:$ui";do name="${tuple%%:*}";uuid="${tuple#*:}";queued="$(api POST "deploy?uuid=$uuid")";deployment_uuid="$(jq -r --arg u "$uuid" '[.deployments[]?|select(.resource_uuid==$u)][0].deployment_uuid//empty'<<<"$queued")";[[ -n "$deployment_uuid" ]]||{ echo "::error::$name deploy was not queued with a deployment UUID";exit 1;};wait_deployment "$deployment_uuid" "$name";done
wait_running(){ local uuid="$1" label="$2" status;for _ in $(seq 1 30);do status="$(api GET "applications/$uuid"|jq -r '.status//"unknown"')";[[ "$status" == running:* || "$status" == running ]]&&{ echo "$label runtime state: $status";return 0;};[[ "$status" == exited*||"$status" == degraded*||"$status" == stopped* ]]&&{ echo "::error::$label entered $status";return 1;};sleep 5;done;echo "::error::$label did not enter a running state";return 1;}
wait_running "$search" search;wait_running "$core" core;wait_running "$ui" ui
# Coolify may report running:unknown when an image has no platform healthcheck. Do not call the preview ready from that metadata alone: the exact queued deployments must finish first, then the public UI health, auth gate, direct search-provider probe, real AI turn, and sourced web-search probes below are authoritative acceptance checks.
echo 'acceptance: waiting for public UI health'
for _ in $(seq 1 24);do curl -fsS "https://$TASO_PREVIEW_DOMAIN/health">/dev/null&&break;sleep 5;done
echo 'acceptance: public UI health'
curl -fsS "https://$TASO_PREVIEW_DOMAIN/health">/dev/null
echo 'acceptance: unauthenticated session gate'
session="$(curl -fsS "https://$TASO_PREVIEW_DOMAIN/api/auth/session")";jq -e '.configured==true and .authenticated==false'<<<"$session">/dev/null
jar="$TMP/cookies"
echo 'acceptance: QA login'
login="$(curl -fsS -c "$jar" -H 'content-type: application/json' --data-binary "$(jq -nc --arg email "$qa_email" --arg password "$qa_password" '{email:$email,password:$password}')" "https://$TASO_PREVIEW_DOMAIN/api/auth/login")";challenge="$(jq -r '.challengeId//empty'<<<"$login")";secret="$(jq -r '.secret//empty'<<<"$login")";[[ -n "$challenge"&&-n "$secret" ]]||{ echo '::error::QA login did not start TOTP enrollment.';exit 1;};mask "$secret"
code="$(TOTP_SECRET="$secret" node - <<'NODE'
const c=require('node:crypto'),a='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',s=process.env.TOTP_SECRET.replace(/=+$/,'');let bits=0,v=0,b=[];for(const x of s){v=(v<<5)|a.indexOf(x);bits+=5;if(bits>=8){b.push((v>>>(bits-8))&255);bits-=8}}const q=Buffer.alloc(8);q.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const d=c.createHmac('sha1',Buffer.from(b)).update(q).digest(),o=d.at(-1)&15,n=((d[o]&127)<<24)|((d[o+1]&255)<<16)|((d[o+2]&255)<<8)|(d[o+3]&255);process.stdout.write(String(n%1e6).padStart(6,'0'));
NODE
)";mask "$code"
echo 'acceptance: QA TOTP enrollment'
enrolled="$(curl -fsS -b "$jar" -c "$jar" -H 'content-type: application/json' --data-binary "$(jq -nc --arg challengeId "$challenge" --arg code "$code" '{challengeId:$challengeId,code:$code,deviceName:"GitHub Actions preview QA"}')" "https://$TASO_PREVIEW_DOMAIN/api/auth/2fa/setup/confirm")";jq -e '.authenticated==true'<<<"$enrolled">/dev/null
echo 'acceptance: authenticated projects'
projects="$(curl -fsS -b "$jar" "https://$TASO_PREVIEW_DOMAIN/api/v1/projects")";project_id="$(jq -r '.projects[0].id//empty'<<<"$projects")";[[ -n "$project_id" ]]||exit 1
echo 'acceptance: direct search provider'
research_file="$TMP/research.json";research_code="$(curl -sS -b "$jar" -o "$research_file" -w '%{http_code}' -H 'content-type: application/json' --data-binary '{"query":"OpenAI official site","limit":3}' "https://$TASO_PREVIEW_DOMAIN/api/v1/research/search")";if [[ "$research_code" != 200 ]];then research_error="$(jq -r '.error//"unknown research error"' "$research_file" 2>/dev/null|head -c 300)";echo "::error::Direct research search failed (HTTP $research_code): $research_error";exit 1;fi;jq -e '(.results//[])|length>0' "$research_file">/dev/null||{ echo '::error::Direct research search returned no sources.';exit 1;}
echo 'acceptance: real AI chat'
# Do not retry the Core conversation POST: that would create duplicate history.
# On failure, only log safe provider category/attempt-count diagnostics, never body/keys.
chat_file="$TMP/ai-chat.json"
chat_code="$(curl -sS --max-time 105 -b "$jar" -o "$chat_file" -w '%{http_code}' -H 'content-type: application/json' --data-binary "$(jq -nc --arg projectId "$project_id" '{projectId:$projectId,text:"Merhaba Taso. Kendini tek cümlede tanıt."}')" "https://$TASO_PREVIEW_DOMAIN/api/v1/conversations/messages" || true)"
if [[ "$chat_code" != 201 ]];then
 health_file="$TMP/ai-health.json"
 curl -sS --max-time 12 -o "$health_file" "https://$TASO_PREVIEW_DOMAIN/api/health" || true
 category="$(jq -r '.conversation.lastFailure.code//"UNKNOWN"' "$chat_file" 2>/dev/null || echo UNKNOWN)"
 [[ "$category" =~ ^[A-Z0-9_]{1,30}$ ]]||category=UNKNOWN
 attempts="$(jq -r '.conversation.lastFailure.attempts//0' "$chat_file" 2>/dev/null || echo 0)"
 provider="$(jq -r '.conversation.lastFailure.provider//.conversation.provider//"unknown"' "$chat_file" 2>/dev/null || echo unknown)"
 phase="$(jq -r '.conversation.lastFailure.phase//"unknown"' "$chat_file" 2>/dev/null || echo unknown)"
 elapsed_ms="$(jq -r '.conversation.lastFailure.elapsedMs//0' "$chat_file" 2>/dev/null || echo 0)"
 diagnostic_id="$(jq -r '.diagnosticId//.conversation.lastFailure.requestId//"unavailable"' "$chat_file" 2>/dev/null || echo unavailable)"
 eligible="$(jq -r '(.conversation.eligibleProviders//[])|length' "$chat_file" 2>/dev/null || echo 0)"
 configured="$(jq -r '.conversation.configured//false' "$chat_file" 2>/dev/null || echo false)"
 [[ "$attempts" =~ ^[0-9]{1,3}$ ]]||attempts=0
 [[ "$elapsed_ms" =~ ^[0-9]{1,8}$ ]]||elapsed_ms=0
 [[ "$eligible" =~ ^[0-9]{1,3}$ ]]||eligible=0
 [[ "$provider" =~ ^[a-zA-Z0-9_-]{1,40}$ ]]||provider=unknown
 [[ "$phase" =~ ^[a-z-]{1,30}$ ]]||phase=unknown
 [[ "$diagnostic_id" =~ ^[0-9a-fA-F-]{36}$ ]]||diagnostic_id=unavailable
 [[ "$configured" == true || "$configured" == false ]]||configured=false
 # These are closed enums/metadata only; never print response bodies or request data.
 echo "::error::Real AI chat failed: HTTP $chat_code; category=$category; phase=$phase; provider=$provider; attempts=$attempts; elapsed_ms=$elapsed_ms; eligible_providers=$eligible; provider_configured=$configured; diagnostic_id=$diagnostic_id"
 exit 1
fi
jq -e '.assistantMessage.replyMode=="ai" and (.assistantMessage.content|length>10)' "$chat_file">/dev/null||{ echo "::error::Real AI response missing or non-AI";exit 1;}
echo 'acceptance: sourced web search'
web_file="$TMP/ai-web-search.json"
web_code="$(curl -sS --max-time 105 -b "$jar" -o "$web_file" -w '%{http_code}' -H 'content-type: application/json' --data-binary "$(jq -nc --arg projectId "$project_id" '{projectId:$projectId,text:"OpenAI resmi sitesini webde ara ve kaynakla yanıtla.",webSearch:true}')" "https://$TASO_PREVIEW_DOMAIN/api/v1/conversations/messages" || true)"
if [[ "$web_code" != 201 ]];then
 category="$(jq -r '.conversation.lastFailure.code//"UNKNOWN"' "$web_file" 2>/dev/null || echo UNKNOWN)"
 [[ "$category" =~ ^[A-Z0-9_]{1,30}$ ]]||category=UNKNOWN
 attempts="$(jq -r '.conversation.lastFailure.attempts//0' "$web_file" 2>/dev/null || echo 0)"
 provider="$(jq -r '.conversation.lastFailure.provider//.conversation.provider//"unknown"' "$web_file" 2>/dev/null || echo unknown)"
 phase="$(jq -r '.conversation.lastFailure.phase//"unknown"' "$web_file" 2>/dev/null || echo unknown)"
 elapsed_ms="$(jq -r '.conversation.lastFailure.elapsedMs//0' "$web_file" 2>/dev/null || echo 0)"
 diagnostic_id="$(jq -r '.diagnosticId//.conversation.lastFailure.requestId//"unavailable"' "$web_file" 2>/dev/null || echo unavailable)"
 [[ "$attempts" =~ ^[0-9]{1,3}$ ]]||attempts=0
 [[ "$elapsed_ms" =~ ^[0-9]{1,8}$ ]]||elapsed_ms=0
 [[ "$provider" =~ ^[a-zA-Z0-9_-]{1,40}$ ]]||provider=unknown
 [[ "$phase" =~ ^[a-z-]{1,30}$ ]]||phase=unknown
 [[ "$diagnostic_id" =~ ^[0-9a-fA-F-]{36}$ ]]||diagnostic_id=unavailable
 echo "::error::Sourced AI web acceptance failed: HTTP $web_code; category=$category; phase=$phase; provider=$provider; attempts=$attempts; elapsed_ms=$elapsed_ms; diagnostic_id=$diagnostic_id"
 exit 1
fi
web="$(cat "$web_file")"
jq -e '.assistantMessage.replyMode=="ai" and (.assistantMessage.sources|length>0)'<<<"$web">/dev/null||{ echo "::error::Sourced web search returned no AI response or verifiable sources";exit 1;}
printf '### TASO urgent preview verified\n- URL: https://%s\n- UI health: PASS\n- Session gate: PASS\n- Direct search provider: PASS\n- Real AI chat: PASS\n- Web search with sources: PASS\n- QA account expires automatically within one hour.\n' "$TASO_PREVIEW_DOMAIN" >>"${GITHUB_STEP_SUMMARY:-/dev/null}"
