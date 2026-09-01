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

Python agent (the venv lives at the repo root as `.venv`; these work on Windows and POSIX alike):

```bash
npm run setup:agent          # creates .venv and installs apps/agent[dev]
npm run test:agent
npm run lint:agent
npm run format:agent:check   # or `npm run format:agent` to write
```

Single tests:

```bash
node scripts/venv-run.mjs --cwd apps/agent -m pytest -q tests/test_search.py
node scripts/venv-run.mjs --cwd apps/agent -m pytest -q -k "transient"
npm run test -w @proofline/api -- src/tests/app.test.ts
npm run test -w @proofline/web -- src/App.test.tsx
npm run build:sites && node --test sites/worker.test.mjs
```

### Gotchas that will waste your time

- **Prisma first.** `npm run typecheck` fails in `@proofline/api` with `TS2694: ... has no exported member 'InputJsonValue'` on a clean checkout. That is a missing generated client, not a code error — run `npm run db:generate`.
- **Never hardcode a venv path in an npm script.** `dev:agent`, `test:agent`, `lint:agent` and `format:agent*` go through `scripts/venv-run.mjs`, which resolves `.venv/Scripts` on Windows and `.venv/bin` elsewhere (honouring `VIRTUAL_ENV`) and spawns without a shell so `apps/agent[dev]` survives zsh globbing. The team runs both Windows and macOS; a `.venv/bin/...` literal breaks one of them.
- **`.gitattributes` pins `eol=lf`.** Both platforms check out LF, so `prettier --check` and `ruff format --check` agree. Do not commit CRLF.
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

`messages` is the one field the agent never writes: the follow-up conversation is owned by the API.
It is still modelled on both sides so the two descriptions stay the same payload, and it carries a
Zod default so an agent response that omits it parses cleanly. `repository.complete()` merges the
existing conversation back in, so a research result can never erase turns already on the record.

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

### Search discovery

`research/search.py` runs Tavily and Serper as two channels, not a primary and a spare. Each is a
`SearchProviderClient` subclass owning two things: the queries it contributes (`plan`) and how it
calls its API (`run`). Both providers run on every investigation, each with its own phrasing of the
question and each covering SUPPORT and OPPOSE, so the two channels look in different places rather
than asking the same question twice. Query volume is unchanged from the old failover design — 4
queries per provider instead of 8 to one — so enabling the second channel did not double search
spend.

`SearchClient.discover` returns a `Discovery`: the merged candidates plus a `SearchCoverage`
record. `_merge` collapses candidates by canonical URL and unions the `providers` list, so a page
both providers return is one candidate carrying `["tavily", "serper"]`. **That list is discovery
metadata and must never be read as corroboration** — two providers agreeing is one source, and
independence is decided only by `build_provenance` from the retrieved documents. `SEARCH_PROVIDER`
now decides only which channel leads the merged list, and so what survives the
`max_sources_per_investigation` cut. One provider failing is survivable because the other already
ran; discovery raises only when every query across both fails.

`SearchCoverage` crosses the typed boundary like everything else, so `models.py` and
`packages/contracts/src/index.ts` must change together. It carries a default on both sides because
investigations stored before the field existed must still parse. It counts discovery only —
`metrics.sourcesChecked` counts what the sandbox retrieved and `metrics.independentSources` counts
distinct origins — and `components/investigation/DiscoveryCoverage.tsx` renders the three as a
funnel precisely so result rows are never presentable as a source count.

### Adversarial roles

The supporter and skeptic run as separate concurrent calls through the user-selected provider first,
then the remaining configured fallbacks; the auditor runs after both complete. All three roles use
the same per-investigation order, so do not describe the skeptic as independently hosted model
compute. Source independence is established separately by the deterministic provenance layer.

### Follow-up analysis

`POST /api/investigations/:id/messages` continues an investigation that is already finished. It is
not a research run: no search, no sandbox, no web access. Live mode calls the agent's `/follow-up`
(`apps/agent/app/followup.py`), which renders the stored record — verdict, claims, validated
evidence, sources, provenance groups, contradictions, limitations, prior turns — and answers over
it. Demo mode never reaches a provider and answers deterministically from the same record in
`apps/api/src/services/follow-up.ts`.

Two rules keep it honest and belong with the evidence gate: stored excerpts re-enter the model
wrapped in `<untrusted_evidence>`, and `enforce_citations` drops any cited source id that is not in
that investigation. The user turn is stored before the answer is requested, so a provider failure
leaves a visible question and a turn marked `failed` rather than a dropped exchange.

### The web workspace

`apps/web/src/lib/workspace-store.ts` is the single owner of workspace state: open tabs (ids only),
the active tab, fetched investigations, history, and one live SSE subscription per running
investigation. Subscriptions are keyed by id and independent of which tab is in front, which is why
switching tabs never restarts research. It is a vanilla store read through `useSyncExternalStore`,
deliberately not a context provider — `react-refresh/only-export-components` is an error under
`--max-warnings 0`.

Derivations live beside it and are pure and tested: `lib/investigation.ts` builds the self-doubt
stages and evidence summary from a stored investigation, and `lib/graph-model.ts` builds the
evidence graph as a tidy tree (verdict -> claim -> side -> evidence -> source -> origin). The
self-doubt stages read the orchestrator's own prose to detect a gate downgrade, so changing that
message in `orchestrator.py` means changing `GATE_MARKER` too.

### Trust boundaries

Scraped pages, PDFs and downloaded files are hostile input. Retrieval happens only inside an
ephemeral Daytona sandbox that receives no credentials; extracted text is wrapped in
`<untrusted_evidence>` tags (`research/security.py`) and never enters a system channel. Live failure
detail returned from `POST /investigate` comes from a closed vocabulary in
`main.py:classify_live_failure`, because upstream error text can contain sandbox or page content.
`docs/SECURITY.md` is the threat model; keep it in sync when you touch these paths.

## Current state

The work below is committed on `jayden-branch`. The first session hardened live evidence investigations
(continuing Codex's `0cd369b`); the second rebuilt the interface around a persistent workspace.

### Interface rebuild (this session)

- `App.tsx` now routes between the marketing landing page and a lazy `WorkspaceShell`. The old
  `Workspace.tsx` and `ResearchProgress.tsx` were replaced by `components/workspace/*` (shell,
  history sidebar, tab strip) and `components/investigation/*` (document view, self-doubt timeline,
  evidence summary, live research status, conversation).
- New API surface: `GET /api/investigations` (history summaries), `DELETE /api/investigations/:id`,
  and `POST /api/investigations/:id/messages` (follow-up).
- The stylesheet keeps the landing rules and replaces everything from the old report styles with a
  workspace design system (tokens, shell, document, graph, conversation, responsive, print).
- The live status panel reports only counts the run has actually produced; unknown values say
  `Pending` rather than showing a placeholder number.

### Fixed in the earlier session

| Problem                                                                                                                                                                                                      | Fix                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CI red on `main` — `prettier --check` failed on `App.test.tsx`, `ruff format --check` on three agent files                                                                                                   | Reformatted; cosmetic only                                                                                                                                   |
| **Every live investigation crashed at search.** Tavily returns opaque Google redirect tokens instead of URLs (reproducibly 4 of 8 results on one query); one raised a `ValidationError` that aborted the run | `research/search.py` discards unusable rows and tolerates individual query failures, aborting only when every query fails. Covered by `tests/test_search.py` |
| A single transient provider 503 discarded a run that had already spent a Daytona sandbox and a full scrape                                                                                                   | `StructuredLLM.parse` retries transient failures 3x with backoff; concrete providers implement `_parse_once`. Covered by `tests/test_providers.py`           |
| SDK retries multiplied against the application retry policy                                                                                                                                                  | `max_retries=0` on the OpenAI-compatible clients, so there is one observable retry policy                                                                    |
| `RESEARCH_TIMEOUT_SECONDS=300` could not fit a real run (measured ~4s search, ~35s sandbox, and slow inference stages)                                                                                       | Raised to 900 in `.env.example` and `.env`, matching `DAYTONA_SANDBOX_TTL_MINUTES=15`                                                                        |
| Agent failures reported only `ClientError`, which is unactionable                                                                                                                                            | `classify_live_failure` reports quota vs. unavailability from a closed vocabulary                                                                            |

### Known-broken, still to fix

1. ~~**An unreachable Redis hangs the API forever.**~~ Fixed. `queue.add()` is now bounded by
   `RESEARCH_ENQUEUE_TIMEOUT_MS` (5s) and falls back to the same in-process processor the no-Redis
   path uses, so `POST /api/investigations` answers either way. Because a timed-out enqueue can
   still reach Redis later, `investigationRepository.claim()` moves `QUEUED -> RESEARCHING` as the
   single owner of a run: a job that lands afterwards finds the record past `QUEUED` and drops it
   rather than researching the question twice. A BullMQ redelivery of a job that already claimed
   its investigation is the one caller that bypasses the claim, so the retry policy still works.
   Two smaller repairs came with it — the fallback previously built a fake `Job` with no `opts`,
   so the `job.opts.attempts` read threw inside the catch and left the investigation stuck in
   `RESEARCHING` instead of `FAILED`; and the queue connection had no `error` listener, which for
   an EventEmitter is a thrown error. Reconnects now back off to 30s and one throttled warning is
   logged. Re-verified against a dead Redis: 202 in 5.5s, then 0.4s for later requests once the
   connection is known to be down, and the run reaches a terminal state. Covered by
   `apps/api/src/tests/research-queue.test.ts`.
2. **A full live run has never completed end-to-end.** The Gemini free-tier key hit its daily quota
   and returned 503 under load. Verifying the remaining pipeline needs an LLM key with sufficient
   quota for all three analysis calls. The live `/follow-up` path is likewise unverified against a
   real provider; its logic is covered by `tests/test_followup.py` with a stub model.
3. ~~`INTERNAL_AGENT_TOKEN` in `.env` is still the literal placeholder.~~ Fixed: `.env` now holds a
   generated 256-bit token. The API and the agent both read it from the root `.env`, so the two
   sides stay in step; `.env.example` keeps the placeholder as documentation.
4. ~~`tests/test_usage.py` fails locally on Windows with `ZoneInfoNotFoundError`.~~ Fixed: `tzdata`
   is now a runtime dependency of the agent (`pyproject.toml` and `requirements.txt`), because
   Windows ships no system tz database and `usage.py` resolves `ZoneInfo` at runtime. Existing
   environments need one `pip install tzdata`. All 47 agent tests pass on Windows.
