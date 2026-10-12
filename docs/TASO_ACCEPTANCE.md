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
- `Capture and assert visual acceptance` step: **PASS**.
- `scripts/taso-visual-acceptance.mjs` `voiceCoreAcceptance()` explicitly verifies:
  - interim transcript -> exactly 0 conversation POSTs;
  - interim transcript -> exactly 0 Mission POSTs;
  - the same final transcript event delivered twice -> exactly 1 Core conversation POST;
  - the Core POST includes the selected project and exact final transcript text;
  - voice-originated research preserves `webSearch=true`;
  - exactly 0 direct provider voice-session POSTs;
  - exactly 0 automatic Mission POSTs;
  - sourced Core response renders a source link;
  - dashboard voice policy is `core-conversation`.
- Status: **IMPLEMENTED + MERGED + CI VERIFIED**.
- Production voice-originated web research with a real authenticated production user is still **NOT RUN / NOT LIVE VERIFIED** and remains part of production acceptance, not an implementation blocker for this slice.

## Production platform acceptance — 2026-10-12
### Main/deploy identity
- The currently active LIVE VERIFIED UI/Core deployment was established from SHA `5aa4035387b82e934005e9fc85bf2d2f3d6a1466` (PR #143 merge).
- `Taso Production Deploy` run #14, run ID `38178848246`: **PASS**.
- Post-deploy read-only Coolify snapshot: **PASS**.
- Repository application-code baseline had advanced to `a38f091bf03ab309e14f8ab8bfd6d78d112aca04` when the 2026-10-12 infrastructure recovery was verified; this does not imply that SHA is the active UI/Core runtime.

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
- Independent GitHub-hosted post-recovery probe: PASS:
  - Coolify direct `:8000 /api/v1/health` -> 200;
  - Coolify public `/api/v1/health` -> 200;
  - authenticated Coolify `/api/v1/version` -> 200;
  - authenticated Coolify `/api/v1/applications` -> 200;
  - TASO public `/`, `/health`, `/api/auth/session` -> 200;
  - TASO direct-IP with correct Host/SNI `/`, `/health`, `/api/auth/session` -> 200.
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
- Voice web parity + final transcript: **IMPLEMENTED + CI VERIFIED**.
- Voice history/thread persistence: **NEXT / NOT VERIFIED**.
- Voice reopen behavior: **NEXT / NOT VERIFIED**.
- Safe markdown rendering: NOT VERIFIED.
- Mobile safe-area / dock overlap: implementation exists in multiple CSS surfaces; dedicated acceptance still NOT VERIFIED.
- Project archive/trash/restore lifecycle: NOT VERIFIED.
- 2FA persistence across deploy/restart: PARTIAL CI COVERAGE EXISTS; production restart/deploy persistence still NOT VERIFIED.
- Active health-state truthfulness: NOT VERIFIED as a dedicated slice.
- Production authenticated login/TOTP + real AI/web-search acceptance: NOT VERIFIED.
- Off-site S3 backup: PENDING.
- Disk-capacity guard/retention policy and production storage headroom: PENDING.
- Application-level build/version endpoint: OPTIONAL HARDENING / PENDING.

## Next slice acceptance target — voice history/thread persistence + reopen
1. A voice-originated final turn is persisted in the same authoritative conversation history used by typed turns — REQUIRED.
2. Reopening/reloading the same project restores the persisted voice-originated user and assistant messages — REQUIRED.
3. Reopen must not resubmit the prior voice turn or create a duplicate conversation POST — REQUIRED.
4. Switching projects must not leak history across project boundaries — REQUIRED.
5. Existing text/voice recovery, final-transcript, web-search, auth, browser, and visual gates remain green — REQUIRED.
6. Do not introduce the Package B `ConversationThread` data model early unless current Package A acceptance proves the existing project-scoped history cannot satisfy this stabilization requirement.

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
