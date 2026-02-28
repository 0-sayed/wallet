# ADR-001: NestJS over Fastify

**Status:** Accepted
**Date:** 2026-02-26

## Context

The system requires a backend framework for a financial API with async job processing, domain separation, and request guards. Two primary TypeScript candidates: NestJS and Fastify.

## Decision

Use NestJS.

## Reasoning

The evaluation criteria are architectural — concurrency, idempotency, transactions. The bottleneck is the database layer, not HTTP throughput. Fastify's performance advantage is irrelevant here.

NestJS provides:

- Module system that enforces domain boundaries at the framework level
- Built-in dependency injection for clean service composition and testability
- First-class BullMQ integration for async report processing
- Guards for request-level auth without middleware spaghetti

Fastify would require manually designing everything NestJS gives for free, spending time on infrastructure instead of on the problems being evaluated.

## Consequences

- More boilerplate than Fastify
- Opinionated structure — easier to onboard new developers
- BullMQ queue setup is straightforward with `@nestjs/bullmq`
