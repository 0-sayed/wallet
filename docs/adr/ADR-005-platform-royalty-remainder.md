# ADR-005: Platform Receives Royalty Remainder

**Status:** Accepted
**Date:** 2026-02-26

## Context

Royalty splits (70% author, 30% platform) applied to integer cent values can produce remainders. For example: 70% of 99 cents = 69.3 cents — not a valid integer. A rounding strategy must be defined.

## Decision

Author receives `floor(price * 70 / 100)`. Platform receives `price - author_cut`.

## Reasoning

- `author_cut + platform_cut == item_price` always. Zero cents are ever lost or created.
- The system never produces fractional cents in either wallet.
- The rule is deterministic — same input always produces same output.
- Platform absorbing remainders is standard practice (Stripe, App Store, Play Store all do this).

Example:

```
price = 99 cents
author_cut   = floor(99 * 70 / 100) = floor(69.3) = 69
platform_cut = 99 - 69 = 30
total = 69 + 30 = 99 ✓
```

## Consequences

- Platform may receive 1 cent more than the nominal 30% on non-round amounts
- Author always receives at least their floor share
- No special-case logic needed — one formula, always correct
