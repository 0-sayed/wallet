# ADR-002: PostgreSQL + Drizzle ORM

**Status:** Accepted
**Date:** 2026-02-26

## Context

A financial system requires a database that can enforce data integrity, support multi-step atomic transactions, and provide row-level locking for concurrent access.

## Decision

Use PostgreSQL as the database and Drizzle as the ORM.

## Reasoning

**PostgreSQL:**

- `SELECT FOR UPDATE` enables pessimistic row-level locking — the correct solution for concurrent purchase requests
- Full ACID transaction support for multi-step wallet operations
- `UNIQUE` constraints enforced at the database level for idempotency keys
- `NUMERIC` and integer types for exact monetary arithmetic

**Drizzle over Prisma:**
Prisma abstracts SQL, hiding the locking queries that are central to this system's correctness. Drizzle is SQL-first — `SELECT FOR UPDATE` is explicit in the service code, making the concurrency strategy visible and intentional rather than buried in ORM internals.

## Consequences

- Locking queries are explicit — easier to review and reason about
- Schema is defined in TypeScript with full type safety
- Migrations managed via `drizzle-kit`
