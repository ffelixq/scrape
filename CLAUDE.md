# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Run from the repository root:

```bash
npm install
npm run db:generate      # REQUIRED before typecheck/build — see gotchas
npm run dev              # web :5173, API :4000, agent :8001
npm run build
npm run typecheck
npm run lint
npm test                 # API + web + sites
npm run format:check     # or `npm run format` to write
```

Python agent (create the venv at the repo root as `.venv`):

```bash
python -m venv .venv
.venv/Scripts/python.exe -m pip install -e "apps/agent[dev]"   # Windows
.venv/Scripts/ruff.exe format --check apps/agent
.venv/Scripts/ruff.exe check apps/agent
.venv/Scripts/python.exe -m pytest -q apps/agent
```

Single tests:

```bash
.venv/Scripts/python.exe -m pytest -q apps/agent/tests/test_search.py
.venv/Scripts/python.exe -m pytest -q apps/agent -k "transient"
npm run test -w @proofline/api -- src/tests/app.test.ts
npm run test -w @proofline/web -- src/App.test.tsx
npm run build:sites && node --test sites/worker.test.mjs
```

### Gotchas that will waste your time

- **Prisma first.** `npm run typecheck` fails in `@proofline/api` with `TS2694: ... has no exported member 'InputJsonValue'` on a clean checkout. That is a missing generated client, not a code error — run `npm run db:generate`.
- **The root agent scripts are POSIX-only.** `npm run test:agent` and `npm run dev:agent` hardcode `.venv/bin/...` and do not work on Windows. Invoke `.venv/Scripts/python.exe` directly, as above.
- **Ruff is unpinned above `>=0.12.11`.** CI installs the latest, so format with whatever ruff your venv has; an older ruff will disagree and turn CI red.
- **`npm test` builds the web bundle** (via `test:sites`), so it takes ~2 minutes.

## Architecture

Four workspaces: `apps/web` (React/Vite), `apps/api` (Express/Prisma/BullMQ), `apps/agent`
(Python/FastAPI research orchestration), `packages/contracts` (Zod schemas shared by web and API).

### The typed boundary

The agent's Pydantic `InvestigationResult` (`apps/agent/app/models.py`) and the API's Zod
`investigationSchema` (`packages/contracts/src/index.ts`) describe the same payload and must be
changed together. `agent-client.ts` re-validates the agent's response through the Zod schema before
anything is persisted or displayed, so a field added on one side and not the other fails at runtime,
not at compile time. Agent field names are deliberately camelCase to match the contract.

### Demo mode vs live mode

`DEMO_MODE` is the main switch and is read independently on both sides (`apps/api/src/config.ts`,
`apps/agent/app/config.py`). The API forces `demoMode` on when `NODE_ENV=test`, which is why the
whole JS test suite runs without credentials or infrastructure. In demo mode the API answers
`POST /api/investigations` synchronously from `services/demo.ts` and never reaches the agent.

Live mode degrades by design: no `REDIS_URL` means jobs run in-process via `setImmediate` instead of
BullMQ, no `DATABASE_URL` means Prisma is skipped and state lives in an in-memory `Map`, and the
Redis cache is treated as an optimization that can fail without changing a verdict.

### The deterministic evidence gate

This is the core product invariant and the reason `apps/agent/app/orchestrator.py` is the most
important file in the repo. Models propose; deterministic code decides:

- `_best_excerpt` will not emit an evidence record unless a verbatim excerpt is actually anchored in
  the scraped document _and_ contains every number the claim asserts. A model citation that fails
  this is silently dropped.
- `_gated_claim_status` downgrades a claim's status when the surviving evidence lacks supporting
  records, breadth across independence groups, or a primary/authoritative source.
- The final verdict is downgraded again against `evidenceStrength`, primary-source count, and
  independent-origin count, and the downgrade is disclosed in `limitations`.

`build_provenance` (`research/provenance.py`) clusters near-duplicate documents into one
`independenceGroup`, so ten pages copying one press release count once. When changing any of this,
treat it as high-risk per CONTRIBUTING.md and add regression coverage in `tests/test_evidence_gates.py`.

### Adversarial roles and the Nosana fallback

Supporter and auditor run on `LLM_PROVIDER`; the skeptic is supposed to run on the Nosana-hosted
vLLM endpoint so the adversarial review is independent compute. If Nosana fails, the orchestrator
falls back to the primary provider within a 25s budget and records a `limitations` entry saying the
review was not independent. That disclosure is load-bearing for the product's honesty claim — do not
remove it, and do not let the fallback become silent.

### Trust boundaries

Scraped pages, PDFs and downloaded files are hostile input. Retrieval happens only inside an
ephemeral Daytona sandbox that receives no credentials; extracted text is wrapped in
`<untrusted_evidence>` tags (`research/security.py`) and never enters a system channel. Live failure
detail returned from `POST /investigate` comes from a closed vocabulary in
`main.py:classify_live_failure`, because upstream error text can contain sandbox or page content.
`docs/SECURITY.md` is the threat model; keep it in sync when you touch these paths.

## Current state (uncommitted work in progress)

Continuing Codex's `0cd369b feat: harden live evidence investigations`. Everything below is in the
working tree and **not committed**. Full gate is green: 24 pytest, 3 API + 1 web + 3 sites tests,
typecheck, lint, prettier, ruff.

### Fixed this session

| Problem                                                                                                                                                                                                      | Fix                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CI red on `main` — `prettier --check` failed on `App.test.tsx`, `ruff format --check` on three agent files                                                                                                   | Reformatted; cosmetic only                                                                                                                                   |
| **Every live investigation crashed at search.** Tavily returns opaque Google redirect tokens instead of URLs (reproducibly 4 of 8 results on one query); one raised a `ValidationError` that aborted the run | `research/search.py` discards unusable rows and tolerates individual query failures, aborting only when every query fails. Covered by `tests/test_search.py` |
| A single transient provider 503 discarded a run that had already spent a Daytona sandbox and a full scrape                                                                                                   | `StructuredLLM.parse` retries transient failures 3× with backoff; concrete providers implement `_parse_once`. Covered by `tests/test_providers.py`           |
| SDK retries multiplied against ours — 9 Nosana calls observed inside a 25s budget                                                                                                                            | `max_retries=0` on the OpenAI-compatible clients, so there is one observable retry policy                                                                    |
| `RESEARCH_TIMEOUT_SECONDS=300` could not fit a real run (measured ~4s search, ~35s sandbox, ~140s per inference, three sequential)                                                                           | Raised to 900 in `.env.example` and `.env`, matching `DAYTONA_SANDBOX_TTL_MINUTES=15`                                                                        |
| Nosana-fallback disclosure hardcoded "Gemini" regardless of `LLM_PROVIDER`                                                                                                                                   | Names the configured provider                                                                                                                                |
| Agent failures reported only `ClientError`, which is unactionable                                                                                                                                            | `classify_live_failure` reports quota vs. unavailability from a closed vocabulary                                                                            |

### Known-broken, still to fix

1. **An unreachable Redis hangs the API forever.** Verified experimentally: with `DEMO_MODE=false`,
   `REDIS_URL` set and Redis down, `queue.add()` in `apps/api/src/services/research-queue.ts` was
   still pending after 12s and never settles, because ioredis is constructed with
   `maxRetriesPerRequest: null` and buffers commands indefinitely. `POST /api/investigations` never
   returns. Intended fix: bound the enqueue and fall back to the in-process processor that the
   no-Redis path already uses, plus guard the processor against re-processing an investigation that
   is already `COMPLETED`/`FAILED` if the timed-out enqueue later lands. **Not applied.**
2. **The Nosana skeptic cannot work even when the job is healthy.** `nosana/proofline-vllm.json` sets
   `--max-model-len 2176`, but `_evidence_bundle` builds up to 140,000 characters — roughly 16× the
   window. The skeptic would fail and silently fall back, breaking the README's claim that the
   adversarial skeptic runs on Nosana in every live run. Two legitimate fixes with different
   trade-offs — trim the bundle client-side (the skeptic then sees less evidence than the supporter)
   or raise `--max-model-len` (may not fit VRAM on an arbitrary market node, returning to a 503).
   **Needs a decision before implementing.**
3. **A full live run has never completed end-to-end.** Best result reached: search → sandbox →
   supporter succeeded, then the skeptic failed. The auditor stage has never executed. The blockers
   are environmental, not code: the Nosana endpoint returns `503 Service Initializing` (dead job),
   and the Gemini free-tier key hit its 20-requests/day quota on `gemini-3.6-flash` and returned 503
   under load on `gemini-3.5-flash`. Verifying the remaining pipeline needs a paid LLM key.
4. `INTERNAL_AGENT_TOKEN` in `.env` is still the literal placeholder `replace-with-a-long-random-string`.
