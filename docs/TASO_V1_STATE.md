# TASO v1.0 Development State

Last updated: 2026-10-12

## Current release
- Target: TASO v1.0 production-grade stabilization and foundation work.
- Active work package: **PAKET A — STABILIZATION**.
- Completed slice: **conversation transport recovery parity (text + voice)**.
- Current next slice: **voice web parity / final-transcript behavior**.

## Repository and production state
- Repository: `hasanmertproje/tasarlayalim-infra`.
- Default branch: `main`.
- Current verified main merge SHA: `5aa4035387b82e934005e9fc85bf2d2f3d6a1466` (PR #143).
- Production URL: `https://taso.tasarlayalim.com`.
- Production workflow: **Taso Production Deploy #14**, run `38178848246`: **SUCCESS**.
- Production domain ownership guard passed: `taso-ui-prod` is the unique Coolify owner and outer Coolify/Traefik Basic Auth is disabled.
- Public HTTPS UI/Core health acceptance passed.
- `/api/auth/session` production gate passed with the expected unauthenticated state (`configured=true`, `authenticated=false`).

## Production deployment evidence
- Search deployment finished: `25nbsdqevapq2i8rhc3moarl`.
- Browser deployment finished: `wxh5a42zvmbzhk3fwap9233i`.
- Speaker rebuild was intentionally skipped because its source path was unchanged and the existing runtime was already running.
- Voice rebuild was intentionally skipped for the same reason.
- Core performed the one-time owner credential migration without exposing the plaintext value to CI, removed the plaintext owner credential from Coolify configuration, and then redeployed to prove restart from the persisted hash only.
- Final hash-only Core deployment finished: `r7yhxsqeef4jpjkrlydypbbm`; runtime: `running:healthy`.
- UI deployment finished in the same successful production run; runtime: `running:healthy`.
- Off-site S3 backup remains pending; daily local backup fallback remains configured.

## Live verification boundary
- **IMPLEMENTED:** yes.
- **MERGED:** yes.
- **DEPLOYED:** yes for the production stack acceptance represented by run #14.
- **LIVE VERIFIED:** yes for public dashboard routing, UI/Core health, unique production-domain ownership, removal of outer Basic Auth, and the unauthenticated session gate.
- Exact live runtime SHA is still **not independently exposed by a runtime build/SHA signal**. The production run itself was anchored to main SHA `5aa4035387b82e934005e9fc85bf2d2f3d6a1466`, but do not substitute that for a runtime-reported SHA.
- Production authenticated login/TOTP, real AI conversation, sourced web research, voice web parity, and transport-drop fault injection are separate acceptance scenarios and are not upgraded to LIVE VERIFIED by the health/session checks above.

## Completed Package A work
- PR #119 implemented bounded persisted-history response recovery in `ConversationBridgeV2` for typed and voice-originated turns.
- Recovery does not blindly resubmit a user turn after a dropped POST transport.
- Text and voice use the same Core conversation/policy path.
- Natural-language web-search requests are normalized before the search provider is queried.
- Preview acceptance previously verified real login + TOTP, authenticated project access, direct search-provider access, real AI chat, and sourced web research without weakening auth.
- Production routing conflict was removed: the legacy Command Center keeps only its demo domain, while `taso.tasarlayalim.com` belongs only to `taso-ui-prod`.
- Production deployment is now idempotent for unchanged healthy Speaker/Voice workers and has a dedicated no-mutation production patch-chain CI gate.
- Production owner credential migration now persists a validated scrypt hash and removes the one-time plaintext credential after successful migration.

## Open blockers / remaining acceptance
- Dedicated voice final-transcript and voice web-research acceptance.
- Voice conversation history/thread reopen behavior.
- Safe markdown rendering acceptance.
- Mobile safe-area/dock-overlap acceptance (safe-area CSS exists, but dedicated acceptance remains required).
- Project archive/trash/restore lifecycle.
- 2FA persistence across a real production restart/deploy.
- Active health-state truthfulness across all product surfaces.
- Production authenticated login/TOTP + real AI/web-search acceptance.
- Off-site S3 backup target.
- Runtime build/SHA endpoint or equivalent non-secret signal.

## Architecture decisions
- Normal conversation must never auto-start a Mission.
- Interim voice transcript must never create mission intent or submit a user turn.
- Only a final voice transcript may enter the same conversation path used by typed text.
- Text and voice share the same Core policy/tool boundary.
- Recovery is bounded and reads authoritative project-scoped conversation history; it never blindly re-submits a possibly completed turn.
- Deployment success is tracked separately from merge and live acceptance.
- Exact Coolify deployment UUID completion is required before runtime acceptance probes.
- Existing healthy heavy workers may be reused only when their source path is unchanged; an explicit force option remains available.

## Security invariants
- No login/2FA bypass.
- No insecure production bootstrap.
- No secret extraction from Coolify or GitHub.
- No secret values in browser responses, logs, docs, or model context.
- No blind duplicate conversation submission after transport failure.
- HIGH_IMPACT actions remain subject to explicit approval in the TASO product policy boundary.

## Next Package A slice
Proceed with **voice web parity / final-transcript behavior** using executable regression evidence. The acceptance target is: interim transcript is UI-only, one final transcript produces at most one conversation POST, and voice-originated research goes through the same Core/web-search path as typed research.
