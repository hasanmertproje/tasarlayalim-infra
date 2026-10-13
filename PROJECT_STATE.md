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

## Active parallel agent work

- CORTEX AI work: PR #166 (`feat/ai-provider-fallback-guards-20261013`) DRAFT, Taso CI / Browser CI PASS, Urgent Preview FAIL (Coolify API HTTP 000 / SSL timeout). CORE requested root-cause evidence in PR discussion; preserve branch.
- CORTEX AI work: PR #171 (`feat/ai-conversation-fallback-20261013`) DRAFT, CI / Browser CI PASS, Urgent Preview CANCELLED; policy/config dependency with #166 needs review, rebase and clean mergeability before integration. CORE review recorded in PR discussion.
- FORGE restore safety drill PR #170: **MERGED** after permission-related CI failure was corrected; isolated safe-restore/backup negative tests passed. No production restore performed.
- FORGE voice liveness: PR #174 (`infra/voice-liveness-healthcheck-20261013`) open, independent review/test evidence pending.
- CORE Cycle 2: PR #175 (`test/core-health-agent-consistency-cycle2-20261013`) open, regression tests for actual health/operations HTTP contract and phantom running worker in terminal mission. Do not mark completed until required checks pass.
- Historical PR #16, `feature/taso-v2`: do not merge wholesale because it is outdated; selectively assess relevant work with independent acceptance tests.
- Before integrating new NEXUS, FORGE or CORTEX PRs, inspect changed files, CI and Browser CI on exact head SHA, security/blast radius, merge conflicts and production release implications.
- Re-check this index against live GitHub state before making decisions; status is a snapshot, not an automatic lock.

## Current Package A blockers

1. Production Coolify API reachability, confirmed manual deployment and post-deploy health/authenticated smoke tests.
2. TOTP persistence through **real production restart** (local file-store restart CI is not production proof).
3. Off-site encrypted backup/restore, backup freshness alerting, VPS disk headroom and retention.
4. Real logged-in text, voice and web-research acceptance; full worker-health probes and monitoring freshness on actual production runtime remain pending despite the #172 UI fail-closed state.

No agent is authorized by this document alone to perform production deployment, delete volumes, bypass 2FA, extract secrets or approve a HIGH_IMPACT action.
