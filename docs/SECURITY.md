# Security and trust boundaries

## Threat model

Proofline assumes every website, redirect, PDF, archive, document, and extracted string is hostile. Threats include prompt injection, SSRF, drive-by downloads, oversized files, malicious markup, credential exfiltration, copied misinformation, and denial of service.

## Boundaries

### Public API

- Helmet security headers, explicit CORS, JSON-only 64 KB request bodies, rate limiting, Zod schemas, and opaque request IDs.
- The research agent is protected by a constant-time bearer-token comparison and is not intended to be public.
- Production traffic must use TLS and private networking between the API, agent, database, and Redis.
- Live failures are reported from a closed vocabulary. Upstream failure text can carry sandbox or
  page content, so it is logged and never returned to the caller; only the class of failure — an
  exhausted provider quota, an unavailable dependency — crosses the boundary.

### Daytona sandbox

- Ephemeral sandbox with an absolute TTL and deletion in `finally`.
- Domain allow-list combines approved research hosts and fixed package/browser hosts. For stricter production, build a Daytona snapshot and remove package domains.
- No search, database, Redis, or LLM credentials enter the sandbox.
- Fixed code is base64-transferred; URLs are validated before inclusion and encoded as data.
- Browser and PDF output is limited by bytes and characters before export.

### Model context

- Evidence appears only inside `<untrusted_evidence>` tags beneath a fixed control preamble.
- Page content cannot create tools, change roles, request secrets, or alter system instructions.
- Prompt-injection detection runs on both sides of the sandbox boundary.
- The supporter and skeptic can cite only URLs supplied in the evidence bundle.
- Pydantic structured output rejects missing or invented schema fields.

### Follow-up conversation

- A follow-up reasons over an investigation that is already on the record. It performs no search,
  opens no sandbox, and reaches no website.
- The stored record still contains excerpts scraped from hostile pages, so every excerpt is
  re-wrapped in `<untrusted_evidence>` before it re-enters a model, exactly as during research.
- Answers may cite only source ids present in that investigation; citations to anything else are
  dropped and the removal is disclosed in the answer's limitations.
- The conversation is owned by the API. The research agent never writes it, and a completed
  research result can never overwrite turns already on the record.

## Production hardening checklist

- Build a versioned Daytona snapshot with pinned Playwright, Chromium, BeautifulSoup, and PyMuPDF packages.
- Store all secrets in the platform secret manager and rotate `INTERNAL_AGENT_TOKEN` regularly.
- Restrict egress from the API and agent services; only the sandbox should access arbitrary public websites.
- Add malware scanning for any file type beyond HTML and PDF before enabling it.
- Encrypt PostgreSQL and Redis traffic and enable point-in-time recovery.
- Send security events and sandbox lifecycle telemetry to a tamper-resistant audit sink.
- Require authentication, tenant isolation, per-user quotas, and row-level access before accepting sensitive customer data.
- Commission an independent penetration test before production use in regulated workflows.

## Reporting security issues

Do not open public issues for vulnerabilities. Contact the repository owner privately with reproduction steps, impact, and the affected version.
