# TASO NEXT — Milestone 2 Studio engineering decisions (2026-10-20)

**Base:** PR #216 head `211d161b3946b19b159d75075f0e007b3a15eaa4`. This branch intentionally remains isolated from `main`. Do not run production deployment. New PR targets the M1 branch as a **stacked** PR.

## M1 acceptance and visual review

Verified GitHub workflow run `39401353270` Taso CI, `39401353349` Browser CI, and `39401353300` preview attempt 2: successful. The first preview attempt ended with HTTP 503 from real AI chat; retry passed without evidence of a permanent provider fix.

Artifact `12255335120`, `taso-v29-visual-evidence`: 17,869,954 bytes; extracted images include `dashboard-dark-390.png`, `dashboard-dark-1440.png`, `workspace-dark-390.png`, `workspace-dark-1440.png` and 320–1920 Workspace. Screenshot comparison against six user-supplied references:
- The real Admin preserves live mission, approval, command/chat and Voice paths but is visibly less dense and less integrated than the premium mockup; the hero orb is present. Real figures are mostly zero rather than misleading mock activity.
- The real Workspace uses project cards, Core counts and context actions, but lacks the reference's advanced collaboration avatars, project media previews, rich asset/notification panels and Studio edit surface.
- Mobile layouts pass automated overflow checks, but the real interface has much more vertical scrolling and must be manually reviewed on physical Android.
- The reference Studio and Site Editor were entirely absent in M1. M2 adds an independently tested Studio, not a fake publish panel.

## Editor candidate evaluation

| Candidate | License | React/graph model | Touch and bundle cost | Decision |
|---|---|---|---|---|
| GrapesJS core + React wrapper | BSD-3-Clause core, MIT wrapper | Mature HTML/CSS builder, custom component/style managers, its own storage/export schema | Extra runtime, richer desktop; touch relies on testing/integration (grapesjs-touch). Syncing its internal AST with project manifest and TASO revision JSON creates two sources of truth. | Strong future web-page-builder adapter; do not import into baseline M2 Core |
| Craft.js | MIT | React-native nodes, drag/drop framework, controlled custom UI, optional layers | Must implement serialization, mobile UI, real backend save and permission integration; maintained React-ecosystem solution, but peer version of exact installed package must be checked | Viable alternative for advanced designer interactions |
| dnd-kit | MIT | React drag/drop primitives, no competing document schema | Load only interaction engine when drag is required; supports keyboard/touch sensors with proper integration | **Preferred next interaction adapter**, not yet installed or advertised as implemented |
| tldraw SDK | Custom production license | Excellent spatial canvas but different page/DOM document goals | Commercial key required for production use; license cost and non-HTML scene model | Not selected for TASO web-page studio |
| Custom bounded React renderer + Core document grammar | TASO-owned code, no extra dependency | One canonical `StudioDocument` JSON tree, deterministic HTML serialization and preview, auditable write operations | Smallest new bundle cost, reliable touch-friendly reorder controls now; complex freeform drag isn't available until a separate adapter lands | **Selected for initial working end-to-end Studio workflow** |

Sources (public product licensing and capabilities; not proof of measured runtime bundle sizes):
- GrapesJS: https://github.com/GrapesJS/grapesjs ; wrapper https://github.com/GrapesJS/react
- Craft.js: https://github.com/prevwong/craft.js/
- dnd-kit: https://github.com/clauderic/dnd-kit
- tldraw: https://tldraw.dev/community/license

**Important qualification:** No instrumented bundle-size or physical-device profiling was done on these uninstalled alternatives. The selected narrow schema is not equivalent to a complete GrapesJS/Figma-class drag-and-drop engine. Drag gestures, rich media/image upload and framework adapters are explicitly outside this M2 slice.

## Concrete implementation

- `taso/src/studio-store.ts`: project-scoped `StudioDocument`, `Page`, bounded `Node` tree, finite style grammar, versioned immutable `StudioCheckpoint`, conflict errors; snapshot history limited to 40 entries.
- `taso/src/studio-routes.ts`: GET/POST/PUT and checkpoint/restore, server-enforced project existence/active lifecycle and trusted gateway permission claims.
- `taso/src/state-store.ts` + `server.ts`: Studio stored in **same atomic Core snapshot file** alongside projects/missions; legacy missing field defaults to empty array. No separate DB credentials or storage volume changes.
- `taso/src/gateway-authorizer.ts`: normalize raw Nginx `/api/v1/` path to `/v1/` before applying permission/membership checks; prevents relying on a default `dashboard.read` for privileged project modifications.
- `taso-ui/src/TasoStudioV1.tsx`: real project selection, explicit Studio initialization, page creation, nested section/text/button/heading trees, selection, keyboard-friendly reorder, inline editable properties, mobile/tablet/desktop artboards, same-model deterministic HTML code view, local undo/redo, Core save, checkpoints, and restore.
- `taso-ui/src/taso-studio-v1.css`: desktop 3-pane application and mobile touch-oriented sheet; navigation never switches auth role or simulates AI activity.
- Browser test `scripts/taso-studio-browser-acceptance.mjs` creates Studio, page, heading, text/style, persists, snapshots, modifies, restores and asserts direct Core state. Captures 320/360/390/430/768/1024/1440/1920 screenshots.

## Explicit non-goals and safety

**This release does not fabricate Copilot generation or publication.** Actual AI patch proposal, human approval, framework code builds, collaborative editing, real-time coauthor cursor, and production publisher remain separate future milestones.

Studio document model is a bounded *design document* rather than a GitHub file checkout. A future exporter must map into React/Next.js, Laravel Blade or CI4 views through real framework-specific AST transforms and isolated compilation tests.

The existing `AuthGateV17`, TOTP, Core mission execution, Voice, Nginx auth and project registry remain in place. The gateway authorizer is the authority for non-owner project access; direct Core Studio routes additionally reject missing identity and mismatched permission claims. A successful browser test cannot replace full penetration testing of every route.

**Merge order:** M2 PR -> M1 branch; *do not* merge M1 or M2 to `main` without explicit approval and production rollback/backup validation.
