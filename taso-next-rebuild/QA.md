# TASO NEXT REBUILD M1 — QA Evidence

## Executed locally
- TypeScript compiler `transpileModule` syntax check for App.tsx, domain.ts, main.tsx: PASS (not a semantic typecheck).
- `scripts/build_offline.py`: PASS (single-file Android-oriented offline HTML).
- Chromium/Playwright: **16/16** checks PASS (see `qa/results.json`). Viewports: 320, 360, 390, 430, 768, 1024, 1440, 1920px initial overview; 390/1440px Hub task-to-approval flow, Studio text edit, Voice demo machine and exhaustive 19+16 route renders.
- Screenshots stored for overview, hub, Studio, Voice at 390px and 1440px.

## Caught/fixed during QA
- React 16.0 UMD cannot render Fragment syntax in offline compiler: removed two fragments.
- Admin menu originally had 20 items rather than 19; mapped to exact 19 + 16 inventory.
- Test's Studio target originally ambiguous due duplicate matching text; narrowed selector to preview heading.

## Not verified
- `npm install`, full `tsc --noEmit` semantic typecheck, Vite production build, Vite single-file build, lockfile: NOT RUN (network/package unavailable).
- Physical Android Chrome opening the HTML: NOT RUN.
- Whole application 35-route responsive screenshots at all eight viewport widths: NOT RUN (only overview all widths and four key screens two widths).
- Automated WCAG checks, screen reader, semantic keyboard audit, screenshot diff, full backend integration: NOT RUN.
- Backend production readiness: N/A — purposely isolated demo.