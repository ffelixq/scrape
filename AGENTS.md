# Repository Guidelines

## Project Structure & Module Organization

- `apps/web/` contains the React/Vite interface, including investigation reports and evidence graphs.
- `apps/api/` contains the Express API, BullMQ workers, Prisma integration, and persistence logic.
- `apps/agent/` contains Python/FastAPI research orchestration and Daytona sandbox integration.
- `packages/contracts/` holds shared TypeScript/Zod request and response schemas.
- `sites/` contains the static-site worker and tests; `docs/` and `scripts/` contain supporting documentation, deployment assets, and utilities.

## Build, Test, and Development Commands

Run these from the repository root:

- `npm install` — install workspace dependencies.
- `npm run dev` — start the web app, API, and agent together (web :5173, API :4000, agent :8001).
- `npm run build` — build all workspace packages; use `npm run build:sites` for the site worker alone.
- `npm run typecheck` and `npm run lint` — run TypeScript checks and ESLint.
- `npm test` — run API, web, and site tests; `npm run test:agent` runs Python tests.
- `npm run format` / `npm run format:check` — apply or verify Prettier formatting.
- `npm run db:generate` and `npm run db:migrate` — generate Prisma client and apply local migrations.

## Coding Style & Naming Conventions

Use the repository Prettier and ESLint configurations. Use two-space indentation for TypeScript, JSON, and YAML, and four spaces for Python. Name React components and types in `PascalCase`, TypeScript functions and variables in `camelCase`, and Python modules/functions in `snake_case`. Keep shared API shapes in `packages/contracts` rather than duplicating them in apps.

## Testing Guidelines

Frontend and API tests use Vitest (with jsdom for UI tests), site tests use Node’s test runner, and agent tests use pytest. Follow existing `*.test.ts`, `*.test.tsx`, and `test_*.py` naming patterns. Add regression coverage for behavior changes and run the relevant focused test before the full suite.

## Commit & Pull Request Guidelines

Use short, imperative, scoped messages such as `feat: add source audit`, `fix: handle agent timeout`, or `test: cover contradiction parsing`; this matches the existing history. PRs should explain the user-visible change, list validation commands, link relevant issues, and include screenshots or recordings for UI changes. Keep unrelated refactors out of feature PRs.

## Security & Configuration

Copy `.env.example` to `.env` and keep credentials out of Git. Treat scraped pages and downloaded files as untrusted; route research through Daytona isolation and preserve prompt-injection warnings. Configure `DEMO_MODE=false` for live integrations, and verify PostgreSQL/Redis and the configured LLM credentials before running end-to-end investigations.
