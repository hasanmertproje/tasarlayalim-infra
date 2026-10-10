# Taso Verification / Demo Lifecycle V28

Promotion is evidence-driven and never inferred from a green build alone.

States:
- PREVIEW: a candidate exists, but one or more demo verification gates are pending.
- VERIFIED_DEMO: core tests, CI, functional verification, browser QA, responsive QA and visual QA passed.
- PRODUCTION_READY: VERIFIED_DEMO plus auth/security, accessibility and production approval gates passed.
- BLOCKED: at least one blocking gate failed.

Required demo gates:
`core-tests`, `ci`, `functional`, `browser-qa`, `responsive`, `visual`.

Required production gates:
all demo gates plus `auth-security`, `accessibility`, `approval`.

`PRODUCTION_READY` means the candidate has passed the configured release gates. It does not perform a production deployment. Production deployment remains an explicit high-impact action and requires the existing approval/reauthentication policy.

The lifecycle evaluator never treats `not-configured` as passed. Unknown or unconfigured evidence therefore cannot silently promote a candidate.
