# ADR-009: Redis Idempotency Cache

**Status:** Accepted
**Date:** 2026-04-12

## Context

Every purchase request hit Postgres with a `SELECT WHERE idempotency_key = ?` before the transaction. Under high retry volume this is unnecessary latency and DB load for requests that already have a known result.

## Decision

Redis SETNX edge cache. Before the DB check:

```
SET idempotency:<key> 'processing' EX 86400 NX
```

- If NX returns `null` (key exists): read the cached value and return or `409`.
- If NX returns `'OK'` (new request): proceed to DB.
- Cache the result after commit.
- Delete sentinel on transaction failure so clients can retry.

## Reasoning

- Redis is a latency shortcut — the DB remains the correctness backstop. The `UNIQUE` constraint on `purchases.idempotency_key` and the existing DB SELECT are untouched.
- Any request that slips past Redis (eviction, cold start, Redis unavailable) falls through to the DB path.
- The `'processing'` sentinel must be deleted on transaction failure — otherwise recoverable failures (e.g., 402 insufficient funds) would block client retries for 24 hours.
- TTL of 86400s (24 hours) covers any reasonable client retry window.

## Consequences

- Repeated requests with a completed purchase are served from Redis without hitting Postgres.
- Redis unavailability degrades gracefully (falls through to DB).
- A separate `RedisModule` is required because BullMQ does not expose its internal ioredis instance via NestJS DI.
