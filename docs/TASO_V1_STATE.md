# TASO v1.0 Development State

Last updated: 2026-10-12

## Current release
- Target: TASO v1.0 production-grade stabilization and foundation work.
- Active work package: **PAKET A — STABILIZATION**.
- Completed slices: **conversation transport recovery parity (text + voice)** and **voice web parity / final-transcript behavior**.
- Current next slice: **voice conversation history/thread persistence + reopen behavior**.
- Next package after Paket A: **PAKET B — CONVERSATION FOUNDATION**.

## Development Ledger
- Current package: **PAKET A — STABILIZATION**.
- Completed in the latest work item:
  - isolated and recovered the production outage without changing customer hosting/DNS;
  - proved the root cause was VPS root-filesystem exhaustion, not DNS or TASO application source;
  - reclaimed only unused Docker build cache;
  - after explicit approval restarted only `coolify-db`;
  - PostgreSQL completed automatic WAL recovery and returned ready-for-connections;
  - Coolify control plane, proxy and TASO public routing recovered;
  - independent GitHub-hosted probes reconfirmed public and direct-IP/SNI health;
  - exact active UI/Core runtime deployment UUIDs and SHA were re-read from Coolify;
  - repo-state review proved active voice input is routed through `DashboardChat` and the normal Core conversation endpoint;
  - executable Browser CI evidence proved interim transcript isolation, single final submission, voice web-search parity, source rendering, zero automatic Mission creation, and zero direct-provider voice bypass.
- Active blockers: **no active production outage**. Remaining Package A acceptance items are listed below.
- Operational risk: `/` recovered from 100% to about 92% usage after reclaiming about 2.54 GB of unused Docker build cache. Disk-capacity guard/retention and likely storage expansion remain required before repeated heavy production builds.
- Next package: **PAKET B — CONVERSATION FOUNDATION**, only after Package A acceptance is complete.
- Last LIVE VERIFIED SHA: `5aa4035387b82e934005e9fc85bf2d2f3d6a1466` for the active UI/Core runtime.

## Repository and production state
- Repository: `hasanmertproje/tasarlayalim-infra`.
- Default branch: `main`.
- Application-code baseline on `main` when incident recovery and Package A repo-state were verified: `a38f091bf03ab309e14f8ab8bfd6d78d112aca04`.
- This documentation update does not imply that baseline is the active LIVE VERIFIED UI/Core runtime.
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
- Executable assertions proved:
  - interim -> 0 conversation POSTs and 0 Mission POSTs;
  - duplicated final event -> exactly 1 Core conversation POST;
  - voice research -> `webSearch=true`;
  - direct provider voice-session POSTs -> 0;
  - automatic Mission POSTs -> 0;
  - sourced response link rendered;
  - voice policy marker -> `core-conversation`.
- Slice status: **IMPLEMENTED + MERGED + CI VERIFIED**.
- A real authenticated production voice-originated web-research turn is still separate production acceptance and is not upgraded to LIVE VERIFIED by this CI evidence.

## Live verification boundary
- **IMPLEMENTED:** yes for the currently active stabilized UI/Core release and completed Package A slices noted above.
- **MERGED:** yes for the active LIVE VERIFIED UI/Core release; repository application code has additional merged commits that are not automatically considered live.
- **DEPLOYED:** yes for the exact runtime components listed above.
- **LIVE VERIFIED:** yes for the recovered public dashboard routing, UI/Core health, unauthenticated session gate, and exact active UI/Core runtime SHA `5aa4035387b82e934005e9fc85bf2d2f3d6a1466`.
- **Exact live UI deployment:** `obsqexcobmp446wzeli8rq0m` at SHA `5aa4035387b82e934005e9fc85bf2d2f3d6a1466`.
- **Exact live Core deployment:** `r7yhxsqeef4jpjkrlydypbbm` at SHA `5aa4035387b82e934005e9fc85bf2d2f3d6a1466`.
- Do not infer that application-code baseline `a38f091bf03ab309e14f8ab8bfd6d78d112aca04` is fully LIVE VERIFIED for UI/Core merely because some worker components have newer finished deployments.
- Production authenticated login/TOTP, real AI conversation, sourced web research, voice-originated web research, and transport-drop fault injection remain separate production acceptance scenarios.

## Completed Package A work
- PR #119 implemented bounded persisted-history response recovery in `ConversationBridgeV2` for typed and voice-originated turns.
- Recovery does not blindly resubmit a user turn after a dropped POST transport.
- Active `DashboardChat` text and voice use the same Core conversation/policy path.
- Voice interim/final submission parity and web-search forwarding are executable CI verified.
- Natural-language web-search requests are normalized before the search provider is queried.
- Preview acceptance previously verified real login + TOTP, authenticated project access, direct search-provider access, real AI chat, and sourced web research without weakening auth.
- Production routing conflict was removed: the legacy Command Center keeps only its demo domain, while `taso.tasarlayalim.com` belongs only to `taso-ui-prod`.
- Production deployment is idempotent for unchanged healthy Speaker/Voice workers and has a dedicated no-mutation production patch-chain CI gate.
- Production owner credential migration persists a validated scrypt hash and removes the one-time plaintext credential after successful migration.
- Production infrastructure outage caused by full disk was recovered without DNS changes, auth weakening, application redeploy, volume deletion, or broad service restart.

## Open blockers / remaining acceptance
- Voice conversation history/thread persistence + reopen behavior.
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
- Deployment success is tracked separately from merge and live acceptance.
- Exact Coolify deployment UUID completion is required before runtime acceptance probes.
- Existing healthy heavy workers may be reused only when their source path is unchanged; an explicit force option remains available.
- Production incident recovery should prefer minimum-blast-radius cleanup and a single scoped service recovery over broad prune/reinstall/restart actions.

## Security invariants
- No login/2FA bypass.
- No insecure production bootstrap.
- No secret extraction from Coolify or GitHub.
- No secret values in browser responses, logs, docs, or model context.
- No blind duplicate conversation submission after transport failure.
- HIGH_IMPACT actions remain subject to explicit approval in the TASO product policy boundary.

## Next Package A slice
Proceed with **voice conversation history/thread persistence + reopen behavior** using executable regression evidence. The acceptance target is: a final voice-originated turn persists in the same authoritative project-scoped conversation history, reopening/reloading restores it without resubmission, and project boundaries prevent cross-project history leakage. Do not pull the Package B `ConversationThread` model forward unless the current stabilization path proves it is required.
