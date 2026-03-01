# ADR-004: Pessimistic Locking over Optimistic

**Status:** Accepted
**Date:** 2026-02-26

## Context

Concurrent purchase requests against the same wallet must be serialized to prevent double-spending. Two standard approaches: pessimistic locking (lock before read) and optimistic locking (detect conflict on write).

## Decision

Use pessimistic locking via `SELECT FOR UPDATE`.

## Reasoning

**Optimistic locking** adds a `version` column to wallets, reads without locking, and retries on conflict. This works well when conflicts are rare. For a wallet, conflicts are not rare — a user clicking buy twice is the exact common case we're protecting against. Optimistic locking would cause the second request to retry and potentially succeed if balance allows, or produce confusing retry loops.

**Pessimistic locking** with `SELECT FOR UPDATE`:

- Acquires a row-level lock at read time
- Second concurrent request waits at the lock, not at the write
- After the first commits, the second reads the updated balance and is re-evaluated; it may succeed or fail based on remaining funds
- No retry logic. No version columns. The database serializes access.

This is the correct mental model for financial transactions: when money is involved, serialize access and fail fast rather than optimistically hope for no conflict.

## Consequences

- Slightly reduced throughput under high concurrency (requests queue at the lock)
- Correct behavior guaranteed without application-level retry logic
- Lock duration is minimal — only for the duration of the transaction
