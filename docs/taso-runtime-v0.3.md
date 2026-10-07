# Taso Runtime v0.3

## Goal

Run the public Taso Command Center UI and the private Taso Core as separate Coolify resources without exposing Core directly to the public internet.

## Topology

```text
Browser
  |
  | HTTPS
  v
Taso UI / nginx (public)
  |
  | /api/* + X-Taso-Gateway header
  | Coolify private Docker network
  v
Taso Core :3000 (private, alias: taso-core)
```

## Security boundary

- Taso Core should not receive a public domain.
- Core v1 routes require `TASO_GATEWAY_SECRET` in production.
- The browser never receives the gateway secret.
- nginx injects `X-Taso-Gateway` server-side.
- The same random secret must be configured on both the UI and Core Coolify resources.
- `/health` remains available for container health checks; `/v1/*` is gateway protected.
- Do not commit the gateway secret to GitHub.

## Coolify resource: taso-core

- Repository: `hasanmertproje/tasarlayalim-infra`
- Branch: `feature/taso-ui-ux-v1` until PR #9 is merged
- Build pack: Dockerfile
- Base directory: `/taso`
- Port: `3000`
- Public domain: none
- Network alias: `taso-core`
- Runtime environment: `TASO_GATEWAY_SECRET=<random secret>`

## Coolify resource: taso-command-center

- Base directory: `/taso-ui`
- Port: `80`
- Public domain: `https://taso.demo.tasarlayalim.com`
- Runtime environment:
  - `TASO_CORE_UPSTREAM=http://taso-core:3000`
  - `TASO_GATEWAY_SECRET=<same random secret>`

The UI image builds with `VITE_TASO_API_URL=/api`, so browser requests remain same-origin and do not require CORS.

## CI contract

CI must prove all of the following before merge:

1. Taso Core unit tests pass.
2. Taso Core image builds.
3. Taso UI builds and its image starts.
4. UI `/health` responds.
5. `/api/health` reaches Core through nginx.
6. `/api/v1/projects` succeeds through the gateway.
7. Direct unauthenticated access to Core `/v1/projects` is rejected.

## Persistence note

Current Taso Core registries are memory-backed. Project and mission persistence is a subsequent milestone and must be completed before Taso is treated as production state storage.
