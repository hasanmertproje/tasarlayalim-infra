# TASO v1.0 Architecture Decisions

Last updated: 2026-10-11

## ADR-001 — Conversation transport recovery uses persisted history
**Status:** Accepted

When a client POST to `/v1/conversations/messages` loses its transport after the server may already have completed the turn, the client must not blindly re-submit the same turn. It performs a short, bounded read of `/v1/conversations?projectId=...` and looks for the completed user/assistant pair.

Rationale:
- avoids duplicate model/tool work,
- recovers server-completed answers after mobile fetch drops,
- uses the authoritative persisted conversation store,
- works for both typed and voice-originated turns because they share the same ConversationBridgeV2 send path.

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

A successful PR/CI or merge is not evidence that the active TASO URL is serving the same SHA.

## ADR-004 — Exact live SHA needs runtime evidence
**Status:** Accepted

The product should expose or otherwise provide a non-secret runtime build identifier/commit SHA so post-deploy acceptance can compare the live service to the merged commit. Until such evidence exists, the ledger must record the live SHA as unknown instead of inferring it.

## Security invariants
- No login/2FA bypass.
- No secrets in browser responses, model context, logs, commits, or docs.
- No HIGH_IMPACT operation without explicit approval.
- Conversation recovery remains project-scoped.
- Voice and text use the same Core policy/tool boundary; modality does not grant broader authority.
