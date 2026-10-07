# Tasarlayalım Infra — Agent Operating Policy

## Purpose

This repository defines the operating rules and bootstrap assets for the Tasarlayalım multi-project AI development server.

Primary goals:
- phone-first operation
- GitHub-centered development
- Docker/Coolify deployments
- isolated project environments
- CI/CD with test gates
- preview/demo deployments under `*.demo.tasarlayalim.com`
- minimum manual SSH work
- safe unattended automation where possible

## Current platform

- Ubuntu Server 24.04 LTS
- Docker + Coolify
- Coolify dashboard: `https://coolify.tasarlayalim.com`
- Demo wildcard: `https://*.demo.tasarlayalim.com`
- GitHub is the source of truth for application code

Do not assume production and development are the same environment.

## Risk levels

### READ
Allowed without approval:
- inspect repository files
- inspect CI status
- inspect application logs
- inspect build output
- inspect health status
- inspect resource usage
- analyze errors

### WRITE
Allowed without approval when limited to development, staging, preview, or a feature branch:
- create feature branches
- edit code and configuration
- fix syntax/lint/type-check errors
- install project dependencies
- run unit/integration tests
- run non-destructive development migrations
- build containers
- create preview deployments
- restart a development/preview service
- update documentation

All WRITE actions must remain project-scoped and must not expose secrets.

### HIGH IMPACT
Explicit user approval is required before any of the following:
- destructive production database migration
- production data deletion or bulk modification
- production rollback that can lose data
- secret/API key rotation
- production domain/DNS changes
- billing/payment/subscription changes
- firewall or root-access changes
- deleting a repository, database, volume, backup, or production service
- irreversible deployment
- granting broader credentials or permissions

If unsure whether an action is HIGH IMPACT, treat it as HIGH IMPACT.

## Git workflow

Default flow:

`feature branch -> CI -> pull request -> preview -> review -> merge -> production`

Rules:
- do not make uncontrolled production changes directly on `main`
- prefer small, reviewable commits
- keep unrelated changes out of the same branch
- never force-push `main`
- use a PR for normal infrastructure/application changes

## Secrets

Never commit:
- `.env`
- database passwords
- GitHub tokens
- Telegram bot tokens
- private SSH keys
- API keys
- Coolify secrets
- production credentials

Use GitHub Secrets, Coolify environment variables, or another encrypted secret store.

Do not print secrets to build logs or chat output.

## Project isolation

Each application should have, where applicable:
- a separate repository
- separate runtime/service group
- separate database and database user
- separate environment variables
- separate logs
- separate backup policy
- separate preview/staging environment
- explicit CPU/memory limits when resource contention becomes relevant

Production data must not be copied into development without masking/anonymization where required.

## Agent execution loop

For normal development work:
1. inspect repository and runbook
2. create/use a feature branch
3. make the smallest coherent change
4. install dependencies if required
5. run lint/static checks
6. run tests
7. run type-check if applicable
8. build
9. run migrations only in an allowed environment
10. run health/smoke checks
11. if a low-risk failure occurs, inspect logs, fix, and retry
12. create/update preview deployment
13. report exact results

Do not stop at the first ordinary build/test failure if it can be safely diagnosed and repaired.

## Definition of Done

A task must not be reported as complete unless all applicable checks pass:
- dependency installation
- lint/static analysis
- tests
- type-check
- build
- migration check when required
- healthcheck
- preview/demo availability when requested
- no known critical runtime error

If a check could not be executed, report it as **NOT RUN**, never as PASS.

## Resource awareness

This is currently a cost-conscious shared VPS. Avoid unnecessary heavy services, duplicate databases, permanent preview environments, and unbounded build caches.

Prefer:
- lightweight images
- multi-stage builds where useful
- automatic cleanup of temporary previews
- bounded logs
- off-server backups

When capacity becomes a real bottleneck, scale the VPS rather than weakening security or backup policy.

## Communication

User-facing status should be concise and operational. Prefer results such as:
- what changed
- what passed/failed
- preview URL
- commit/PR reference
- whether approval is required

Do not ask the user for terminal work that can reasonably be automated through GitHub, CI/CD, Coolify, or a safe script.