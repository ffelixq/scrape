# Proofline

> Don’t ask AI for an answer. Ask it to prove one.

Proofline is an evidence-first AI investigator for decisions where a plausible answer is not good enough. It searches live sources, extracts checkable claims, traces copied information to its origin, investigates contradictions, and runs an adversarial skeptic before issuing a verdict. `INCONCLUSIVE` and `UNVERIFIABLE` are valid successful outcomes.

The repository is fully runnable without credentials. Demo mode presents a complete illustrative investigation; add the keys in `.env` to switch on live research.

## What is included

- Premium React + Vite public site and a persistent investigation workspace with history and tabs
- A self-doubt panel that shows how the conclusion was attacked, stage by stage
- Interactive verdict → claim → evidence → source → origin graph using React Flow
- Follow-up conversation over a finished investigation, grounded in its own record
- Evidence-strength, source-quality, and contradiction visualizations
- Express API with Zod validation, secure headers, rate limits, SSE updates, and graceful shutdown
- PostgreSQL persistence with Prisma and normalized provenance records
- Redis caching and BullMQ research jobs with local fallback
- Python/FastAPI supporter → skeptic → auditor pipeline
- Daytona ephemeral sandbox adapter for Playwright, PDFs, downloads, and extraction
- Per-investigation model and search selection with automatic provider failover
- Durable provider usage dashboard and a hard DeepSeek daily token budget
- Gemini, Groq, and DeepSeek provider adapters
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
                 ├─ Support agent (LLM failover chain)
                 ├─ Skeptic agent (LLM failover chain)
                 └─ Evidence auditor (LLM failover chain)
```

The application does not claim mathematical truth. Its score measures evidence strength: source quality, independence, breadth, directness, and recency. It is not a probability that a claim is true.

## Quick start

Prerequisites: Node.js 22+, Python 3.11+, Docker, and npm. macOS, Linux and Windows all work; the
npm scripts resolve the Python environment for the platform they run on.

```bash
cp .env.example .env      # Windows PowerShell: copy .env.example .env
npm install
docker compose up -d postgres redis
npm run db:generate
npm run db:migrate
npm run setup:agent       # creates .venv at the repository root and installs apps/agent[dev]
npm run dev
```

Open `http://localhost:5173`. With `DEMO_MODE=true`, no external account or API key is needed.

`npm run setup:agent` is the only step that differs by machine, and it handles the difference
itself: it finds `python3`, `python` or the `py` launcher, creates `.venv`, and installs the agent
in editable mode. To use an environment somewhere else, set `VIRTUAL_ENV` before running the npm
scripts. Every Python script — `dev:agent`, `test:agent`, `lint:agent`, `format:agent` — goes
through `scripts/venv-run.mjs`, which picks `.venv/Scripts` on Windows and `.venv/bin` elsewhere.

## The investigation workspace

An investigation is a place you return to, not a single response.

- **History and tabs.** Every investigation is kept on the record. Several can be open at once; a
  tab keeps its own live research stream, so switching between them never restarts a run. Closing a
  tab leaves the investigation in history until it is explicitly deleted.
- **Designed to doubt itself.** A seven-stage timeline — initial thesis, challenge, opposing
  evidence, contradictions, provenance, re-evaluation, verdict — reports what each stage actually
  found and whether the conclusion got stronger or weaker. Stages are derived from recorded
  evidence, so a stage that found nothing says so.
- **Evidence summary before the graph.** Counts and strength meters come first; the graph is for
  readers who want to trace a chain.
- **Evidence graph.** A hierarchy rather than a web, in Simplified and Detailed views. Selecting a
  node isolates its chain and dims the rest, and the inspector shows source metadata, publication
  date, tier, reliability, independence and origin group.
- **Follow-up conversation.** Ask “which sources are the strongest?”, “only use primary sources”, or
  “try to disprove your conclusion” without repeating the question. Follow-ups reason over the
  stored record and are labelled `FOLLOW-UP ANALYSIS`, distinct from the `NEW RESEARCH` turn that
  opens the thread.

Investigation state lives in the API, so history, verdicts, sources and conversation survive a
refresh, a closed tab, or a return from history.

## Turn on live investigations

1. Put your credentials into the root `.env`. Every supported variable is documented in `.env.example`.
2. Add `DAYTONA_API_KEY`, at least one search key, and at least one LLM key. Tavily is the default search provider; configure both `TAVILY_API_KEY` and `SERPER_API_KEY` to fall back automatically when either provider errors, exhausts its quota, or returns no usable results.
3. Set `DEMO_MODE=false` and restart the services.

The supporter, skeptic, and auditor each use the configured LLM failover chain. The supporter and skeptic are separate adversarial passes, but they are not independent model compute. Daytona remains mandatory: live web content and files are retrieved and processed only inside an ephemeral sandbox.

### Provider selection and failover

The website defaults to Gemini and Tavily. Each investigation can select a different primary LLM
and search provider. The selected provider runs first; configured alternatives remain available as
fallbacks, so choosing DeepSeek produces `DeepSeek → Gemini → Groq`, for example.

| Provider | Configuration                        | Default model         |
| -------- | ------------------------------------ | --------------------- |
| Gemini   | `GOOGLE_API_KEY`, `GEMINI_MODEL`     | `gemini-3.7-flash`    |
| Groq     | `GROQ_API_KEY`, `GROQ_MODEL`         | `openai/gpt-oss-120b` |
| DeepSeek | `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL` | `deepseek-v4-flash`   |

Providers without a key are skipped. A provider error, rate-limit exhaustion, or invalid structured response advances the current inference call to the next configured provider.

### Usage and budget controls

- Provider usage is stored in `USAGE_DB_PATH` and survives Docker restarts through the
  `proofline_usage` volume.
- DeepSeek uses a transactional pre-flight reservation. New calls are blocked before they can cross
  `DEEPSEEK_DAILY_TOKEN_LIMIT` (500,000 by default), resetting at midnight in `USAGE_TIMEZONE`
  (`Asia/Singapore` by default).
- LLM responses are counted using provider-reported input/output/total token metadata. Search calls
  record credits only after a successful provider response.
- Tavily's bar uses its account `/usage` response. Gemini, Groq, and Serper expose different levels
  of account quota data, so the UI explicitly labels app-local counters instead of presenting them
  as whole-account balances.
- API keys stay server-side. The browser receives provider names, status, counters, and reset times—
  never credentials or upstream error bodies.

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

npm run lint:agent
npm run format:agent:check
npm run test:agent
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
