# TASO v1.0 Acceptance Ledger

Last updated: 2026-10-11

## Evidence policy
A scenario is PASS only with executable evidence (CI/test log, runtime response, health probe, browser acceptance, deployment record, or equivalent). Source code presence alone is not PASS.

## Package A — current slice
### Response recovery parity
- Typed DashboardChat recovery after transport drop: IMPLEMENTED on main by PR #118; main CI success verified.
- ConversationBridgeV2 typed recovery: IMPLEMENTED on PR #119 through bounded persisted-history recovery.
- ConversationBridgeV2 voice-originated recovery: IMPLEMENTED on PR #119 through the same send/recovery path.
- Pre-merge CI/security/browser acceptance at branch head `e35db28cf69eff8cee37563285e2ea6afde0b092`: PASS.
- Isolated preview end-to-end acceptance at that head: PASS.
- Post-merge active-user-URL acceptance: NOT RUN.

### Verified pre-merge evidence
- `Taso CI` run 621: PASS.
- `Taso Browser CI` run 104: PASS.
- `Taso Urgent Preview` run 20: PASS.
- Preview exact Coolify deployment completion: PASS for search, Core, and UI before runtime probes.
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
The recovery implementation is compiled and exercised through the shared ConversationBridgeV2 path without CI/security regressions. Exact post-merge/live transport-drop fault injection is still NOT RUN and must not be represented as LIVE VERIFIED.

Acceptance checks for this slice:
1. UI build/typecheck passes — PASS.
2. Core and integration CI remain green — PASS.
3. No auth/security smoke regression — PASS.
4. Bounded history recovery exists without blind duplicate turn resubmission — IMPLEMENTED; post-merge/live fault injection NOT RUN.
5. Same recovery path applies when `fromVoice=true` — IMPLEMENTED; post-merge/live fault injection NOT RUN.
6. Merge SHA is deployed before LIVE VERIFIED is recorded — PENDING MERGE/DEPLOYMENT.

## Package A — remaining
- Voice web parity: NOT VERIFIED as a dedicated voice acceptance scenario.
- Voice history/thread persistence: NOT VERIFIED.
- Voice reopen bug: NOT VERIFIED.
- Safe markdown rendering: NOT VERIFIED.
- Mobile safe-area / dock overlap: NOT VERIFIED as its own Package A slice.
- Project archive/trash/restore lifecycle: NOT VERIFIED.
- 2FA persistence across deploy/restart: PARTIAL CI COVERAGE EXISTS; production restart/deploy persistence still NOT VERIFIED.
- Active health states: NOT VERIFIED.

## TASO v1.0 final acceptance
The following remain required before v1.0 can be called complete:
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
If deployment, live SHA, active-user-URL behavior, preview availability, search provider readiness, multi-agent runtime behavior, or security checks cannot be directly verified, record them as NOT RUN / NOT VERIFIED / UNKNOWN.
