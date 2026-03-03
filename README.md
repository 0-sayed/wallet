# Wallet and Royalty API

[![CI](https://github.com/0-sayed/wallet/actions/workflows/ci.yml/badge.svg)](https://github.com/0-sayed/wallet/actions/workflows/ci.yml)
![Node 22](https://img.shields.io/badge/node-22-green)
![TypeScript](https://img.shields.io/badge/typescript-strict-blue)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow)](LICENSE)

A production-minded backend for wallet balances, royalty splits, and async financial reporting, designed around correctness under concurrency.

## About

This project is a mini financial system API built to prioritise transactional integrity over raw HTTP throughput.

- Uses PostgreSQL transactions and `SELECT FOR UPDATE` locking to prevent double-spending.
- Enforces idempotency with a client-owned `Idempotency-Key` and database uniqueness constraints.
- Stores all money as integer cents to avoid floating point errors.
- Uses deterministic royalty math: author gets floor(70%), platform gets the remainder.
- Uses BullMQ + Redis for non-blocking report generation.

## Tech Stack

- NestJS + TypeScript (strict)
- PostgreSQL + Drizzle ORM
- BullMQ + Redis
- Jest + Supertest
- Docker Compose + pnpm

## API Surface

All endpoints except `/health` require an `X-User-Id` header (UUID).

| Method | Path                         | Description                               | Extra Headers            |
| ------ | ---------------------------- | ----------------------------------------- | ------------------------ |
| `GET`  | `/health`                    | Health check                              | —                        |
| `POST` | `/wallets/:walletId/deposit` | Deposit funds into a wallet               | —                        |
| `POST` | `/purchases`                 | Purchase an item (3-wallet royalty split) | `Idempotency-Key` (UUID) |
| `POST` | `/reports/financial`         | Request an async financial report         | —                        |
| `GET`  | `/reports/financial/:jobId`  | Poll report status and result             | —                        |

Swagger UI is available at `/api` when `SWAGGER_ENABLED=true`.

## Run Locally

Prerequisites: Node.js 22+, pnpm 9+, Docker + Docker Compose.

1. Install dependencies.

```bash
pnpm install
```

2. Create local environment file.

```bash
cp .env.example .env
```

3. Start PostgreSQL and Redis.

```bash
docker compose up -d
```

4. Apply database migrations.

```bash
pnpm db:migrate
```

5. Seed the platform account.

```bash
pnpm db:seed
```

6. Start the API.

```bash
pnpm start:dev
```

7. Verify health endpoint.

```bash
curl -s http://localhost:3000/health
# → { "status": "ok" }
```

## Commands

| Command            | Description                                                      |
| ------------------ | ---------------------------------------------------------------- |
| `pnpm lint`        | ESLint with auto-fix                                             |
| `pnpm format`      | Prettier write                                                   |
| `pnpm typecheck`   | TypeScript type check                                            |
| `pnpm test`        | Unit tests                                                       |
| `pnpm test:e2e`    | E2e tests                                                        |
| `pnpm test:cov`    | Unit tests with coverage                                         |
| `pnpm knip`        | Dead code / unused deps check                                    |
| `pnpm validate`    | Full local quality gate (lint + typecheck + test + knip + build) |
| `pnpm db:generate` | Generate Drizzle migration from schema changes                   |
| `pnpm db:migrate`  | Apply pending migrations                                         |
| `pnpm db:seed`     | Seed platform user and wallet                                    |
| `pnpm db:studio`   | Drizzle Studio GUI                                               |

## Architecture

For system context diagrams, module structure, data model, concurrency details, and the full request lifecycle, see [docs/architecture.md](docs/architecture.md).

## Design Decisions

Key decisions are captured in ADRs:

- [ADR-001: NestJS over Fastify](docs/adr/ADR-001-nestjs-over-fastify.md)
- [ADR-002: PostgreSQL + Drizzle ORM](docs/adr/ADR-002-postgresql-drizzle.md)
- [ADR-003: Integer Cents over NUMERIC](docs/adr/ADR-003-integer-cents.md)
- [ADR-004: Pessimistic Locking over Optimistic](docs/adr/ADR-004-pessimistic-locking.md)
- [ADR-005: Platform Receives Royalty Remainder](docs/adr/ADR-005-platform-royalty-remainder.md)
- [ADR-006: BullMQ for Async Report Generation](docs/adr/ADR-006-bullmq-async-reports.md)
- [ADR-007: Idempotency Key Owned by Client](docs/adr/ADR-007-client-owned-idempotency-key.md)

## Project Docs

- [Architecture](docs/architecture.md)
- [Architecture decisions (ADR)](docs/adr/)
- [Security policy](SECURITY.md)

## License

[MIT](LICENSE)
