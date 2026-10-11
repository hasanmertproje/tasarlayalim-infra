# TASO v1.0 Architecture Decisions

Last updated: 2026-10-12

## ADR-001 — Conversation transport recovery uses persisted history
**Status:** Accepted

When a client POST to `/v1/conversations/messages` loses its transport after the server may already have completed the turn, the client must not blindly re-submit the same turn. It performs a short, bounded read of `/v1/conversations?projectId=...` and looks for the completed user/assistant pair.

Rationale:
- avoids duplicate model/tool work,
- recovers server-completed answers after mobile fetch drops,
- uses the authoritative persisted conversation store,
- works for typed and voice-originated turns because they share the same ConversationBridgeV2 send path.

## ADR-002 — Recovery is bounded and non-destructive
**Status:** Accepted

Recovery uses a small fixed retry window. Failure to recover returns a user-visible transport error; it does not loop indefinitely and does not mutate repository, deployment, auth, or production data.

## ADR-003 — Deployment claims require separate evidence states
**Status:** Accepted

Every change is tracked independently as:
- IMPLEMENTED
- MERGED
- DEPLOYED
- LIVE VERIFIED

A successful PR/CI or merge is not evidence that the active TASO URL serves the same behavior. Live acceptance must probe the production route after deployment.

## ADR-004 — Exact live SHA needs runtime evidence
**Status:** Accepted

The product should expose a non-secret runtime build identifier/commit SHA so post-deploy acceptance can compare the live service to the merged commit. A deployment workflow being anchored to a commit is not a substitute for a runtime-reported SHA.

## ADR-005 — Production domain has exactly one Coolify owner
**Status:** Accepted

`https://taso.tasarlayalim.com` must be owned only by `taso-ui-prod`. If another Coolify application advertises the same FQDN, production deployment fails closed rather than silently rewriting unrelated routing.

The production UI must not use Coolify/Traefik outer Basic Auth. TASO's own AuthGate/session/TOTP boundary remains authoritative.

## ADR-006 — Heavy worker deploys are source-aware and idempotent
**Status:** Accepted

Speaker and Voice workers may skip a rebuild only when:
- the existing runtime is already running,
- a latest successful deployment commit is available,
- the worker's own source directory is unchanged between that deployment and the current main commit.

If any of those checks cannot be proven, the normal deployment path is used. A manual force option exists for intentional rebuilds.

Rationale:
- avoids repeatedly rebuilding large unchanged voice images for orchestration-only changes,
- preserves the existing healthy runtime if an unrelated production orchestration change occurs,
- still rebuilds whenever worker source actually changes.

## ADR-007 — Production owner credential migration is one-time and hash-only after restart
**Status:** Accepted

Production must not enable insecure plaintext-password bootstrap. When a legacy plaintext owner credential exists, Core may perform a one-time in-container migration only under the explicit migration flag, persist a validated scrypt hash in the production data volume, then remove the plaintext credential and migration flag from Coolify configuration. Core is redeployed afterward to prove it starts using the persisted hash alone.

CI must never read, print, derive, or recover the plaintext secret value.

## ADR-008 — Production patch composition has a no-mutation CI gate
**Status:** Accepted

The dynamic production compatibility wrappers must be composable and syntax-valid before merge. A dedicated validation workflow executes the full patch chain in `validate-only` mode without Coolify credentials or mutations.

## ADR-009 — Voice final transcript is the only submit boundary
**Status:** Accepted

Interim speech-recognition text is presentation state only. It must not create mission intent, call Core, or submit a conversation message. Only a final transcript may enter the same `sendConversation` path used by typed text.

Voice and text therefore share the same Core intent classifier, tool policy, web-search path, mission suggestion boundary, and transport-recovery behavior.

## Production evidence for these decisions
- PR #143 merged as `5aa4035387b82e934005e9fc85bf2d2f3d6a1466`.
- `Taso Production Deploy` run #14 (`38178848246`) completed successfully.
- Production domain ownership guard passed.
- Unchanged Speaker and Voice rebuilds were skipped by the source-aware guard.
- Core completed one-time plaintext-to-scrypt migration and a second hash-only healthy restart.
- Production UI/Core public health and unauthenticated session gate passed.

## Security invariants
- No login/2FA bypass.
- No secrets in browser responses, model context, logs, commits, or docs.
- No insecure production bootstrap.
- No HIGH_IMPACT operation without explicit approval in the TASO product policy boundary.
- Conversation recovery remains project-scoped.
- Voice and text use the same Core policy/tool boundary; modality does not grant broader authority.
- Interim voice transcript is never an execution boundary.
