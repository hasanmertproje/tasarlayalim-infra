# TASO v1.0 Acceptance Ledger

Last updated: 2026-10-12

## Evidence policy
A scenario is PASS only with executable evidence: CI/test log, runtime response, health probe, browser acceptance, deployment record, or equivalent. Source-code presence alone is not PASS.

## Package A — conversation transport recovery parity
### Implementation and merge
- Typed `DashboardChat` recovery after transport drop: IMPLEMENTED on main by PR #118.
- `ConversationBridgeV2` typed recovery: IMPLEMENTED by PR #119 through bounded persisted-history recovery.
- `ConversationBridgeV2` voice-originated recovery: IMPLEMENTED by PR #119 through the same send/recovery path.
- PR #119 final pre-merge head: `37de23cdbe66c78545a5f66dc911c00abff873e4`.
- PR #119 merge SHA: `c984105d6d686b661104c8409bf0e188e7bb69eb`.

### Verified pre-merge evidence for PR #119
- `Taso CI` run 623: PASS.
- `Taso Browser CI` run 106: PASS.
- `Taso Urgent Preview` run 22: PASS.
- Exact Coolify deployment completion before preview runtime probes: PASS.
- Public preview `/health`: PASS.
- Unauthenticated session gate: PASS.
- Temporary preview QA login + TOTP enrollment: PASS.
- Authenticated projects access: PASS.
- Direct SearXNG-backed research search: PASS.
- Real AI conversation: PASS.
- Natural-language sourced web-search conversation: PASS.
- Core auth/security smoke including trusted-device/gateway behavior: PASS.
- Direct unauthenticated Core API rejection: PASS.

### Recovery acceptance boundary
- Bounded persisted-history recovery without blind duplicate turn resubmission: IMPLEMENTED + CI/PREVIEW VERIFIED.
- Same recovery path when `fromVoice=true`: IMPLEMENTED + CI/PREVIEW VERIFIED.
- Production transport-drop fault injection: **NOT RUN**.
- Therefore transport recovery itself is not labeled production LIVE VERIFIED yet.

## Package A — voice web parity / final transcript
### Active implementation path
- The active dashboard voice path is `DashboardChat`, reached from mobile through `MobileVoiceRouter`.
- Interim recognition results only update presentation/input state and do not call the Core conversation POST endpoint.
- A per-recognition `finalSubmitted` guard allows one final transcript to enter `sendText(..., true)` at most once, even if the same final speech event is delivered more than once.
- Voice and typed text use the same `/v1/conversations/messages` Core endpoint.
- The same `webSearch` selection is included for voice-originated turns.
- Voice does not create a Mission automatically and does not open a separate direct-provider voice conversation path.

### Executable acceptance evidence
- PR #153 final head: `fd1d0ec0e76eee133f917ba1b096a2d09d98df20`.
- `Taso Browser CI` run #196, run ID `38188656465`: **PASS**.
- `visual-acceptance` job `114630481945`: **PASS**.
- `scripts/taso-visual-acceptance.mjs` `voiceCoreAcceptance()` verifies interim=0 conversation/Mission POST, duplicate final=1 Core POST, `webSearch=true`, no direct provider bypass, no Mission auto-create, source rendering, and `core-conversation` policy.
- Status: **IMPLEMENTED + MERGED + CI VERIFIED**.
- Production voice-originated web research with a real authenticated production user is still **NOT RUN / NOT LIVE VERIFIED**.

## Package A — voice history persistence + reopen
### Implementation boundary
- Package A deliberately reuses the authoritative project-scoped `ConversationStore`; it does not introduce the Package B `ConversationThread` model early.
- `POST /v1/conversations/messages` persists the voice-originated final user turn and assistant response through the same Core path used by typed text.
- `GET /v1/conversations?projectId=...` remains the authoritative reopen source for this stabilization slice.

### Executable acceptance evidence
- PR #157: `test: verify voice history persistence and reopen`.
- PR #157 merge SHA: `4f346fda621da16583eba8b7b18e1c4338e3970f`.
- `Taso CI` run #747, run ID `38225154677`: **PASS**.
- `Taso Browser CI` run #230, run ID `38225154692`: **PASS**.
- `visual-acceptance` job `114730731705`: **PASS**.
- `Assert voice history persistence and reopen` step: **PASS**.
- Exact test evidence:
  - one final voice turn -> `conversationPosts=1`;
  - persisted user ID `message_57149885-896e-4918-a2e1-660a8ae212ac`;
  - persisted assistant ID `message_092b601c-7357-4781-a063-ac9c60fa018f`;
  - `reloadRestoredSameIds=true`;
  - `crossProjectLeakage=false`;
  - `resubmittedOnReopen=false`.
- The test uses the real isolated Core/UI stack, resets only ephemeral CI containers between suites to avoid sharing TOTP enrollment state, and uploads evidence artifact `11736501145`.
- Existing visual, voice final-transcript, auth, and browser-worker gates remained green.
- Status: **IMPLEMENTED + MERGED + CI VERIFIED**.
- This does not claim Package B archive/trash/pagination/thread data-model work is implemented.

## Production platform acceptance — 2026-10-12
### Main/deploy identity
- The currently active LIVE VERIFIED UI/Core deployment was established from SHA `5aa4035387b82e934005e9fc85bf2d2f3d6a1466` (PR #143 merge).
- `Taso Production Deploy` run #14, run ID `38178848246`: **PASS**.
- Post-deploy read-only Coolify snapshot: **PASS**.
- Repository changes through PR #157 are merged but are not automatically considered deployed or LIVE VERIFIED.

### Production routing and auth boundary
- DNS preflight: PASS.
- Production domain unique-owner guard: PASS; `taso-ui-prod` is the only Coolify application owning `taso.tasarlayalim.com`.
- Outer Coolify/Traefik Basic Auth on production UI: DISABLED and verified.
- Public HTTPS UI/Core health probe: PASS.
- `/api/auth/session` unauthenticated gate: PASS (`configured=true`, `authenticated=false`).

### Production service deployment evidence
- Core active deployment: PASS — `r7yhxsqeef4jpjkrlydypbbm`, commit `5aa4035387b82e934005e9fc85bf2d2f3d6a1466`, runtime `running:healthy`.
- UI active deployment: PASS — `obsqexcobmp446wzeli8rq0m`, commit `5aa4035387b82e934005e9fc85bf2d2f3d6a1466`, runtime `running:healthy`.
- Recovered post-incident snapshot additionally observed:
  - Search latest finished deployment `balxbwvsatjl1zhnd5svaydp`, commit `a38f091bf03ab309e14f8ab8bfd6d78d112aca04`;
  - Browser latest finished deployment `pxrmldrwx3shngp8kee0kmon`, commit `86da9451827e1e7ef2757023dda6810007303159`, runtime `running:healthy`;
  - Speaker latest finished deployment `rnygvyxpe7zrjp8bt3witqix`, commit `4e6ee8904e18908d6044d687735d91d705726209`, runtime `running:healthy`;
  - Voice latest finished deployment `cszyhbmktugukkmqvryvd6rc`, commit `4e6ee8904e18908d6044d687735d91d705726209`.
- Search/Voice may surface `running:unknown` where no Docker healthcheck is defined; `unknown` is not upgraded to `healthy` and is tracked under active-health truthfulness.

### 2026-10-12 outage recovery acceptance
- Root filesystem exhaustion (`29G/29G`, zero available) was proven as the incident root cause.
- Coolify PostgreSQL emitted `No space left on device`, checkpoint PANIC, and shutdown.
- Docker/containerd then failed to create the `coolify-db` task directory for the same no-space condition.
- Only unused Docker build cache was reclaimed first; about 2.54 GB was freed and `/` fell to about 92% usage.
- After explicit HIGH_IMPACT approval, only `coolify-db` was restarted.
- PostgreSQL automatic WAL recovery completed and logged `database system is ready to accept connections`.
- Independent GitHub-hosted post-recovery probe: PASS for Coolify health/version/applications and TASO public/direct-IP `/`, `/health`, `/api/auth/session`.
- Diagnostic PR #155 was closed without merge after the incident was recovered.

### Production acceptance boundary
The production dashboard route, unauthenticated security boundary, recovered UI/Core health, and exact active UI/Core runtime SHA are LIVE VERIFIED. The following remain separate production acceptance work:
- authenticated owner login,
- TOTP enrollment/verification persistence after production restart/deploy,
- real AI conversation on production,
- sourced web research on production,
- voice-originated web research on production,
- production transport-drop recovery fault injection.

## Production hardening gates
- Production patch-chain no-mutation CI: PASS on the active stabilization chain.
- Domain conflict with legacy Command Center: RESOLVED and guarded against recurrence.
- Heavy unchanged Speaker/Voice rebuild regression: RESOLVED by source-aware skip with explicit force override.
- Insecure production bootstrap: NOT ENABLED.
- Secret extraction from Coolify: NOT USED / NOT ALLOWED.
- Disk capacity remains an operational risk: after emergency cache reclamation root usage was still about 92%; capacity guard/retention and additional headroom are REQUIRED hardening work.

## Package A — remaining slices
- Voice web parity + final transcript: **IMPLEMENTED + MERGED + CI VERIFIED**.
- Voice history/thread persistence + reopen: **IMPLEMENTED + MERGED + CI VERIFIED**.
- Safe markdown rendering: **NEXT / NOT VERIFIED**.
- Mobile safe-area / dock overlap: implementation exists in multiple CSS surfaces; dedicated acceptance still NOT VERIFIED.
- Project archive/trash/restore lifecycle: NOT VERIFIED.
- 2FA persistence across deploy/restart: PARTIAL CI COVERAGE EXISTS; production restart/deploy persistence still NOT VERIFIED.
- Active health-state truthfulness: NOT VERIFIED as a dedicated slice.
- Production authenticated login/TOTP + real AI/web-search acceptance: NOT VERIFIED.
- Off-site S3 backup: PENDING.
- Disk-capacity guard/retention policy and production storage headroom: PENDING.
- Application-level build/version endpoint: OPTIONAL HARDENING / PENDING.

## Next slice acceptance target — safe markdown rendering
1. Confirm the active assistant-message renderer and the exact formatting subset required by the product — REQUIRED.
2. Render the approved markdown subset without using `dangerouslySetInnerHTML` or weakening React escaping — REQUIRED.
3. Raw HTML/script/event-handler payloads remain inert text and cannot create executable DOM — REQUIRED.
4. Dangerous URL schemes such as `javascript:` are never rendered as navigable links — REQUIRED.
5. Safe HTTPS/source links remain usable and include appropriate external-link isolation — REQUIRED.
6. Add executable browser/XSS acceptance while keeping existing voice/history/auth/visual gates green — REQUIRED.

## TASO v1.0 final acceptance
Still required before v1.0 can be called complete:
- clarification -> Mission Brief -> supervision mode,
- real multi-agent orchestration with deterministic QA/security gates,
- real isolated runtime and preview,
- browser QA,
- PR/approval/merge/auto-deploy flow,
- post-deploy health and rollback evidence,
- unified text/voice web research and thread history,
- persistent 2FA,
- project lifecycle,
- mobile CTA safety,
- cross-project negative tests,
- no fake preview or fake ready states.

## Do not convert UNKNOWN into PASS
If deployment, authenticated production behavior, search-provider readiness, multi-agent runtime behavior, or security checks cannot be directly verified, record them as NOT RUN / NOT VERIFIED / UNKNOWN.
