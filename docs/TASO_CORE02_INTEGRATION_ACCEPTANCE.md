# TASO CORE-02 — Integration inventory and Package A acceptance

Recorded: 2026-10-13. This is a GitHub evidence snapshot; it is NOT a production status probe.

## Verified main integrations

| PR | Integration | Exact main merge SHA | Controls | Production |
| --- | --- | --- | --- | --- |
| #185 | FORGE read-only Coolify deployment UUID diagnostics | `dad126d952f4efc259c1d38e5a4a1e5df9d768c2` | validate, visual-acceptance, browser-worker, read-only-diagnostic PASS | No Coolify mutation or deployment |
| #189 | FORGE disaster recovery evidence ledger / audit | `1d4fc6fc8799d3d22720647dd1aa5c59b5f2ebe6` | validate, visual-acceptance, browser-worker, dr-evidence PASS | No production restore, unmeasured RPO/RTO |

The scripts prove synthetic/read-only contract behavior. They do not prove that a production backup is recoverable, the Coolify API is healthy, or that a production release is safe.

## Open exact-head integration gates

| PR | Owner / scope | Files / behavioral dependency | GitHub checks / decision |
| --- | --- | --- | --- |
| #175 | CORE health + operations | `operations-snapshot.ts`, contract tests; affects worker display semantics | New head `d971b01f2170` adds queued/planning/approval stale-worker guard; exact-head checks pending. Earlier CI/Browser PASS but Urgent Preview HTTP 404 FAILED. HOLD |
| #181 | CORE terminal transitions | `task-engine.ts`, `server.ts`, cancellation/retry tests; mission lifecycle overlaps #175 conceptually, not directly edited files | New head `959d1f6529e6` includes parallel idempotency test, checks pending. Earlier Core/Browser PASS, Urgent Preview HTTP 404 FAILED/CANCELLED. HOLD |
| #177 | FORGE Search Docker liveness | Worker Dockerfile and isolated CI; prerequisite to active-health evidence, not provider readiness | Dedicated Search CI/Core/Browser PASS; Urgent Preview CANCELLED. HOLD until preview classification/owner evidence |
| #179 | FORGE preview bounded polling | Deployment script and test; shares mutable script/runtime with #188 | Unit/Core/Browser PASS; real Urgent Preview FAILED after bounded HTTP 404 retry. HOLD |
| #188 | FORGE two-tier preview concurrency | Shared preview workflow, concurrency tests; serializes existing shared preview resources | Concurrency unit PASS but actual Urgent Preview FAILED: deployment lookup HTTP 404. HOLD, no bypass |
| #166 | CORTEX planner provider failover | `multi-provider-planner.ts`; private-code eligibility / permanent errors, shares provider policy with #171 | DRAFT; Core/Browser PASS, Preview CANCELLED/previous failure. Need combined integration tests and CORTEX ready |
| #171 | CORTEX conversation provider failover | `conversation-ai.ts`; behaviorally coupled to #166, no direct edited-file overlap | DRAFT; Core/Browser PASS, missing authoritative preview acceptance; no merge |
| #178 | CORTEX bounded retry primitives | New provider retry policy module; should underlie both failover surfaces | DRAFT; Core/Browser PASS, Preview CANCELLED; sequencing with #166/#171 required |
| #183 | CORTEX provider circuit breaker | New circuit-breaker module; shares retry/fallback policy decisions | DRAFT; Core/Browser PASS, Preview CANCELLED; integration contract pending |
| #184 | CORTEX quota ledger / costs | New quota/cost accounting modules; budget boundaries must be wired to routing policy | DRAFT; Core/Browser PASS, Preview CANCELLED; hard quota/cost acceptance required |
| #187 | CORTEX provider-wide RPM/TPM admission gate | New provider-rate-limiter module; interacts with #184 budgets and #178 retries | DRAFT; Core/Browser PASS; combined policy, token usage and reset behavior unverified |

| #190 | CORTEX cancellable bounded provider execution guard | New runtime primitive; must compose with retry and circuit-breaker policies | DRAFT; validate/browser-worker PASS, visual pending, preview CANCELLED |
| #191 | CORTEX private-code provider negative-policy tests | Test-only, complements both provider fallback surfaces | DRAFT; validate/Browser PASS, preview CANCELLED; combined policy test still pending |

**Mergeability and branch status are not static.** Check fresh GitHub status and exact-head required checks immediately before every merge. A successful static test does not override a failing preview. No agent-owned branch was modified by CORE-02.

## CORE regression and failure model

- #175: An existing stale persisted `agentRun.status=running` must not show a busy worker when its enclosing mission is terminal, queued, planning or awaiting approval. Only executing missions may claim live worker entries; verify executor readiness against `/health` and `/v1/operations`. No production runtime claim.
- #181: Completed, preview-ready and failed missions cannot transition to cancelled; a cancellation repeated or requested concurrently must yield a single transition/event, inactive archived/trashed projects cannot auto-retry, and missing mission versus terminal conflict use HTTP 404 versus 409.
- Both regression branches are CORE-owned but remain unmerged pending exact-head validation plus real preview classification.
- Preview failures are distinct: HTTP 404 means an unknown deployment record lookup failure; cancelled checks mean **no test verdict**. The exact Coolify queue/UUID root cause remains unknown despite #179 and #188 experiments.

## Package A acceptance — release decision

| User workflow | Evidence | Final status |
| --- | --- | --- |
| Auth, 2FA local secure persistence | PR #167 and isolated Browser CI | CI verified, real production restart **NOT VERIFIED** |
| Project create/archive/trash/restore + isolation | PR #162 authenticated Browser CI | CI verified; live deploy **NOT VERIFIED** |
| Text/voice history, recovery and one final voice turn | PR #119, #157 Browser CI | CI verified; production microphone/transport fault injection **NOT VERIFIED** |
| Markdown security and mobile safe area | PR #160/#161 CI/Browser | CI verified; real mobile production session **NOT VERIFIED** |
| Agent state/health and execution lifecycle | #172 merged, #175/#181 pending | Incomplete pending preview validation and runtime checks |
| Web-research/provider privacy and cost | Historical preview and CORTEX draft PRs | Current production live source research / combined policy **NOT VERIFIED** |
| Coolify preview and production deployment | #179/#188 preview HTTP 404; production manual dispatch | **P0 BLOCKED**. No release or rollout performed |
| Backup, off-site durability, restore/rollback | #168, #170, #182, #189 isolated/contract CI | Contract CI verified only. Production off-site backup / actual restore / RTO/RPO **NOT VERIFIED** |

**Decision: NO-GO / Paket A remains open.** Current production UI/Core SHA and rollback safety require authorized live verification before a future release. Production deploy, restart, pruning, volume deletion, rollback and secret extraction were not performed during CORE-02.
