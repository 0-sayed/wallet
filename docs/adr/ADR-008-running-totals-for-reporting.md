# ADR-008: Running Totals for Reporting

**Status:** Accepted
**Date:** 2026-04-12

## Context

`ReportsProcessor.aggregate()` ran a `GROUP BY` over the entire `ledger` table inside a `REPEATABLE READ` transaction. At 100M+ rows this causes a full table scan, consumes memory proportional to result size, and holds a long-running transaction on the operational database.

## Decision

A new `ledger_totals` table maintains pre-aggregated running sums per ledger type:

```sql
type  ledger_type  PRIMARY KEY
total BIGINT       NOT NULL DEFAULT 0
```

The table is updated inside the same transaction as every ledger insert using `INSERT ... ON CONFLICT DO UPDATE`. `ReportsProcessor` replaces the `GROUP BY` with a single `SELECT * FROM ledger_totals` (4 rows, no scan).

## Reasoning

- The running total is always consistent with the ledger because it is updated in the same transaction. No eventual consistency.
- O(1) read path replaces O(N) scan.
- `BIGINT` is chosen because the sum of 100M+ cent-denominated values can exceed INT4's ~2.1 billion max.
- Upsert (`INSERT ... ON CONFLICT DO UPDATE`) is used rather than bare `UPDATE` to handle fresh databases where the row may not yet exist.

## Consequences

- Reporting is O(1) regardless of ledger size.
- Write path has a small additional upsert per transaction (negligible vs. ledger insert cost).
- Migration includes a backfill from existing ledger data.
