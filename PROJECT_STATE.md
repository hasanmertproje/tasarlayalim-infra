# TASO — PROJECT_STATE

Updated: 2026-10-13

## Authority and boundaries

- Canonical development scope: `hasanmertproje/tasarlayalim-infra`. Android Launcher is outside this project.
- Product plan, historical architectural decisions, and Package A acceptance evidence remain in `docs/TASO_V1_STATE.md` and `docs/TASO_ACCEPTANCE.md`. This file is a coordination index, not a replacement.
- TASO CORE: mainline integration owner; review agent PRs and CI, preserve independent branches and require passing deterministic gates before integration.
- NEXUS: technical coordination and QA audit.
- FORGE: infrastructure, deployment safety, backup, recovery.
- CORTEX: provider routing, AI systems.
- Agent branch ownership must be respected. Do not force-push, overwrite or repurpose another agent's active branch.
- Production release is **manual-only** (GitHub Actions `workflow_dispatch`); obtain user approval for critical production or destructive operations.
- A merged PR is not evidence that production runs the merged commit. Verify Coolify deployment and authenticated runtime separately.

## Mainline integration record

| PR | Work | Main merge commit | Evidence | Live status |
| --- | --- | --- | --- | --- |
| #160 | Safe Markdown security | `50df7d44091e` | CI + Browser CI passed | NOT LIVE VERIFIED |
| #161 | Mobile dock acceptance | `9966d72d8878` | CI + Browser CI passed | Separate mobile live evidence pending |
| #162 | Project archive / trash / restore | `bb1e4f583e69` | CI run `38443213301` PASS; Browser CI run `38443212565` PASS | Production deploy skipped |
| #163 | Manual production dispatch gate | `55815417dfd1` | CI + Browser CI + patch CI PASS; deploy job skipped | Production release gated |
| #164 | Read-only disk headroom guard | `f1f70516b6d8` | CI + Browser CI PASS | VPS enforcement unverified |
| #165 | Package A acceptance ledger update | `3b8380125dc2` | CI + Browser CI PASS | Docs only |
| #167 | 2FA restart persistence + fail-closed corrupted state | `4da70312a0c1` | CI + Browser CI PASS | Production restart + persistent volume unverified |
| #168 | Backup freshness and integrity probe | `424611ea332a` | Dedicated backup CI + CI + Browser CI PASS | Off-site storage and scheduled execution unverified |
| #169 | Multi-agent coordination state file | `6c1f9380facb` | Taso CI + Browser CI PASS | Docs only |
| #172 | Fail-closed monitoring and command-center health indicators | `e9b0ea7417d` | Taso CI `38446118004` + Browser CI `38446118345` PASS | Live worker-health probes pending |
| #173 | Package A integration ledger update | `931f45ec6b0e` | CI `38446700377` + Browser CI `38446700892` PASS; check-runs validate/visual-acceptance/browser-worker PASS | Docs only |
| #170 | FORGE isolated restore safety drill | `812b27835cab` | Restore Drill `38448056942`, CI `38448057107`, Browser CI `38448056982` PASS | CI ephemeral restore only; production restore NOT RUN |
| #174 | FORGE Voice liveness healthcheck | `f98f70531a28` | Voice Liveness CI + Taso CI + Browser CI PASS | Docker liveness only; production voice runtime NOT VERIFIED |

## Active parallel agent work

- CORTEX AI work: PR #166 (`feat/ai-provider-fallback-guards-20261013`) DRAFT, Taso CI / Browser CI PASS, Urgent Preview FAIL (Coolify API HTTP 000 / SSL timeout). CORE requested root-cause evidence in PR discussion; preserve branch.
- CORTEX AI work: PR #171 (`feat/ai-conversation-fallback-20261013`) DRAFT, CI / Browser CI PASS, Urgent Preview CANCELLED; policy/config dependency with #166 needs review, rebase and clean mergeability before integration. CORE review recorded in PR discussion.
- FORGE restore safety drill PR #170: **MERGED** after permission-related CI failure was corrected; isolated safe-restore/backup negative tests passed. No production restore performed.
- FORGE voice liveness PR #174: **MERGED** after Voice Liveness, Taso CI and Browser CI passed; does not establish live production readiness.
- CORE Cycle 2 PR #175 (`test/core-health-agent-consistency-cycle2-20261013`): CI `38449011820` + Browser CI `38449011776` PASS; Urgent Preview `38449011920` FAIL on Coolify API deployment UUID HTTP 404. Merge BLOCKED pending FORGE deployment-id root cause/rerun or accepted non-blocking classification. Source and regression tests remain in protected PR branch.
- Historical PR #16, `feature/taso-v2`: do not merge wholesale because it is outdated; selectively assess relevant work with independent acceptance tests.
- Before integrating new NEXUS, FORGE or CORTEX PRs, inspect changed files, CI and Browser CI on exact head SHA, security/blast radius, merge conflicts and production release implications.
- Re-check this index against live GitHub state before making decisions; status is a snapshot, not an automatic lock.

## Cycle 3 P0 — health/agent regression and Coolify preview evidence

- CORE PR #175 at head `0f8538ef03ac2a32ba513f39eaee3ae75d222c38`: **Taso CI `38450328138` PASS**, **Browser CI `38450328723` PASS**. HTTP `/health` versus `/v1/operations` readiness consistency, recovery-time phantom busy-agent prevention and existing browser acceptance are green in isolated CI.
- **Urgent Preview `38450328281` FAILED** before application-level smoke tests. Log: search deployment finished; Coolify `GET deployments/bghzhnrj7ylqpujxgtg8l6fv` returned HTTP 404 `Deployment not found`. Previous preview `38449011920` failed at the same lookup with a different deployment UUID. Immediate failure is Coolify deployment polling / resource lookup; underlying record-disappearance/UUID mismatch/concurrency cause remains **unverified**.
- **PR #175 NOT MERGED** until preview gate resolution or a documented, authorized nonblocking classification. CORE requested FORGE to investigate Coolify deployment polling and furnish rerun evidence. No production deploy, no verified production health behavior.
- FORGE PR #177 at `fab2fde7dc2292f68722c758b20534bf4ebbf6bf`: GitHub now reports `mergeable=true`; an earlier false state was not reproducible at last check. Dedicated search-healthcheck, Taso CI and Browser CI PASS; Urgent Preview CANCELLED. Branch remains untouched pending FORGE explanation and integration acceptance.
- CORTEX PRs #166 and #171 remain DRAFT; CORE will not integrate without provider-policy consistency and preview/merge readiness evidence. Branches remain untouched.

## CORE-01 release-readiness checkpoint (2026-10-13)

- Release acceptance matrix: [`docs/TASO_PACKAGE_A_CORE01_RELEASE_READINESS.md`](docs/TASO_PACKAGE_A_CORE01_RELEASE_READINESS.md). **NOT RELEASE READY / DO NOT DEPLOY**.
- FORGE PR #179 polling retry: Taso CI, Browser CI and Preview Poll Contract CI PASS on `e6c349850160`, but isolated Urgent Preview run `38451835769` still FAILED: Core deployment UUID HTTP 404 after bounded retries. Escalated to FORGE; bounded read-after-write is insufficient as a proven root-cause fix.
- CORE PR #181 mission lifecycle terminal-cancellation and inactive-project auto-retry safeguards: exact head `eb5ba7fa70b4` Taso CI `38454902765` PASS and Browser CI `38454902903` PASS; Urgent Preview `38454902793` CANCELLED, NOT MERGED.
- FORGE PR #182 off-site archive/sidecar verification: **MERGED** at `4e69aeed53a02ec8276d56c0b37d31e28f4b8c49` following Taso CI, Browser CI and dedicated Offsite Integrity CI PASS; real production backup/restore still NOT VERIFIED.
- #175 remains unmerged with CI/Browser PASS and Urgent Preview FAIL; #166/#171/#178 CORTEX branches remain independent and unmerged.
- Last historically LIVE VERIFIED production UI/Core SHA is `5aa4035387b82e934005e9fc85bf2d2f3d6a1466`; do not treat it as a current runtime probe. Production rollback and new live SHA not verified.

## Current Package A blockers

1. Production Coolify API reachability, confirmed manual deployment and post-deploy health/authenticated smoke tests.
2. TOTP persistence through **real production restart** (local file-store restart CI is not production proof).
3. Off-site encrypted backup/restore, backup freshness alerting, VPS disk headroom and retention.
4. Real logged-in text, voice and web-research acceptance; full worker-health probes and monitoring freshness on actual production runtime remain pending despite the #172 UI fail-closed state.

No agent is authorized by this document alone to perform production deployment, delete volumes, bypass 2FA, extract secrets or approve a HIGH_IMPACT action.
