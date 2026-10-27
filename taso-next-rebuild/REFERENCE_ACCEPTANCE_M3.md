# M3 — Referans Publisher / Studio ↔ Preview ↔ HTML (2026-10-28)

Reference: `TASO-NEXT-Publisher-Desktop.png` and the TASO NEXT Studio/Admin reference screens. This milestone stays in the isolated `taso-next-rebuild/` laboratory; it is not the production UI.

## Implemented
- Replaced the static Publisher demonstration with a reference-oriented editor composed of a project file column, central visual/code/version workspace and a truthful deployment-environment column.
- Canonical in-browser Studio blocks drive both the Studio HTML export and Publisher iframe preview from `publisherDocument.ts`; text edits are visible immediately.
- Escape all user-controlled text and title on export; generated HTML includes a restrictive CSP and no executable JavaScript. The inline iframe has the `sandbox` attribute.
- A browser download provides the actual HTML file, and local revision save/restore updates the shared Studio blocks (no fake Core revision claim).
- Laravel and React show only technology file manifests and explicitly DISABLE build/HTML export. Production deploy is disabled.

## Verification
- Chromium/Playwright offline M3: 7/7 end-to-end groups PASS, 320/360/390/430/768/1024/1440/1920px without page overflow; screenshot evidence M3 Publisher desktop and mobile.
- Node deterministic publisher document checks: escaping, CSP, title, manifest paths.
- Isolated GitHub Actions runs TypeScript/Vite build, offline HTML build, document contract. Exact head SHA and outcomes must be verified on the PR.
- These browser tests were executed in a harnessed about:blank page because local Chromium forbids file:// navigation. Storage is a deterministic in-memory shim for acceptance testing; actual browser storage persistence on a physical Android device is NOT VERIFIED.
- No Core API, auth, project-specific backend revisions, Laravel/React build, physical Android or production deployment. All of those remain OUT OF SCOPE for this code slice.

## Safety & promotion policy
PR #232 remains DRAFT and unmerged; no changes in `main`, `taso-ui/`, `taso/` or Coolify production. The isolated UI is NOT production-ready. The next architectural step is to migrate the reference-aligned UI to the real Core-backed `taso-ui/` while preserving existing auth, session, mission approvals and Studio revision store.

## M3 hardening (project-scoped data)
- Each selected project now has an independent Studio document in `studioDocuments`; previously `blocks` was incorrectly shared across projects. The legacy `blocks` value is preserved only as a backward-compatible default for `pr-1`.
- Local Publisher version save/restore targets only the active project document. Cross-project browser isolation checks passed (8/8 M3 groups).
- Explicit note: this is browser-local demo isolation, **not** production authorization/RBAC or backend tenant isolation.
