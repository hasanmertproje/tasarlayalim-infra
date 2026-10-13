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

## Active parallel agent work

- CORTEX AI work: PR #166, branch `feat/ai-provider-fallback-guards-20261013`, still DRAFT at last review. Preserve branch, avoid cherry-picking without coordination; CI and Browser CI passed on recorded head, preview failure does not establish production readiness.
- Historical PR #16, `feature/taso-v2`: do not merge wholesale because it is outdated; selectively assess relevant work with independent acceptance tests.
- Before integrating new NEXUS, FORGE or CORTEX PRs, inspect changed files, CI and Browser CI on exact head SHA, security/blast radius, merge conflicts and production release implications.
- Re-check this index against live GitHub state before making decisions; status is a snapshot, not an automatic lock.

## Current Package A blockers

1. Production Coolify API reachability, confirmed manual deployment and post-deploy health/authenticated smoke tests.
2. TOTP persistence through **real production restart** (local file-store restart CI is not production proof).
3. Off-site encrypted backup/restore, backup freshness alerting, VPS disk headroom and retention.
4. Real logged-in text, voice and web-research acceptance and truthful worker health states.

No agent is authorized by this document alone to perform production deployment, delete volumes, bypass 2FA, extract secrets or approve a HIGH_IMPACT action.
