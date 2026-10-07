# Tasarlayalım Infra — Project Runbook

## 1. Scope

This repository bootstraps and documents the shared development infrastructure used for multiple Tasarlayalım projects.

It is not an application repository. Application code should live in separate repositories.

## 2. Current infrastructure

- Server OS: Ubuntu Server 24.04 LTS
- Orchestrator/PaaS: Coolify
- Coolify URL: `https://coolify.tasarlayalim.com`
- Demo wildcard: `https://*.demo.tasarlayalim.com`
- Source control: GitHub
- Primary deployment model: GitHub -> CI -> Coolify -> Docker

## 3. Environment separation

Use three logical environments when a project warrants them:

- Development
- Preview/Staging
- Production

Rules:
- never test against production data by default
- use separate secrets per environment
- use separate databases/users per application where practical
- use preview/demo domains for user review

## 4. Standard repository contract for application repos

Each application repository should gradually converge on:

```text
AGENTS.md
PROJECT_RUNBOOK.md
Dockerfile
docker-compose.yml        # when multi-service is needed
.env.example
.github/workflows/ci.yml
scripts/healthcheck.sh
scripts/smoke-test.sh
```

Optional, depending on stack:
- `scripts/backup.sh`
- `scripts/migrate.sh`
- `scripts/restore-test.sh`
- `compose.preview.yml`
- `compose.production.yml`

## 5. CI quality gates

A deployment to production must be blocked when applicable quality checks fail.

Generic gates:
- dependency install
- lint/static analysis
- unit tests
- integration tests when relevant
- type-check when relevant
- build
- migration validation when relevant
- smoke/health check

### Laravel/PHP baseline

Typical checks:
- `composer install --no-interaction --prefer-dist`
- PHP syntax/static checks
- PHPUnit/Pest
- database migration test against non-production DB
- `npm ci` or `pnpm install --frozen-lockfile`
- frontend type-check/build
- smoke test

### Node/TypeScript baseline

Typical checks:
- `npm ci` / `pnpm install --frozen-lockfile`
- lint
- type-check
- tests
- build

### Python baseline

Typical checks:
- dependency install using `uv` or `pip`
- lint
- type-check when configured
- `pytest`

## 6. Preview/demo deployment convention

Customer-facing demos should use the wildcard domain:

`*.demo.tasarlayalim.com`

Examples:
- `otel.demo.tasarlayalim.com`
- `growthos.demo.tasarlayalim.com`
- `m5.mariacicek.demo.tasarlayalim.com`
- `pr42.growthos.demo.tasarlayalim.com`

Preview environments must not use production customer data by default.

Temporary previews should be removable without affecting production.

## 7. Deployment flow

Default:

```text
feature branch
  -> CI
  -> pull request
  -> preview/demo deployment
  -> user/reviewer approval
  -> merge to main
  -> production deployment
```

Small internal projects may simplify this flow, but production safety gates still apply.

## 8. Notification target

Planned notifications:
- deployment started
- CI failed
- auto-fix/retry in progress
- preview ready
- deployment successful
- backup failed
- server/resource warning

Preferred channel: Telegram bot.

Secrets for notifications must not be committed to this repository.

## 9. Backup policy baseline

For production applications:
- database backup daily
- uploads/storage backup when applicable
- off-server destination required
- finite retention policy
- periodic restore test

An on-server-only backup is not considered sufficient.

Potential destinations:
- S3-compatible storage
- Backblaze B2
- Cloudflare R2
- secondary VPS/storage service

## 10. Security baseline

- SSH keys preferred over passwords
- root SSH login should be disabled after a verified non-root admin path exists
- firewall enabled
- minimum public ports
- fail2ban or equivalent
- databases not exposed publicly
- secrets stored outside Git
- no unrestricted Docker socket access for untrusted agents
- self-hosted CI runner only for trusted repositories and with least privilege

## 11. Resource policy

This infrastructure starts small and should scale when actual bottlenecks appear.

On a shared VPS:
- avoid permanent unused preview stacks
- avoid unlimited Docker build cache growth
- monitor disk usage
- set CPU/memory limits for noisy projects when needed
- keep logs bounded

Never trade away backups or security merely to fit within a small VPS.

## 12. High-impact approvals

Explicit approval is required before:
- destructive production migrations
- production deletion
- irreversible rollback
- secret rotation
- DNS/domain change
- firewall/root-access change
- billing changes
- deletion of production volume/database/repository

## 13. Recovery principles

Every production project should eventually document:
- latest known-good deployment
- rollback procedure
- database restore procedure
- application storage restore procedure
- dependency on external services
- healthcheck endpoint or command

A backup without a tested restore path is incomplete.

## 14. Near-term bootstrap plan

### Phase 1
- VPS baseline
- Coolify
- domain + SSL
- GitHub source integration
- this infra repository

### Phase 2
- CI baseline
- test application
- demo wildcard deployment

### Phase 3
- reusable project templates
- Telegram notifications
- backup automation
- monitoring

### Phase 4
- agent-safe automation
- retry loops for low-risk failures
- approval gates for high-impact operations

## 15. Definition of Done for infrastructure changes

Before merging an infrastructure change:
- configuration is syntactically valid
- documentation updated
- no secret included in diff
- change is reversible or rollback documented
- impact on existing projects considered
- high-impact change has explicit user approval
