# Taso V2 migration baseline

This document is the implementation companion to `TASO_V2_MIGRATION_MASTER_PROMPT.txt`. The master prompt remains authoritative.

## M0 audit — preservation / replacement matrix

| Area | Current verified state | V2 decision |
| --- | --- | --- |
| Taso Core gateway | Private Core behind nginx gateway with server-side gateway secret | **Preserve** and keep browser unable to read the secret |
| Project/workspace registry | Project-scoped workspaces with bootstrap reconciliation | **Preserve**, extend with conversation/session state |
| Mission engine | READ / WRITE / HIGH_IMPACT, approvals, timeline events | **Preserve**, evolve with richer execution metadata and self-heal |
| GitHub broker | Read repo, branch, write files, PR, CI status | **Preserve** |
| Multi-provider router | Cost/data-class routing foundation and runtime provider fallback | **Preserve**, add truthful readiness, health, usage and routing reason |
| Coolify adapter | Deployment adapter exists | **Preserve**, preview-first and production approval remain mandatory |
| State persistence | Atomic JSON snapshot when `TASO_STATE_FILE` is enabled | **Preserve for migration**, extend schema safely; PostgreSQL is not a prerequisite for V2 preview |
| Command Center UI | Functional prototype | **Replace incrementally** with V2 information architecture |
| Theme system | Partial dark/light implementation with hard-coded colors | **Replace** with semantic design tokens |
| Voice | Browser speech input + canned status TTS | **Replace** with shared Conversation Engine architecture |
| Chat behavior | Main composer creates missions directly | **Replace** with Conversation Engine first, Mission Engine second |
| Executor UI | Compact dock with basic readiness and artifacts | **Replace incrementally** with Executor V2 console |
| Mission result renderer | Raw summary text can expose Markdown / literal `<br>` | **Replace** with safe structured rendering |
| ntfy | CI-oriented notifications | **Replace integration layer**, preserve self-hosted ntfy service and credentials |
| Production authority | Human-controlled | **Preserve, non-negotiable** |

## Known migration constraints

- Production resources stay on `main` / `HEAD`; V2 work stays on `feature/taso-v2` until preview acceptance.
- Existing working Core/GitHub/provider integrations must not be removed to simplify UI work.
- No secrets may be added to source, logs or browser payloads.
- Taso self-improvement may create PR/CI/preview artifacts but may not self-merge or self-deploy production.
- Mobile 360px behavior is an acceptance target, not a later enhancement.

## V2 first implementation slice

1. Introduce a persisted Conversation domain separate from Mission.
2. Add an intent classifier contract so ordinary chat no longer has to become a mission.
3. Add a `/v1/conversations/messages` boundary for text and future voice to share.
4. Introduce Design System V2 semantic tokens and force all current surfaces, including Executor, to inherit them.
5. Keep the existing mission composer available in BUILD mode while ASK mode uses Conversation.
6. Add tests proving chat intent does not create a mission and execution intent is classified separately.

## Not yet claimed complete in this slice

- realtime conversational voice
- autonomous sessions / Night Shift
- bounded CI self-heal
- provider usage ledger and cost accounting
- full Executor V2 timeline
- Core-driven ntfy Notification Service
- automatic Coolify deployment

Those remain later milestones and must not be represented as finished before verification.
