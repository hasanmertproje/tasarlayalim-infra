# TASO NEXT — Route migration matrix and milestone ledger

**Branch:** `fix/taso-next-complete-screen-migration`  
**Draft PR:** https://github.com/hasanmertproje/tasarlayalim-infra/pull/231  
**Safety:** This branch must not be merged or deployed to production without explicit user approval.

## Source interpretation

The supplied `TASO-NEXT-React-TypeScript-Kaynak.zip` is an offline React 16 prototype, not a production implementation. Its `SCREEN_MAP.md` identifies Admin Overview, Mission, Domain, Settings, Studio, Publisher, Collaboration and Voice screens. Its local `PrototypeData` store, simulated missions, role switch, chat responses and static HTML export must not be treated as Core-backed functionality.

## Route inventory (current implementation state)

Status terms:
- **Core-backed existing surface:** real existing TASO component/API; the complete TASO NEXT visual redesign is not yet accepted.
- **Core-backed new surface:** new route-specific UI uses existing authenticated Core contracts; acceptance remains pending.
- **Safely disabled:** route exists, explains the missing server-side capability, and does not impersonate an implemented feature.

| Area | Screen | Current component | Data/behavior truth | Migration status |
|---|---|---|---|---|
| Admin | Kontrol Merkezi | `CommandCenterV30` | Real Core projects, missions, operations, capabilities, Voice status and mission creation | Existing Core-backed surface; full visual acceptance pending |
| Admin | Projeler | `ProjectCenterV9` | Real project, manifest, knowledge and milestone APIs | Existing Core-backed surface; full visual acceptance pending |
| Admin | Tasarım Stüdyosu | `TasoStudioV1` | Project-scoped persisted Studio document, revisions and export endpoints | Existing Core-backed surface; Studio acceptance pending |
| Admin | TASO Voice | `WorkspaceChatRoute` | Real project-bound conversation; existing microphone/STT/TTS flow is provided by `DashboardChat` when supported | New route; voice acceptance pending |
| Admin | Görevler | `MissionControlV8` | Real mission execution, steps, artifacts and status | Existing Core-backed surface; full visual acceptance pending |
| Admin | Onaylar | `ApprovalCenterV9` | Existing protected approval flow | Existing Core-backed surface; regression pending |
| Admin | Dağıtımlar | `OperationsCenterV10(mode="deployments")` | Existing deployment and preview records | Existing Core-backed surface; full visual acceptance pending |
| Admin | Yapay Zekâ Ajanları | `AgentFleetV11` | Real agent runs/artifacts from Core | Existing Core-backed surface; full visual acceptance pending |
| Admin | Bilgi Merkezi | `KnowledgeCenter` | Real project manifest and knowledge APIs | Existing Core-backed surface; full visual acceptance pending |
| Admin | Entegrasyonlar | `IntegrationsCenterV29` | Existing integration/control-plane APIs | Existing Core-backed surface; full visual acceptance pending |
| Admin | İzleme | `OperationsCenterV10(mode="monitoring")` + `TruthSurfaces` | Only reported Core health/capability values; missing telemetry must not be invented | Existing Core-backed surface; full visual acceptance pending |
| Admin | Ayarlar | `ControlPlaneV29` | Existing control-plane settings | Existing surface; permission/regression review pending |
| Admin | Bildirimler | `NotificationsCenterV12` | Existing operational feed | Existing Core-backed surface; full visual acceptance pending |
| Admin | Altyapı | `WorkspaceCapabilityPage` | Redirects to verified Monitoring/Deployments; does not invent a full service inventory | Safely bounded; dedicated infrastructure page not yet implemented |
| Workspace | Ana Sayfa | `NextWorkspace` | Real Core projects, missions and operations; no prototype local data | Core-backed new surface; responsive acceptance pending |
| Workspace | Projelerim | `ProjectCenterV9` | Existing authenticated operator's project list; not a separate server-side customer RBAC scope | Shared Core-backed surface; user-scoped membership API is a separate requirement |
| Workspace | TASO'yu Görevlendir | `WorkspaceAssignRoute` | Real `POST /v1/missions`; requires Core health and an active project; production/destructive actions remain separately gated | Core-backed new surface; submit flow acceptance pending |
| Workspace | TASO ile Beraber Yapalım | `WorkspaceChatRoute` | Real project-bound `/v1/conversations` history and message flow through `DashboardChat` | Core-backed new surface; conversation acceptance pending |
| Workspace | Tasarım Stüdyosu | `TasoStudioV1` | Same project-scoped persisted Studio API as Admin Studio | Core-backed surface; Studio acceptance pending |
| Workspace | Canlı Site Editörü | `WorkspaceCapabilityPage` | No false claim of live file editing or publishing | Safely disabled pending isolated build/preview/artifact/release acceptance |
| Workspace | Kod ve Dosyalar | `WorkspaceCapabilityPage` | No mock file tree or unauthorized write control | Safely disabled pending project-scoped filesystem/Git authorization |
| Workspace | İçerikler | `WorkspaceCapabilityPage` | Not conflated with technical project knowledge | Safely disabled pending a real content model/API |
| Workspace | Ajanlarım | `WorkspaceCapabilityPage` | Does not expose the global Admin agent fleet as user-assigned agents | Safely disabled pending project-scoped agent assignment |
| Workspace | Konuşmalar | `WorkspaceChatRoute` | Real project-bound Core conversation history and messaging | Core-backed new surface; acceptance pending |
| Workspace | Görev Geçmişi | `MissionControlV8` | Existing authenticated operator mission view; not a separate end-user RBAC scope | Shared Core-backed surface; user-scoped membership remains a requirement |
| Workspace | Yayınlar | `WorkspaceCapabilityPage` | Does not expose global deployments as a user's project releases | Safely disabled pending project-scoped release/artifact API |
| Workspace | Ekip ve İş Birliği | `WorkspaceCapabilityPage` | No fake member list or client-side role switch | Safely disabled pending server-enforced organization/project membership |
| Workspace | Bildirimler | `WorkspaceCapabilityPage` | Does not present the global operations feed as personal notifications | Safely disabled pending user-scoped notifications/read state |
| Workspace | Kişiselleştirme | `WorkspaceCapabilityPage` | Theme toggle remains in the shell; no fake persisted preference form | Safely disabled pending user-bound preferences API |
| Workspace | Hesap Ayarları | `WorkspaceCapabilityPage` | Does not impersonate personal account/security settings using admin controls | Safely disabled pending verified profile/session/TOTP account contracts |

## Milestones

- **M0 — source and route audit:** prototype screen map and live navigation reviewed; current matrix established.
- **M1 — navigation and route wiring:** in progress. Full Admin/Workspace screen inventories, distinct Workspace Studio route, URL deep links/history, workspace task assignment, project-bound collaboration/Voice surfaces and safe capability boundaries added on this branch.
- **M2 — full visual migration:** **not complete**. Existing Admin modules still require page-by-page TASO NEXT visual migration and evidence; this PR is not a completion claim.
- **M3 — Studio:** existing persistence/drag/revision/export code is present through the stacked PR work; this branch still requires the dedicated Studio browser acceptance result.
- **M4 — auth/RBAC/Core/Voice regressions:** pending current CI/preview results; Workspace remains an operator surface and does not create backend user/organization RBAC.
- **M5 — responsive and accessibility acceptance:** route-wide Chromium acceptance is being expanded; physical Android testing is not claimed.
- **M6 — isolated preview and final audit:** pending successful route/browser tests and preview. No production deployment is permitted by the current task.

## Current acceptance gates

- TypeScript/Vite production build must pass.
- Browser acceptance must load each route, assert the intended page surface, check horizontal overflow/clipped controls and retain deep links.
- New assignment and conversation surfaces must use the real isolated Core, not mocks.
- Isolated preview must be validated against the final branch SHA.
- Any failed or unrun check remains a blocker. Passing build or health checks alone does not prove visual migration.
