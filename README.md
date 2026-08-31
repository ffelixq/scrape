# Proofline

> Don’t ask AI for an answer. Ask it to prove one.

Proofline is an evidence-first AI investigator for decisions where a plausible answer is not good enough. It searches live sources, extracts checkable claims, traces copied information to its origin, investigates contradictions, and runs an adversarial skeptic before issuing a verdict. `INCONCLUSIVE` and `UNVERIFIABLE` are valid successful outcomes.

The repository is fully runnable without credentials. Demo mode presents a complete illustrative investigation; add the keys in `.env` to switch on live research.

## What is included

- Premium React + Vite public site and investigation workspace
- Interactive claim → source evidence graph using React Flow
- Evidence-strength, source-quality, and contradiction visualizations
- Express API with Zod validation, secure headers, rate limits, SSE updates, and graceful shutdown
- PostgreSQL persistence with Prisma and normalized provenance records
- Redis caching and BullMQ research jobs with local fallback
- Python/FastAPI supporter → skeptic → auditor pipeline
- Daytona ephemeral sandbox adapter for Playwright, PDFs, downloads, and extraction
- Provider-neutral adversarial review using the selected LLM
- OpenAI Responses, Gemini, and Kimi provider adapters
- Prompt-injection detection, SSRF blocking, content limits, and typed trust boundaries
- Dockerfiles, local infrastructure, tests, CI, release containers, and contribution standards

## Architecture

```text
React / Vite
     │ POST + SSE
Express API ── Redis / BullMQ
     │              │
 PostgreSQL         ▼
               Python orchestrator
                 ├─ Search provider
                 ├─ Daytona sandbox
                 │    ├─ Playwright
                 │    ├─ BeautifulSoup
                 │    └─ PyMuPDF
                 ├─ Support agent (selected LLM)
                 ├─ Skeptic agent (selected LLM)
                 └─ Evidence auditor (selected LLM)
```

The application does not claim mathematical truth. Its score measures evidence strength: source quality, independence, breadth, directness, and recency. It is not a probability that a claim is true.

## Quick start

Prerequisites: Node.js 22+, Python 3.11+, Docker, and npm.

```bash
cp .env.example .env
npm install
docker compose up -d postgres redis
npm run db:generate
npm run db:migrate

python3 -m venv .venv
source .venv/bin/activate
pip install -e 'apps/agent[dev]'

npm run dev
```

Open `http://localhost:5173`. With `DEMO_MODE=true`, no external account or API key is needed.

## Turn on live investigations

1. Put your credentials into the root `.env`. Every supported variable is documented in `.env.example`.
2. Add `DAYTONA_API_KEY`, a search key (`TAVILY_API_KEY` or `SERPER_API_KEY`), and the key for your selected LLM provider.
3. Set `LLM_PROVIDER`, set `DEMO_MODE=false`, and restart the services.

The supporter, skeptic, and auditor all use the selected LLM provider. The supporter and skeptic are separate adversarial passes, but they are not independent model compute. Daytona remains mandatory: live web content and files are retrieved and processed only inside an ephemeral sandbox.

### LLM selection

Set `LLM_PROVIDER` to one of:

| Value    | Required configuration           | Role                            |
| -------- | -------------------------------- | ------------------------------- |
| `openai` | `OPENAI_API_KEY`, `OPENAI_MODEL` | Supporter, skeptic, and auditor |
| `gemini` | `GOOGLE_API_KEY`, `GEMINI_MODEL` | Supporter, skeptic, and auditor |
| `kimi`   | `KIMI_API_KEY`, `KIMI_MODEL`     | Supporter, skeptic, and auditor |

## Evidence outcomes

| Status           | Meaning                                                         |
| ---------------- | --------------------------------------------------------------- |
| `WELL_SUPPORTED` | Multiple strong, independent sources directly support the claim |
| `SUPPORTED`      | Credible evidence supports the claim, with some limitations     |
| `INCONCLUSIVE`   | Material evidence exists on both sides or important gaps remain |
| `CONTRADICTED`   | Better or newer evidence conflicts with the claim               |
| `LIKELY_FALSE`   | Strong opposing evidence outweighs the support                  |
| `UNVERIFIABLE`   | The available evidence cannot responsibly resolve the claim     |

## Security model

- URLs are resolved and rejected if they target loopback, link-local, private, reserved, or credential-bearing addresses.
- Daytona sandboxes are ephemeral, time-limited, domain-restricted, and explicitly deleted after export.
- Search and LLM keys are never sent into the sandbox. Only public URLs and fixed worker code cross that boundary.
- Web content is wrapped as untrusted evidence. Page instructions never enter a system or developer channel.
- Prompt-injection patterns are detected both in the sandbox and after extraction, then surfaced in the report.
- Responses cross a Pydantic → Zod typed boundary before persistence or display.
- File sizes, command times, total research duration, request bodies, concurrency, and request rates are bounded.

See [docs/SECURITY.md](docs/SECURITY.md) for the threat model and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for scaling details.

## Repository layout

```text
apps/web         React/Vite interface
apps/api         Express/Prisma API and queue worker
apps/agent       Python research and evidence orchestration
packages/contracts  Shared API schemas and types
docs             Architecture and security decisions
.github          CI/CD and contribution automation
```

## Quality checks

```bash
npm run build
npm test
npm run lint
npm run typecheck

source .venv/bin/activate
ruff check apps/agent
ruff format --check apps/agent
pytest apps/agent
```

## Production deployment

- Serve `apps/web/dist` from a CDN or static web host.
- Run `apps/api/Dockerfile` behind an HTTPS load balancer.
- Run `apps/agent/Dockerfile` as a private service reachable only by the API.
- Use managed PostgreSQL and Redis with TLS, backups, and private networking.
- Scale API instances horizontally. BullMQ provides durable fan-out; agent instances use bounded concurrency; Daytona provides per-investigation compute isolation.
- Keep `INTERNAL_AGENT_TOKEN`, database credentials, and API keys in the deployment secret manager—never in source control.

The GitHub release workflow builds and publishes versioned API, agent, and web images to GHCR from `main` and semver tags.

## Important limitation

Proofline is a research aid, not a substitute for licensed legal, accounting, financial, or compliance advice. Evidence status reflects the sources available to the investigation, not absolute truth.
