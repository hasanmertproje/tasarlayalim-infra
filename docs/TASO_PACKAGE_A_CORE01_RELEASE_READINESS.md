# TASO Package A — CORE-01 release readiness (evidence snapshot)

Recorded: 2026-10-13
Repository: `hasanmertproje/tasarlayalim-infra`
Baseline `main` SHA: `d96b4691eae2725981978418a0a346e358f04b6c`
Disposition: **NOT RELEASE READY / DO NOT DEPLOY**.

## Evidence standard and boundaries

`PASS (CI)` means executable tests on the specified GitHub commit, not production availability. `LIVE VERIFIED` requires a traceable runtime response, active deployed SHA and post-deployment acceptance. `UNKNOWN` or `NOT RUN` must never be interpreted as success. Do not trigger production deployment or destructive restore under this report.

| Area | Current verifiable evidence | Status / missing release criterion |
| --- | --- | --- |
| Repository merge / build | `main` Taso CI run `38452419982` and Browser CI run `38452420035`: success | **PASS (CI)** at snapshot baseline |
| Login and 2FA | PR #167 encrypted persistence/corruption tests merged; Browser CI runs authenticated isolated owner setup and session-flow tests | **PARTIAL (CI)**; production owner login, TOTP persistence through actual restart/deploy and device revocation **NOT LIVE VERIFIED** |
| Text chat and history | PR #119 recovery parity; project-scoped conversation history and reload checks included in Browser CI | **PASS (CI)**; current production authenticated real AI turn **NOT LIVE VERIFIED** |
| Voice and project isolation | PR #157 voice final turn, one POST, persisted user/assistant IDs, reload/reopen, cross-project isolation; Browser CI accepted | **PASS (CI)**; actual production microphone, voice-originated web sources **NOT LIVE VERIFIED** |
| Web research | Isolated preview historically accepted real search + AI + sourced web turn (per `docs/TASO_V1_STATE.md`) | **HISTORICAL PREVIEW ONLY**; current production sourced text and voice web research **NOT LIVE VERIFIED** |
| Markdown and mobile UI | PR #160 safe Markdown with XSS browser coverage; PR #161 360/390px mobile dock/overflow acceptance | **PASS (CI)**; live device and current prod artifact **NOT VERIFIED** |
| Project lifecycle | PR #162 archive/trash/restore guarded Core API + browser acceptance | **PASS (CI)**; production lifecycle persistence **NOT LIVE VERIFIED** |
| Core health / worker status | PR #172 UI fail-closed on stale probes merged; CORE PR #175 exact head `0f8538ef` Taso CI `38450328138` and Browser CI `38450328723` success | **PARTIAL (CI)**; #175 Urgent Preview `38450328281` FAIL (Coolify deployment GET HTTP 404); source NOT MERGED; live Core/worker consistency **NOT VERIFIED** |
| Mission transitions | CORE PR #181 adds terminal cancellation and inactive-project automatic retry guards | **IN DEVELOPMENT**; requires exact-head CI/Browser/Preview before merge |
| FORGE voice/search healthcheck | Voice Docker liveness #174 merged; search #177 dedicated CI/Browser success, Urgent Preview cancelled | **PARTIAL**; #177 NOT MERGED; liveness is not provider readiness |
| Preview deployment | #175 Urgent Preview `38450328281` failed after search deployment completed: GET core deployment UUID -> HTTP 404. #179 bounded poll also failed on run `38451835769` with repeat 404 | **BLOCKED P0**; Coolify deployment queue/record resolution and verified end-to-end isolated preview required |
| AI provider safety | CORTEX #166 and #171 remain draft; PR #178 retry primitives draft | **NOT INTEGRATED** pending policy tests, preview and cross-surface consistency |
| Storage / off-site backup | Disk headroom tool #164 CI PASS; backup freshness #168; isolated restore drill #170 CI PASS; FORGE off-site integrity PR #182 merged at `4e69aeed53a02ec8276d56c0b37d31e28f4b8c49` with `validate`, `offsite-integrity`, `visual-acceptance`, `browser-worker` checks PASS | **PARTIAL (CI)**; production VPS headroom, scheduled encrypted off-site backup, tested live-target restore, rollback proof **NOT VERIFIED** |
| Production release | Manual-only production gate #163 is merged; push deploys skipped | **CONTROL VERIFIED**; current live SHA is not equal to merged `main` by documented evidence; no new production release authorized |
| Production rollback | Older production UI/Core SHA `5aa4035387b82e934005e9fc85bf2d2f3d6a1466` was historically LIVE VERIFIED per `docs/TASO_V1_STATE.md` after outage | **HISTORICAL ONLY**; actual current runtime SHA, deployment availability, and safe rollback rehearsal **NOT VERIFIED** |

## P0 blocker and ownership

1. **FORGE**: Verify Coolify deployment UUID is from the expected resource and discover why `GET /api/v1/deployments/{uuid}` returns repeated 404 after the queue API returned the UUID. A bounded retry alone was not sufficient (PR #179 preview failed). Investigate server-side Coolify queue/database/audit logs, app-UUID mapping, serialization and preview concurrency; provide exact-head rerun and logs with secrets redacted. Do not retry blindly.
2. **CORE**: Hold #175 until preview success or formally authorized nonblocking disposition; protect existing production runtime. Maintain /health /v1/operations contract tests and mission transition tests; do not claim readiness from source checks.
3. **FORGE**: Document Search healthcheck #177 cancelled preview cause; off-site archive/sidecar PR #182 was integrated after CI; production remote configuration and live recovery must still be verified.
4. **CORTEX**: Demonstrate #166/#171 provider policy parity (classification, cost caps, transient/permanent errors and sanitized logs), settle sequencing and resolve any conflicts on own branches.
5. **RELEASE OWNER**: With explicit production approval *after* all gates, verify current UI/Core/worker SHA, 2FA restart continuity, authenticated real text/voice/web flows, disk and off-site backup restore, rollback capability. No release performed by CORE-01.

## Decision

Paket A is **still open**. A green GitHub CI is necessary but not sufficient for preview or production acceptance. The historic production SHA listed above is a documented prior verification, **not a current live probe**. No production deployment, rollback, restarts, volume changes, or secret extraction is authorized here.
