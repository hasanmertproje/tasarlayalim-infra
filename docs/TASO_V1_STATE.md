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

## Current Package A branch
- Pull request: **#119 — `fix: Package A conversation recovery parity`**.
- Verified pre-merge head before this state-record update: `e35db28cf69eff8cee37563285e2ea6afde0b092`.
- `Taso CI` run **621**: SUCCESS.
- `Taso Browser CI` run **104**: SUCCESS.
- `Taso Urgent Preview` run **20**: SUCCESS.
- The preview acceptance run verified exact Coolify deployment completion before probing runtime, public UI health, unauthenticated session gate, temporary preview QA login, TOTP enrollment, authenticated project access, direct search provider access, real AI chat, and sourced web-search flow.

## Live verification
- Active user URL per TASO v1 specification: `https://taso-v2.demo.tasarlayalim.com`.
- Last live verified SHA: **UNKNOWN / NOT YET PROVEN FROM A RUNTIME SHA SIGNAL**.
- Preview acceptance is not evidence that the active user URL serves the same SHA.
- Do not infer production deployment from PR CI, preview success, or merge alone.

## Current package status
- IMPLEMENTED: yes — response recovery parity is implemented for `ConversationBridgeV2`; typed and voice-originated turns use the same bounded persisted-history recovery path after transport failure.
- PRE-MERGE VERIFIED: yes — CI, browser acceptance, auth/security smoke, isolated preview deployment, real AI chat, and sourced web search are green on the verified branch head above.
- MERGED: no.
- DEPLOYED: no.
- LIVE VERIFIED: no.

## Completed
- Verified repository/default branch and package-start main SHA.
- Verified PR #118 only changed `DashboardChat.tsx`, leaving `ConversationBridgeV2.tsx` without equivalent recovery logic.
- Added bounded history-based recovery to `ConversationBridgeV2` without blind turn resubmission.
- Preserved the shared text/voice conversation path.
- Repaired the isolated preview acceptance path without weakening login/2FA:
  - portable Coolify destination lookup,
  - exact deployment UUID completion wait,
  - truthful handling of `running:unknown` search metadata,
  - explicit preview-only SearXNG secret,
  - direct search-provider acceptance probe,
  - natural-language web search query normalization.
- Verified Core tests, UI build/container, browser worker/visual acceptance, TOTP/trusted-device/gateway smoke, direct unauthenticated Core rejection, real preview AI chat, and sourced web research.

## Open blockers
- PR #119 must still pass the required gates after this documentation-only state update.
- PR #119 must then be merged before any deployment claim.
- Need post-merge deployment evidence and active-URL acceptance before marking DEPLOYED or LIVE VERIFIED.
- Need a reliable runtime build/SHA signal before claiming an exact live SHA.

## Operator actions required
- None for the current pre-merge work.
- If a later step requires a HIGH_IMPACT production action, request approval immediately before that action.

## Architecture decisions
- Text and voice recovery share the same conversation persistence path.
- Recovery is bounded and reads authoritative project-scoped conversation history; it does not automatically re-submit the user turn.
- Search-provider deployment metadata alone is not readiness evidence; direct provider and end-to-end sourced-search probes are required.
- Preview authentication remains real login + TOTP. Acceptance tooling must not bypass or weaken auth.
- No secret, DNS, migration, billing, or production-data behavior is changed by this slice.

## Security invariants
- No auth/2FA bypass.
- No secret exposure.
- No destructive migration or data deletion.
- Project-scoped conversation history remains the recovery source.
- A client transport failure must not be reported as a server failure until bounded recovery is attempted.
- Preview-only credentials are temporary and must never enable/re-enable an existing production identity.

## Next package
After this slice is MERGED, DEPLOYED, and LIVE VERIFIED, continue Package A with the next smallest verified gap among:
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
