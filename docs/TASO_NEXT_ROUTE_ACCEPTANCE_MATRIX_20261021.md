# TASO NEXT — route / screen acceptance matrix (2026-10-21)

Repository snapshot: `feature/taso-stacked-ci-coverage-20261020`; stacked PR chain #216 → #217 → #218 → #219 → #225. This is a source-based inventory, not a claim that all screens have passed browser acceptance.

## Prototypical areas and live implementation

| Prototype area documented by source integration review | Live screen | Live component / implementation | Function truth | Desktop/mobile acceptance |
|---|---|---|---|---|
| Premium admin dashboard | Command Center | `CommandCenterV30`, `DashboardShellV2`, `TruthSurfaces` | Core projects/missions/agents, chat and existing Voice path; no fabricated prototype counters | Generic browser suite covers 390/1440 dark/light; exact latest run must pass |
| User workspace | Workspace | `NextWorkspace` | Reads Core projects/missions/operations; does not grant a separate server-side user role | 320–1920 responsive suite and Core count assertion |
| Project overview / lifecycle | Projects | `ProjectCenterV9` | Core project/manifest/knowledge/milestones; create/archive/trash/restore | Browser route shots 390/1440; lifecycle flow is separate acceptance script |
| Tasks / mission execution | Tasks | `MissionControlV8` | Existing Core mission state/execution and approval handoff | Browser route shots 390/1440; live provider success still depends on provider availability |
| Approvals | Approvals | `ApprovalCenterV9` | Existing Core approval flow; not replaced with demo approval buttons | Browser route shots 390/1440; deeper end-to-end approval coverage remains a separate acceptance gap |
| Design Studio | Studio | `TasoStudioV1`, `studio-document.ts`, Core `studio-routes.ts` / `studio-store.ts` | Core-backed bounded design document, pages/nodes, save, checkpoints, restore, safe deterministic HTML export. Not a full framework publisher | Dedicated authenticated Studio acceptance at 320–1920; current run result pending |
| Live Site Editor / framework publisher | No live screen in `TASO_SCREENS` | Not implemented | **Explicit gap.** Do not present Studio HTML export as Laravel/CodeIgniter/Next.js build, preview, or publish support | Not applicable; do not claim accepted |
| TASO Voice orb / voice flow | Command Center + overlay | `DashboardChat`, `VoiceModeOverlay`, `TruthSurfaces` | Real browser/Core voice path retained; decorative orb is not itself the voice engine | Voice acceptance scripts run in Browser CI; real provider availability must pass preview acceptance separately |
| AI Copilot / “build together” | Command Center chat and missions | Existing Core conversation and mission routes | Prototype's deterministic local assistant is not production functionality; no fake patch or autonomous publish | AI provider real-response acceptance remains subject to external provider availability |
| Agents | AI Agents | `AgentFleetV11`, `AgentOpsDock` | Reads Core runtime/mission agent states; no simulated live agents | Browser route shots 390/1440 |
| Knowledge | Knowledge | `KnowledgeCenter` | Existing Core project knowledge interface | Browser route shots 390/1440 |
| Integrations | Integrations | `IntegrationsCenterV29` | Existing broker/configuration interface; status must be labelled as configuration, not proof of remote service health | Browser route shots 390/1440 |
| Deployments | Deployments | `OperationsCenterV10` + `TruthSurfaces` | Mission delivery records and Core executor capability; production actions remain human-gated | Browser route shots 390/1440 |
| Monitoring | Monitoring | `OperationsCenterV10` + `TruthSurfaces` | Core-reported health/capabilities only; no invented CPU/RAM/disk/uptime | Browser route shots 390/1440 |
| Infrastructure | Infrastructure | `TruthSurfaces` (new dedicated read-only surface) | Reads Core health, executor capability, and operations snapshot. No deploy/restart/secret mutation controls; no unsupported host metrics | Added to browser screenshot/overflow acceptance; pending CI result |
| Notifications | Notifications | `NotificationsCenterV12` | Core mission/activity feed and browser notification permission; external delivery is not claimed without a configured backend | Browser route shots 390/1440 |
| Settings / account / branding | Settings | `ControlPlaneV29`, `ControlPlaneExtrasV29`, `TruthSurfaces` | Existing auth/TOTP/trusted-device and supported persisted controls; local voice preferences are labelled local | Browser route shots 390/1440 |
| Admin vs Workspace navigation | Admin screens / Workspace | `DashboardShellV2` | Separate navigation information architectures; surface switch is presentation only, not an RBAC boundary | Mobile dock and Workspace route tests; physical Android not tested |
| Prototype role picker | Not ported as a privilege switch | Existing `AuthGateV17` + server permission checks | Prototype local role state would be insecure; distinct user/org RBAC is not implemented by a client toggle | Security acceptance still needs full route-level permission matrix |

## Changes in this acceptance pass

- `TruthSurfaces` now treats `Infrastructure` as an active Core-backed screen.
- The runtime portal attaches to persistent `.ds2-main`, not a page-specific `.main-area` node that may disappear when navigation changes.
- Browser visual acceptance now includes `Infrastructure` in the dark/light 390px and 1440px screen sweep.

## Important limits

- The original prototype ZIP's `SCREEN_MAP.md` is not present as a standalone tracked repository file in this branch. The mapping above uses the checked-in source integration review and actual live screen/component registry; it does not invent extra prototype URLs.
- The SPA screen selector is a client-side navigation state, with `?screen=` used only as an entry hint. This is not a conventional independently addressable URL route for every screen.
- Browser screenshots/artifact generation is not equivalent to visual correctness. The current CI run and isolated preview must finish successfully before these rows can be marked accepted.
- No production deployment, merge, production data mutation, or physical Android test was performed.
