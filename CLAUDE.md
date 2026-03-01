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

### Module-per-domain

Each business domain lives in its own NestJS module under `src/<domain>/`. Common infrastructure lives under `src/common/`.

```
src/
  app.module.ts                    # root module — imports domain modules, registers middleware
  main.ts                          # bootstrap: Pino logger, ValidationPipe, shutdown hooks, port 3000
  common/
    database/
      schema.ts                    # Drizzle schema — all tables and enums (single source of truth)
    logger/
      logger.module.ts             # PinoLoggerModule wrapper (pino-pretty dev / JSON prod)
    middleware/
      correlation-id.middleware.ts # extracts or generates X-Request-Id, attaches to Pino context
  health/
    health.controller.ts           # GET /health → { status: "ok" }
    health.controller.spec.ts      # exemplary unit test pattern
test/
  app.e2e-spec.ts                  # exemplary e2e test pattern
drizzle/                           # generated migration SQL files (gitignored)
```

### Adding a new domain

1. Create `src/<domain>/<domain>.module.ts`
2. Add controllers, services, repositories under that directory
3. Import the module in `app.module.ts`
4. Invoke the `nestjs-best-practices` skill before writing NestJS module code
5. Invoke the `postgres-drizzle` skill before writing schema or queries

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

**Migration workflow:**

```bash
# 1. Edit src/common/database/schema.ts
# 2. Generate migration
pnpm db:generate
# 3. Review generated SQL in drizzle/
# 4. Apply
pnpm db:migrate
```

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

### Unit tests (`*.spec.ts` in `src/`)

Follow `src/health/health.controller.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();
    controller = module.get<HealthController>(HealthController);
  });

  it('returns { status: "ok" }', () => {
    expect(controller.health()).toEqual({ status: 'ok' });
  });
});
```

### E2e tests (`*.e2e-spec.ts` in `test/`)

Follow `test/app.e2e-spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('HealthController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok' });
  });
});
```

**Coverage thresholds:** 50% global (branches, functions, lines, statements). Excluded from coverage: `main.ts`, `*.spec.ts`, `*.module.ts`, `**/database/schema.ts`.

## Environment Variables

See `.env.example` for all required vars:

```bash
DATABASE_URL=postgres://wallet:wallet@localhost:5435/wallet
REDIS_HOST=localhost
REDIS_PORT=6379
PLATFORM_ACCOUNT_ID=00000000-0000-0000-0000-000000000001
PLATFORM_WALLET_ID=00000000-0000-0000-0000-000000000002
```

> **Note:** Postgres runs on host port **5435** (not 5432 — that port is taken by a local instance). The Docker Compose file maps `5435:5432`.

## Skills

Required for this project — invoke before writing relevant code:

- `nestjs-best-practices` — before writing any NestJS module, controller, service, or guard
- `postgres-drizzle` — before writing schema changes, queries, or migrations

## CI

Two GitHub Actions workflows:

- `.github/workflows/ci.yml` — lint → typecheck → test → build (with Postgres service container)
- `.github/workflows/pr-check.yml` — conventional commit title enforcement + dependency review

Branch protection (manual GitHub UI setup): require PR for `main`, require CI pass, no direct push.
