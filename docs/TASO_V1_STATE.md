# TASO v1.0 Development State

Last updated: 2026-10-11

## Current release
- Target: TASO v1.0 production-grade stabilization and foundation work.
- Active work package: **PAKET A — STABILIZATION**.
- Current vertical slice: **#118 response recovery parity for ConversationBridgeV2 (text + voice)**.

## Repository state at package start
- Repository: `hasanmertproje/tasarlayalim-infra`
- Default branch: `main`
- Verified main SHA at start: `fb3552b227d0cbf7ae51f4760dc363f9c0a74a68`
- That SHA is merge commit for PR #118.
- `Taso CI` run for that main SHA completed successfully.
- Open PRs observed at package start: #62, #60, #16.

## Live verification
- Active user URL per TASO v1 specification: `https://taso-v2.demo.tasarlayalim.com`.
- Last live verified SHA: **UNKNOWN / NOT YET PROVEN FROM A RUNTIME SHA SIGNAL**.
- Browser probe from the current agent environment could not directly access the authenticated live URL; do not infer deployment from merge or CI alone.

## Current package status
- IMPLEMENTED: response recovery parity added on the Package A feature branch for `ConversationBridgeV2` so both typed and voice-originated turns can recover a completed server-side answer after a client transport drop.
- MERGED: no.
- DEPLOYED: no.
- LIVE VERIFIED: no.

## Completed
- Verified repository/default branch.
- Verified main head SHA.
- Verified open PR set.
- Verified latest main CI success.
- Verified PR #118 only changed `DashboardChat.tsx`, leaving `ConversationBridgeV2.tsx` without equivalent recovery logic.
- Created Package A branch from the verified main SHA.

## Open blockers
- Need CI on the new PR.
- Need merge only after CI/security checks are green.
- Need post-merge deployment evidence and live acceptance.
- Need a reliable runtime build/SHA signal before claiming exact live SHA.

## Operator actions required
- None for this low-risk package unless a HIGH_IMPACT boundary is discovered.

## Architecture decisions
- Text and voice recovery must share the same conversation persistence path.
- Recovery is bounded and reads authoritative conversation history; it does not re-submit the user turn automatically.
- No secret, auth, DNS, migration, billing, or production-data behavior is changed by this slice.

## Security invariants
- No auth/2FA bypass.
- No secret exposure.
- No destructive migration or data deletion.
- Project-scoped conversation history remains the recovery source.
- A client transport failure must not be reported as a server failure until bounded recovery is attempted.

## Next package
After this slice is LIVE VERIFIED, continue Package A with the next smallest verified gap among:
1. voice web parity / final-transcript behavior,
2. voice history/thread and reopen behavior,
3. safe markdown rendering,
4. mobile safe-area,
5. project archive lifecycle,
6. 2FA persistence,
7. active health states.

## Do not regress
- Do not claim DEPLOYED or LIVE VERIFIED from a merge alone.
- Do not auto-start missions from normal conversation.
- Do not create mission intent from interim voice transcript.
- Do not weaken login or 2FA.
- Do not expose provider, GitHub, Coolify, or infrastructure secrets to the browser or model.
