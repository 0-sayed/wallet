# ADR-006: BullMQ for Async Report Generation

**Status:** Accepted
**Date:** 2026-02-26

## Context

Financial report generation requires aggregating potentially large datasets. The spec explicitly requires this to not block the main application thread.

## Decision

Use BullMQ with Redis for async job processing.

## Reasoning

Running report generation inline would hold the HTTP connection open for the duration of the query — unacceptable for large datasets and explicitly disallowed by the spec.

BullMQ:

- Jobs are persisted in Redis — survives server restarts
- Worker runs in a separate process/thread — main NestJS thread is never blocked
- Built-in job status tracking (`queued`, `processing`, `completed`, `failed`)
- First-class NestJS integration via `@nestjs/bullmq`

The client receives a `jobId` immediately and polls `GET /reports/financial/:jobId` for status. Simple, reliable, no WebSocket complexity needed for a POC.

## Consequences

- Redis is required as an additional infrastructure dependency
- Report results are stored in the `reports` table (JSONB) for persistence beyond Redis TTL
- Polling is simple for POC — production could upgrade to WebSocket push
