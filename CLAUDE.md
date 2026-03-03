# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**wallet** — a POC digital wallet API. Users can deposit funds, purchase items (transferring funds from buyer to author with platform royalties), and request sales reports. No real payments — integer balances only.

**Tech stack:**

- **Runtime:** Node 22, pnpm 9
- **Framework:** NestJS 11, TypeScript strict mode
- **Database:** PostgreSQL 16 via Drizzle ORM (`drizzle-orm`, `postgres` driver)
- **Queue:** BullMQ + Redis 7
- **Logging:** nestjs-pino (JSON in prod, pino-pretty in dev)
- **Validation:** class-validator + class-transformer via global ValidationPipe
- **Testing:** Jest + Supertest
- **Linting:** ESLint flat config (`eslint.config.mjs`), Prettier, Knip

## Commands

```bash
# Development
pnpm start:dev          # watch mode (never terminates — use background pattern in automation)
pnpm start:prod         # run compiled dist/

# Build & validate
pnpm build              # compile to dist/
pnpm validate           # lint + typecheck + test --coverage + knip + build (full CI chain)

# Code quality
pnpm lint               # ESLint with auto-fix
pnpm format             # Prettier write
pnpm format:check       # Prettier check (CI)
pnpm typecheck          # tsc --noEmit
pnpm knip               # dead code / unused deps check

# Tests
pnpm test               # unit tests
pnpm test:cov           # unit tests with coverage
pnpm test:e2e           # e2e tests (requires app module — no live DB needed)

# Database
pnpm db:generate        # generate Drizzle migration from schema changes
pnpm db:migrate         # apply pending migrations to DATABASE_URL
pnpm db:seed            # seed platform user + wallet
pnpm db:studio          # Drizzle Studio UI (never run in automation — it's a long-running GUI)

# Docker services (Postgres on 5435, Redis on 6379)
docker compose up -d
docker compose ps
docker compose exec postgres psql -U wallet -d wallet -c "\dt"
```

> **Background pattern for automation** (pnpm start:dev / pnpm start never terminate):
>
> ```bash
> pnpm start:dev & sleep 4 && curl -s http://localhost:3000/health && kill %1
> ```

## Architecture

Each business domain lives in its own NestJS module under `src/<domain>/`. Common infrastructure lives under `src/common/`. See [docs/architecture.md](docs/architecture.md) for diagrams and details.

```
src/
  app.module.ts
  main.ts
  common/
    database/
      schema.ts          # Drizzle schema — all tables and enums
      db.module.ts        # connection provider
      seed.ts             # platform user + wallet seeder
    logger/
      logger.module.ts
    middleware/
      correlation-id.middleware.ts
    guards/
      user-id.guard.ts
    validation/
      uuid.ts
  health/
  wallets/
  purchases/
  reports/
test/
drizzle/                  # generated migration SQL (gitignored)
```

## Database

**Schema:** `src/common/database/schema.ts` — single file, all tables.

**Tables:** `users`, `wallets`, `purchases`, `ledger`, `reports`

**Enums:** `purchase_status` (pending/completed/failed), `ledger_type` (deposit/purchase/royalty_author/royalty_platform), `ledger_direction` (credit/debit), `report_status` (queued/processing/completed/failed)

**Key constraints:**

- `wallets.balance >= 0` (CHECK)
- `ledger.amount > 0` (CHECK)
- `purchases.item_price > 0` (CHECK)
- `wallets.user_id` has a unique index (one wallet per user)
- `purchases.idempotency_key` has a unique index (DB-enforced dedup)

**Migration workflow:** edit `schema.ts` → `pnpm db:generate` → review SQL in `drizzle/` → `pnpm db:migrate`

## Validation

Global `ValidationPipe` is configured in `main.ts` with:

- `whitelist: true` — strips unknown properties from request bodies
- `forbidNonWhitelisted: true` — rejects requests with unknown properties (400)
- `transform: true` — auto-transforms payloads to DTO class instances

All request DTOs use `class-validator` decorators. No manual validation in controllers or services.

## Logging & Correlation

Every request gets an `X-Request-Id` header (extracted from the incoming request or generated as a UUID). It is attached to the Pino logging context so all log lines for a request share the same trace ID. The `CorrelationIdMiddleware` handles this — it's registered globally in `AppModule`.

Use the injected `Logger` from `nestjs-pino` in services and controllers (not `console.log`).

## Error Handling

- Throw NestJS built-in exceptions (`NotFoundException`, `BadRequestException`, `ConflictException`, etc.) — the global exception filter handles serialization
- Never return raw errors to clients
- For business logic errors (e.g., insufficient balance), throw `BadRequestException` with a descriptive message
- For idempotency conflicts, throw `ConflictException`

## Testing Patterns

- **Unit tests** (`*.spec.ts` in `src/`): follow `src/health/health.controller.spec.ts` as the exemplary pattern
- **E2e tests** (`*.e2e-spec.ts` in `test/`): follow `test/app.e2e-spec.ts` as the exemplary pattern
- **Coverage thresholds:** 50% global (branches, functions, lines, statements). Excluded from coverage: `main.ts`, `*.spec.ts`, `*.module.ts`, `**/database/schema.ts`

## Environment Variables

See `.env.example` for all required vars. Note: Postgres runs on host port **5435** (not 5432), mapped via Docker Compose.

## Skills

Required for this project — invoke before writing relevant code:

- `nestjs-best-practices` — before writing any NestJS module, controller, service, or guard
- `postgres-drizzle` — before writing schema changes, queries, or migrations

## API Documentation

Swagger UI is available at `/api` when `SWAGGER_ENABLED=true` (explicit opt-in; defaults to off).

- `@nestjs/swagger` CLI plugin handles automatic DTO inference — no `@ApiProperty` needed on DTO classes
- Manual annotations are required for: `@ApiTags`, `@ApiHeader`, `@ApiParam`, and error response decorators
- OpenAPI JSON spec available at `/api-json`

## CI

Three GitHub Actions workflows:

- `.github/workflows/ci.yml` — lint → audit → typecheck → test → build (with Postgres + Redis service containers)
- `.github/workflows/pr-check.yml` — conventional commit title enforcement + dependency review
- `.github/workflows/auto-assign-pr.yml` — auto-assigns PR author

Branch protection (manual GitHub UI setup): require PR for `main`, require CI pass, no direct push.
