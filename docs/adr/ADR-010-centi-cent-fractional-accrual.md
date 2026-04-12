# ADR-010: Centi-cent Fractional Accrual

**Status:** Accepted
**Date:** 2026-04-12
**Supersedes:** ADR-005

## Context

`Math.floor(price * 70 / 100)` always floors the author royalty, giving every sub-cent remainder to the platform. Over millions of microtransactions this is a systematic wealth transfer away from authors.

Example over three 99-cent transactions: author should receive 3 × 69.3 = 207.9 cents but actually receives 3 × 69 = 207 cents; platform over-receives ~1 cent per 3 transactions.

## Decision

Per-author centi-cent accrual. Track each author wallet's fractional royalty remainder at centi-cent precision (1/100 of a cent, stored as integer 0–99 in `wallets.fractional_balance`). When accumulated centi-cents reach 100, sweep one whole cent into the author's balance within the same transaction.

```typescript
const exactNumerator = itemPrice * AUTHOR_ROYALTY_PERCENT; // e.g. 99*70 = 6930
const authorFloorCents = Math.floor(exactNumerator / 100); // 69
const remainderCentiCents = exactNumerator % 100; // 30
const newFractional = authorWallet.fractionalBalance + remainderCentiCents;
const sweepCents = Math.floor(newFractional / 100); // whole cents to sweep
const leftoverCenti = newFractional % 100; // stored back
const totalAuthorCents = authorFloorCents + sweepCents; // actual credit
const platformCut = itemPrice - totalAuthorCents; // always = itemPrice
```

## Reasoning

- Money conservation holds — `totalAuthorCents + platformCut === itemPrice` always.
- Stays within ADR-003's integer-only philosophy — centi-cents are a finer-grained integer unit.
- The `SELECT FOR UPDATE` on the author wallet row means `fractionalBalance` can be set directly (no SQL arithmetic needed — we hold the lock).
- No background job required.

## Consequences

- Author wallets gain a `fractional_balance` column (0–99).
- Authors receive the correct economic share over time rather than systematically losing sub-cent remainders.
- Platform receives slightly less on average (closer to the nominal 30%).
- Ledger entries record `totalAuthorCents` and `platformCut` (actual money moved, not nominal percentages).
