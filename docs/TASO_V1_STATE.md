# TASO v1.0 Development State

Last updated: 2026-10-12

## Current release
- Target: TASO v1.0 production-grade stabilization and foundation work.
- Active work package: **PAKET A — STABILIZATION**.
- Completed slices: **conversation transport recovery parity (text + voice)**, **voice web parity / final-transcript behavior**, and **voice conversation history persistence + reopen behavior**.
- Current next slice: **safe markdown rendering acceptance**.
- Next package after Paket A: **PAKET B — CONVERSATION FOUNDATION**.

## Development Ledger
- Current package: **PAKET A — STABILIZATION**.
- Completed in the latest work item:
  - added a real Browser CI acceptance for voice-originated project-scoped conversation persistence and reopen;
  - verified one final voice turn produces one conversation POST and persists the user/assistant pair in authoritative Core history;
  - verified reload/reopen restores the exact same persisted user and assistant message IDs;
  - verified reopen creates no duplicate conversation POST;
  - verified switching to a second project does not leak the voice history, and returning to the original project restores it without resubmission;
  - kept the existing project-scoped conversation store for Package A instead of prematurely introducing the Package B `ConversationThread` model;
  - all existing Browser CI visual/voice acceptance remained green.
- Active blockers: **no active production outage**. Remaining Package A acceptance items are listed below.
- Operational risk: `/` recovered from 100% to about 92% usage after reclaiming about 2.54 GB of unused Docker build cache. Disk-capacity guard/retention and likely storage expansion remain required before repeated heavy production builds.
- Next package: **PAKET B — CONVERSATION FOUNDATION**, only after Package A acceptance is complete.
- Last LIVE VERIFIED SHA: `5aa4035387b82e934005e9fc85bf2d2f3d6a1466` for the active UI/Core runtime.

## Repository and production state
- Repository: `hasanmertproje/tasarlayalim-infra`.
- Default branch: `main`.
- Current merged repository SHA after voice-history acceptance: `4f346fda621da16583eba8b7b18e1c4338e3970f`.
- This repository SHA is **not** being claimed as the active LIVE VERIFIED UI/Core runtime.
- Last LIVE VERIFIED UI/Core SHA: `5aa4035387b82e934005e9fc85bf2d2f3d6a1466`.
- Production URL: `https://taso.tasarlayalim.com`.
- Last successful production workflow that established the currently active UI/Core release: **Taso Production Deploy #14**, run `38178848246`.
- Production domain ownership guard passed: `taso-ui-prod` is the unique Coolify owner and outer Coolify/Traefik Basic Auth is disabled.
- Public HTTPS UI/Core health acceptance passed again after the 2026-10-12 infrastructure recovery.
- `/api/auth/session` production gate again returns HTTP 200 with the expected unauthenticated state when probed without a session.

## 2026-10-12 production incident and recovery
- VPS root filesystem reached 100% usage (`29G/29G`, zero available space).
- `/var/lib` accounted for about 24 GB; Docker images were about 16.17 GB and build cache about 7.55 GB.
- Coolify PostgreSQL logged `No space left on device`, then checkpoint PANIC and shutdown.
- Docker/containerd then failed to create the `coolify-db` runtime task directory for the same no-space condition, leaving `coolify-db` unable to restart normally.
- This cascaded into a non-responsive Coolify control plane and TASO HTTP 503 responses.
- `safirinovasyon.com` was proven unrelated to the current registry delegation for `tasarlayalim.com`; no customer DNS/hosting change was made.
- Recovery used the minimum blast radius:
  - `docker builder prune -f` reclaimed about 2.54 GB of unused build cache;
  - root usage fell to about 92%;
  - after explicit HIGH_IMPACT approval, only `coolify-db` was restarted;
  - PostgreSQL completed WAL recovery and logged `database system is ready to accept connections`;
  - Coolify, DB, Redis, Sentinel and Proxy returned healthy.
- Diagnostic PR #155 was closed **without merge** after the incident was proven and recovered.

## Production deployment evidence
- Current recovered runtime snapshot after the incident:
  - Search app UUID `ef33utjzlefmzizhxyjtrlun`; latest finished deployment `balxbwvsatjl1zhnd5svaydp`, commit `a38f091bf03ab309e14f8ab8bfd6d78d112aca04`; Coolify may report `running:unknown` where no Docker healthcheck is defined.
  - Browser app UUID `xaqesqovs0k6rfsbzolb5rmr`; latest finished deployment `pxrmldrwx3shngp8kee0kmon`, commit `86da9451827e1e7ef2757023dda6810007303159`; runtime `running:healthy`.
  - Speaker app UUID `tm8zzvblmh2iobgn1veas07v`; latest finished deployment `rnygvyxpe7zrjp8bt3witqix`, commit `4e6ee8904e18908d6044d687735d91d705726209`; runtime `running:healthy`.
  - Voice app UUID `t9odvg9gt32ihiiyos6pznau`; latest finished deployment `cszyhbmktugukkmqvryvd6rc`, commit `4e6ee8904e18908d6044d687735d91d705726209`; Coolify may report `running:unknown` where no Docker healthcheck is defined.
  - Core app UUID `hgqndeyja2gvb5by2meypl6b`; final hash-only deployment `r7yhxsqeef4jpjkrlydypbbm`, commit `5aa4035387b82e934005e9fc85bf2d2f3d6a1466`; runtime `running:healthy`.
  - UI app UUID `biuki5ik9ifbphwalsmgukmq`; deployment `obsqexcobmp446wzeli8rq0m`, commit `5aa4035387b82e934005e9fc85bf2d2f3d6a1466`; runtime `running:healthy`.
- Independent GitHub-hosted post-recovery probe returned:
  - Coolify direct `:8000 /api/v1/health` -> 200;
  - Coolify public `/api/v1/health` -> 200;
  - authenticated Coolify `/api/v1/version` -> 200;
  - authenticated Coolify `/api/v1/applications` -> 200;
  - TASO public `/`, `/health`, `/api/auth/session` -> 200;
  - TASO direct-IP with correct HTTPS Host/SNI `/`, `/health`, `/api/auth/session` -> 200.
- Off-site S3 backup remains pending; daily local backup fallback remains configured.

## Package A — voice web parity / final transcript evidence
- Active path: mobile voice entry routes to `DashboardChat`; `DashboardChat` owns the active recognition/submission flow.
- Interim recognition updates input/presentation state only.
- `finalSubmitted` prevents duplicate final speech events from submitting more than once per recognition instance.
- Final voice text calls the same `/v1/conversations/messages` Core endpoint used by typed text.
- Voice preserves the same `webSearch` selection as typed conversation.
- `Taso Browser CI` run #196 (`38188656465`), PR #153 head `fd1d0ec0e76eee133f917ba1b096a2d09d98df20`: PASS.
- `visual-acceptance` job `114630481945`, including `voiceCoreAcceptance()`: PASS.
- Slice status: **IMPLEMENTED + MERGED + CI VERIFIED**.
- A real authenticated production voice-originated web-research turn is still separate production acceptance and is not upgraded to LIVE VERIFIED by this CI evidence.

## Package A — voice history / reopen evidence
- PR #157 added `scripts/taso-voice-history-acceptance.mjs` and integrated it into the real isolated Core/UI Browser CI stack.
- PR #157 merge SHA: `4f346fda621da16583eba8b7b18e1c4338e3970f`.
- `Taso Browser CI` run #230, run ID `38225154692`: PASS.
- `visual-acceptance` job `114730731705`: PASS.
- Exact executable result:
  - `conversationPosts=1` for one final voice-originated turn;
  - persisted user message ID `message_57149885-896e-4918-a2e1-660a8ae212ac`;
  - persisted assistant message ID `message_092b601c-7357-4781-a063-ac9c60fa018f`;
  - `reloadRestoredSameIds=true`;
  - `crossProjectLeakage=false`;
  - `resubmittedOnReopen=false`.
- Existing visual acceptance also remained PASS in the same run.
- `Taso CI` run #747, run ID `38225154677`: PASS.
- Slice status: **IMPLEMENTED + MERGED + CI VERIFIED**.
- This stabilizes the existing project-scoped conversation history; it does not claim that Package B thread/archive/pagination models are implemented.

## Live verification boundary
- **IMPLEMENTED:** yes for completed Package A slices noted above.
- **MERGED:** yes for the repository changes through PR #157.
- **DEPLOYED:** the current production UI/Core deployment remains the exact runtime listed below; PR #157 was an acceptance-test merge and was not production deployed.
- **LIVE VERIFIED:** yes for the recovered public dashboard routing, UI/Core health, unauthenticated session gate, and exact active UI/Core runtime SHA `5aa4035387b82e934005e9fc85bf2d2f3d6a1466`.
- **Exact live UI deployment:** `obsqexcobmp446wzeli8rq0m` at SHA `5aa4035387b82e934005e9fc85bf2d2f3d6a1466`.
- **Exact live Core deployment:** `r7yhxsqeef4jpjkrlydypbbm` at SHA `5aa4035387b82e934005e9fc85bf2d2f3d6a1466`.
- Do not infer that repository SHA `4f346fda621da16583eba8b7b18e1c4338e3970f` is LIVE VERIFIED for UI/Core.
- Production authenticated login/TOTP, real AI conversation, sourced web research, voice-originated web research, and transport-drop fault injection remain separate production acceptance scenarios.

## Completed Package A work
- PR #119 implemented bounded persisted-history response recovery in `ConversationBridgeV2` for typed and voice-originated turns.
- Recovery does not blindly resubmit a user turn after a dropped POST transport.
- Active `DashboardChat` text and voice use the same Core conversation/policy path.
- Voice interim/final submission parity and web-search forwarding are executable CI verified.
- Voice-originated project-scoped history persistence and reopen are executable CI verified without pulling Package B models forward.
- Natural-language web-search requests are normalized before the search provider is queried.
- Preview acceptance previously verified real login + TOTP, authenticated project access, direct search-provider access, real AI chat, and sourced web research without weakening auth.
- Production routing conflict was removed: the legacy Command Center keeps only its demo domain, while `taso.tasarlayalim.com` belongs only to `taso-ui-prod`.
- Production deployment is idempotent for unchanged healthy Speaker/Voice workers and has a dedicated no-mutation production patch-chain CI gate.
- Production owner credential migration persists a validated scrypt hash and removes the one-time plaintext credential after successful migration.
- Production infrastructure outage caused by full disk was recovered without DNS changes, auth weakening, application redeploy, volume deletion, or broad service restart.

## Open blockers / remaining acceptance
- Safe markdown rendering acceptance.
- Mobile safe-area/dock-overlap acceptance (safe-area CSS exists, but dedicated acceptance remains required).
- Project archive/trash/restore lifecycle.
- 2FA persistence across a real production restart/deploy.
- Active health-state truthfulness across all product surfaces, including workers that currently surface `running:unknown` without a Docker healthcheck.
- Production authenticated login/TOTP + real AI/web-search acceptance, including a real voice-originated research turn.
- Off-site S3 backup target.
- Disk-capacity guard/retention policy and production storage headroom.
- Optional application-level runtime build/version endpoint for simpler future diagnostics.

## Architecture decisions
- Normal conversation must never auto-start a Mission.
- Interim voice transcript must never create mission intent or submit a user turn.
- Only a final voice transcript may enter the same conversation path used by typed text.
- Text and voice share the same Core policy/tool boundary.
- Recovery is bounded and reads authoritative project-scoped conversation history; it never blindly re-submits a possibly completed turn.
- Package A uses existing authoritative project-scoped history; Package B owns the future `ConversationThread` / Message model expansion.
- Deployment success is tracked separately from merge and live acceptance.
- Exact Coolify deployment UUID completion is required before runtime acceptance probes.
- Existing healthy heavy workers may be reused only when their source path is unchanged; an explicit force option remains available.
- Production incident recovery should prefer minimum-blast-radius cleanup and a single scoped service recovery over broad prune/reinstall/restart actions.

## Security invariants
- No login/2FA bypass.
- No insecure production bootstrap.
- No secret extraction from Coolify or GitHub.
- No secret values in browser responses, logs, docs, or model context.
- No blind duplicate conversation submission after transport failure or project reopen.
- HIGH_IMPACT actions remain subject to explicit approval in the TASO product policy boundary.

## Next Package A slice
Proceed with **safe markdown rendering acceptance**. First verify the active message renderer and required formatting scope. The implementation must keep raw HTML/script inert, reject dangerous link schemes, preserve safe source links, and add executable XSS/rendering acceptance without introducing `dangerouslySetInnerHTML` or bypassing React escaping.
