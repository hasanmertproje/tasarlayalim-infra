# TASO v1.0 Acceptance Ledger

Last updated: 2026-10-11

## Evidence policy
A scenario is PASS only with executable evidence (CI/test log, runtime response, health probe, browser acceptance, deployment record, or equivalent). Source code presence alone is not PASS.

## Package A — current slice
### Response recovery parity
- Typed DashboardChat recovery after transport drop: IMPLEMENTED on main by PR #118; main CI success verified.
- ConversationBridgeV2 typed recovery: IMPLEMENTED on current Package A branch; CI pending.
- ConversationBridgeV2 voice-originated recovery: IMPLEMENTED on current Package A branch through the same send/recovery path; CI pending.
- Post-merge live acceptance: NOT RUN.

Acceptance checks for this slice:
1. UI build/typecheck passes.
2. Core and integration CI remain green.
3. No auth/security smoke regression.
4. Simulated/real transport drop after server completion can recover the persisted assistant turn without submitting a duplicate turn.
5. Same behavior applies when `fromVoice=true`.
6. Merge SHA is deployed before LIVE VERIFIED is recorded.

## Package A — remaining
- Voice web parity: NOT VERIFIED.
- Voice history/thread persistence: NOT VERIFIED.
- Voice reopen bug: NOT VERIFIED.
- Safe markdown rendering: NOT VERIFIED.
- Mobile safe-area / dock overlap: NOT VERIFIED.
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
If deployment, live SHA, preview availability, search provider readiness, multi-agent runtime behavior, or security checks cannot be directly verified, record them as NOT RUN / NOT VERIFIED / UNKNOWN.
