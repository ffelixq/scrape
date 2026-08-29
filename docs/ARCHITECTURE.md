# Architecture and scaling

## Investigation lifecycle

1. The API validates the research brief and creates an immutable investigation ID.
2. BullMQ places the job in Redis. In local demo mode, the processor runs in-process.
3. The Python orchestrator generates supporting and adversarial search queries.
4. Candidate URLs pass an SSRF check before a Daytona sandbox is created.
5. Playwright, BeautifulSoup, and PyMuPDF run inside that ephemeral sandbox. The sandbox receives no private credentials.
6. Extracted documents are hashed, canonicalized, clustered by origin, and scored as source records.
7. The selected primary LLM builds the supporting case while a Nosana-hosted model builds the opposing case.
8. The auditor reconciles both reports against the actual evidence bundle and may refuse a conclusion.
9. A deterministic layer calculates evidence strength, counts independent origins, and builds evidence edges.
10. PostgreSQL stores the normalized report and Redis caches the current projection. SSE pushes state changes to the browser.

## Data model

- `Investigation`: question, workflow state, verdict, report projection, and limitations.
- `Source`: provenance, publication/access dates, authority tier, reliability indicator, content hash, and independence group.
- `Claim`: atomic assertion, evidence status, strength, and rationale.
- `Evidence`: exact excerpt and location linking a claim to a source as support, opposition, or context.
- `Contradiction`: conflict explanation, reason class, resolution, and involved source IDs.
- `SecurityEvent`: prompt injection, file, content-limit, or network-policy event.

The JSON projection makes report reads fast; normalized rows support analytics, audits, and graph queries.

## Horizontal scaling

- API instances are stateless beyond best-effort in-memory fallback. Production runs must provide PostgreSQL and Redis.
- BullMQ separates request latency from research duration and retries transient failures with exponential backoff.
- Queue concurrency is four per API worker by default; the Python service adds a separate semaphore.
- Daytona sandboxes fan out per investigation and expire by TTL even if an orchestrator crashes.
- Source scraping is bounded to four parallel pages per sandbox and a configurable source maximum.
- SSE can move to Redis pub/sub when API replicas need cross-instance event delivery.
- Large installations should split the BullMQ worker from the API process and use autoscaling based on queue depth.

## Reliability decisions

- A failed cache never changes the verdict path; PostgreSQL is authoritative.
- A source cannot increase independence simply because another page repeats it.
- LLM output is schema-constrained, then validated again at the API boundary.
- Evidence strength is deterministic and inspectable. LLMs classify and explain; they do not assign a probability of truth.
- A timeout or missing source produces `UNVERIFIABLE`, never a guessed answer.
- Search providers are untrusted inputs. A result whose URL is unusable, and a query that fails
  outright, are both discarded; discovery aborts only when every query fails.
- Inference calls are retried a bounded number of times on transient provider failures, because a
  momentary overload would otherwise discard a sandbox and a completed scrape. Retries live in one
  place: provider SDK retries are disabled so the two policies cannot multiply.
