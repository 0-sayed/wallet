# ADR-003: Integer Cents over NUMERIC

**Status:** Accepted
**Date:** 2026-02-26

## Context

Monetary values must be stored without floating point errors. Two common approaches: PostgreSQL `NUMERIC(19,4)` or integers representing the smallest currency unit (cents).

## Decision

Store all monetary values as integers representing cents.

## Reasoning

`NUMERIC` solves floating point at the database level. Integers solve it at the application level — which is stricter, because there is no intermediate floating point representation anywhere in the stack.

This is the approach used by Stripe, Square, and PayPal. `$1.00` is stored as `100`. `$1.50` is stored as `150`. All arithmetic is integer arithmetic.

The only special case is royalty splits where division produces remainders (e.g., 70% of 99 cents = 69.3). This is resolved by ADR-005.

## Consequences

- All monetary values are integers in the codebase — no decimal types anywhere
- API accepts and returns cent values (documented in API contract)
- Division for royalty splits requires explicit rounding strategy (see ADR-005)

## Addendum (2026-04-12)

Centi-cents (1/100 of a cent, stored as `wallets.fractional_balance`) extend this principle for sub-cent royalty accrual. See ADR-010.
