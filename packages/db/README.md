# DB Package

This package owns the repository boundary for local persistence. It now uses SQLite for persistent memory while keeping higher layers storage-agnostic.

## Current shape

- `src/client.ts` creates the SQLite client and default local database path.
- `src/schema.ts` defines table names and schema bootstrap statements.
- `src/index.ts` exposes the typed repository implementation used by the orchestrator and API.
- `src/repositories/*` keeps the repository type seams explicit.

## Runtime behavior

- Default local database path: `.data/linkedin-brand-os.sqlite`
- Schema bootstrap happens automatically on repository construction and API startup.
- `resetDatabase()` exists for tests and local reset workflows.
- Tests should always use a dedicated SQLite file, never the local development database.

## Boundary expectations

1. `apps/web`, `apps/api`, and `packages/orchestrator` should not know SQL details.
2. Repository interfaces should stay stable when schema internals change.
3. Future migrations are allowed, but they should remain internal to this package.
4. External provider work should continue to compose through `orchestrator`, not by reaching into SQLite directly.
