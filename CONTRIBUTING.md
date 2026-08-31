# Contributing

## Branch strategy

`main` is always releasable and protected. Create short-lived branches from the latest `main`:

- `feat/evidence-export`
- `fix/duplicate-source-clustering`
- `security/redirect-ssrf-check`
- `docs/daytona-snapshot`
- `chore/dependency-updates`

Open a pull request, require green CI and one review, then squash merge. Release tags use semantic versioning (`v1.2.0`). Avoid long-running environment branches; deployments come from tagged or main commits.

## Commit messages

Use Conventional Commits with an optional scope:

```text
feat(graph): show derivative source clusters
fix(agent): revalidate redirect targets before extraction
security(api): bound SSE connections per tenant
test(provenance): cover copied press-release detection
docs(setup): explain live provider configuration
```

Keep each commit independently buildable. Separate refactors from behavior changes. Never commit `.env`, credentials, downloaded research content, or production evidence.

## Pull-request checklist

- Describe the user-visible outcome and the failure mode being addressed.
- Add or update tests for changed behavior.
- Run build, tests, lint, type checks, Ruff, and Pytest.
- Document new environment variables in both `.env.example` and the README.
- Treat changes to source weighting, evidence status, prompt controls, sandbox policy, or verdict logic as high risk and request security review.
