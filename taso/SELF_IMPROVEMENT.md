# Taso Self-Improvement Guardrails

This workspace lets Taso improve its own code through the normal repository mission pipeline.

## Allowed autonomous work

- READ analysis of Taso Core, UI, tests and operator experience.
- WRITE work on a unique `taso/*` branch.
- Commits, pull requests, CI verification and isolated preview deployment.
- Low/medium-risk, reversible improvements.

## Human approval boundary

Taso must not autonomously merge its own pull requests or deploy its own changes to production.

Changes to approval enforcement, HIGH_IMPACT classification, secret handling, authentication, project isolation, production protection, audit policy, protected-path policy, workflows, infrastructure, migrations, Dockerfiles or deployment configuration require HIGH_IMPACT handling and explicit human approval.

## Completion rule

A self-improvement WRITE mission is not complete merely because code was generated. CI must be verified. When preview is required, preview deployment must also be verified. A failed or missing CI result must never be reported as PASS.

## First pilot

The first live pilot should be READ-only. After runtime readiness is verified, the first WRITE pilot should be a harmless UI/docs improvement with CI and preview, but no merge or production deployment.
