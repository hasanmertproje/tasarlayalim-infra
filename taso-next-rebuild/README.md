# TASO NEXT — Rebuild Lab M2 (Reference Fidelity)

Independent, offline-first React/TypeScript UX prototype for TASO. **Not production / not merged.**

## Scope
- 19 Admin + 16 Workspace navigation destinations; 35 routes mapped to purpose-specific views.
- Operational overview, project/task/approval demo lifecycle, Studio document text editor + local HTML export, Voice demo session states, Publisher demo release states, Collaboration local chat, monitoring, integrations boundaries, notifications, team, agent fleet, infrastructure, knowledge, security, and settings.
- New TASO-specific visual system and separate mobile studio panes; no imported historical DomainPage or style override chain.

## Development
```bash
cd taso-next-rebuild
npm install
npm run typecheck
npm run build
npm run build:offline  # dist/index.html is a standalone offline demo
npm run dev
```
Node >=20.19. Both standard and standalone offline modes are configured in Vite. The Vite installation/build **could not be run in this environment** because the package registry was inaccessible. Do not record them as passed. GitHub CI should run them once dependencies are available.

## Offline Android HTML
Run `npm run build:offline` to generate `dist/index.html` via the MIT-licensed `vite-plugin-singlefile`; that is the intended reproducible one-file build once dependencies are installed. The provided `TASO-NEXT-LAB-ANDROID.html` was compiled from the **same TSX source** with a local TS compiler and bundled historical React 16 UMD files *only to enable local QA when the npm registry was unavailable*. `scripts/build_offline.py` is a **development-only fallback** and currently expects a historical ZIP at `/mnt/data/TASO-NEXT-REBUILT-SOURCE.zip`; it is not the supported Vite build pipeline.

## Integration boundary
All data is synthetic demo fixture data stored under the localStorage key `taso-next-rebuild-v1`. No credentials or API tokens are needed. No requests are made to Core, Coolify, GitHub, an LLM provider or device microphone. Real auth, RBAC, operational monitoring, STT/TTS and deployment remain unimplemented. Disabling actions with explanatory states is intentional.

## Architecture decision
Existing TASO Core API and the existing `taso-ui` package are unchanged. The current independent app is an isolated design lab. The next milestone is a safe Core-backed adapter to existing authenticated routes and migration of screen ownership into the production UI, after verifying PR #231 integration boundaries. Do not merge or deploy this lab directly to production.

## QA
`tests/test_smoke.py` executes an offline Chromium test: eight screen widths on the initial route, hub approval chain at 390/1440, Studio editing at 390/1440, voice demo at 390/1440, and navigation of all 35 routes at those two widths. Results in `qa/results.json` and screenshots in `qa/`. Android physical device, Vite build, TypeScript full typecheck and accessibility audit are not yet verified.

## CI
An isolated GitHub Actions job for this directory performs clean dependency installation, TypeScript typecheck, both Vite modes and uploads a one-file HTML artifact. **Only a green run on this exact branch SHA is evidence that the Vite build works.**
## M2 visual-reference milestone

See [REFERENCE_ACCEPTANCE_M2.md](REFERENCE_ACCEPTANCE_M2.md). M1 charcoal/lime design was rejected and replaced with the reference navy, indigo, violet and blue visual identity. `src/TasoOrb.tsx` renders the reference-aligned orb without external resources; `src/reference-fidelity.css` supplies the multi-viewport visual system. Studio and Voice are still offline demo experiences; this milestone is NOT a 35-screen full functional acceptance.
