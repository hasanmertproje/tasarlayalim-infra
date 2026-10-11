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

## Production platform acceptance — 2026-10-12
### Main/deploy identity
- Current production deployment run was triggered from main SHA `5aa4035387b82e934005e9fc85bf2d2f3d6a1466` (PR #143 merge).
- `Taso Production Deploy` run #14, run ID `38178848246`: **PASS**.

### Production routing and auth boundary
- DNS preflight: PASS.
- Production domain unique-owner guard: PASS; `taso-ui-prod` is the only Coolify application owning `taso.tasarlayalim.com`.
- Outer Coolify/Traefik Basic Auth on production UI: DISABLED and verified.
- Public HTTPS UI/Core health probe: PASS.
- `/api/auth/session` unauthenticated gate: PASS (`configured=true`, `authenticated=false`).

### Production service deployment evidence
- Search exact deployment completion: PASS — `25nbsdqevapq2i8rhc3moarl`.
- Browser exact deployment completion: PASS — `wxh5a42zvmbzhk3fwap9233i`.
- Speaker source-aware skip: PASS — unchanged source + existing running runtime; no unnecessary rebuild.
- Voice source-aware skip: PASS — unchanged source + existing running runtime; no unnecessary rebuild.
- First Core migration boot: PASS; runtime became healthy.
- One-time plaintext owner credential removal from Coolify configuration: PASS without exposing the secret to CI.
- Second hash-only Core restart/deploy: PASS — `r7yhxsqeef4jpjkrlydypbbm`, runtime `running:healthy`.
- UI deployment completion: PASS; runtime `running:healthy`.
- Final public UI/Core health: PASS.
- Final production unauthenticated session gate: PASS.

### Production acceptance boundary
The production dashboard route and unauthenticated security boundary are LIVE VERIFIED. The following were not exercised by production run #14 and therefore remain separate acceptance work:
- authenticated owner login,
- TOTP enrollment/verification after production restart,
- real AI conversation on production,
- sourced web research on production,
- voice-originated web research,
- production transport-drop recovery fault injection.

The exact live runtime SHA is still not independently reported by a runtime build/SHA endpoint. Do not infer it solely from the workflow checkout SHA.

## Production hardening gates
- Production patch-chain no-mutation CI: PASS on PR #143.
- Taso CI on PR #143: PASS.
- Taso Browser CI + visual acceptance on PR #143: PASS.
- Domain conflict with legacy Command Center: RESOLVED and guarded against recurrence.
- Heavy unchanged Speaker/Voice rebuild regression: RESOLVED by source-aware skip with explicit force override.
- Insecure production bootstrap: NOT ENABLED.
- Secret extraction from Coolify: NOT USED / NOT ALLOWED.

## Package A — remaining slices
- Voice web parity + final transcript: **NEXT / NOT YET DEDICATED-VERIFIED**.
- Voice history/thread persistence: NOT VERIFIED.
- Voice reopen behavior: NOT VERIFIED.
- Safe markdown rendering: NOT VERIFIED.
- Mobile safe-area / dock overlap: implementation exists in multiple CSS surfaces; dedicated acceptance still NOT VERIFIED.
- Project archive/trash/restore lifecycle: NOT VERIFIED.
- 2FA persistence across deploy/restart: PARTIAL CI COVERAGE EXISTS; production restart/deploy persistence still NOT VERIFIED.
- Active health-state truthfulness: NOT VERIFIED as a dedicated slice.
- Off-site S3 backup: PENDING.
- Runtime build/SHA signal: PENDING.

## Next slice acceptance target — voice web parity / final transcript
1. Interim speech transcript is displayed only and does not call the conversation POST endpoint — REQUIRED.
2. One final transcript produces at most one conversation POST — REQUIRED.
3. Voice-originated text enters the same Core conversation path as typed text — REQUIRED.
4. A voice-originated research request can use the same sourced web-search capability as typed research — REQUIRED.
5. Interim transcript cannot create mission intent or start a Mission — REQUIRED.
6. Existing text/voice recovery, auth, browser, and visual gates remain green — REQUIRED.

## TASO v1.0 final acceptance
Still required before v1.0 can be called complete:
- clarification → Mission Brief → supervision mode,
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
If deployment, runtime SHA, authenticated production behavior, search-provider readiness, multi-agent runtime behavior, or security checks cannot be directly verified, record them as NOT RUN / NOT VERIFIED / UNKNOWN.
