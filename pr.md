# PR #6 — feat: reports endpoint

> Generated: 2026-03-02 | Branch: feat/reports-endpoint | Last updated: 2026-03-02 20:00

## Worth Fixing

- [x] Unknown user UUID causes FK error → 500 instead of 4xx — @chatgpt-codex-connector <!-- thread:PRRT_kwDORa0ph85xokmA -->

  > **src/reports/reports.service.ts:24**
  >
  > **<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub> Handle unknown user IDs before inserting reports**
  >
  > `ReportsService.requestReport` inserts directly into `reports` with the header-derived `requestedBy` value, but that column has a foreign key to `users.id`; when a caller sends a syntactically valid UUID that does not exist in `users`, the insert throws a Postgres FK error and the API returns a 500 instead of a controlled 4xx response. This makes the new endpoint fail hard for an unauthenticated/unknown user scenario that other endpoints handle gracefully.
  >
  > Useful? React with 👍 / 👎.

- [x] Bigint precision lost when summing ledger amounts — @chatgpt-codex-connector <!-- thread:PRRT_kwDORa0ph85xokmC -->

  > **src/reports/reports.processor.ts:66**
  >
  > **<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub> Preserve bigint totals when aggregating ledger sums**
  >
  > In `ReportsProcessor.aggregate`, `sum(ledger.amount)` is coerced with `Number(...)`; Postgres `sum(integer)` returns a bigint-like value, so once totals exceed JS safe integer range, this conversion silently loses precision and produces incorrect financial report amounts. Financial aggregates should keep integer fidelity (e.g., bigint/string) through serialization.
  >
  > Useful? React with 👍 / 👎.

- [x] REDIS_PORT is a string at runtime — coerce to number before passing to BullMQ — @coderabbitai <!-- thread:PRRT_kwDORa0ph85xoo5l -->

  > **src/app.module.ts:21**
  >
  > _⚠️ Potential issue_ | _🟠 Major_
  >
  > **Coerce `REDIS_PORT` to a number before passing to BullMQ.**
  >
  > `ConfigService.get<number>()` is a TypeScript type hint only; environment variables are always strings at runtime. BullMQ/ioredis requires `port` as a number. When `REDIS_PORT` is set in `.env`, it reaches ioredis as a string, causing a type mismatch.
  >
  > <details>
  > <summary>Proposed fix</summary>
  >
  > ```diff
  > -    BullModule.forRootAsync({
  > -      useFactory: (config: ConfigService) => ({
  > -        connection: {
  > -          host: config.get<string>('REDIS_HOST', 'localhost'),
  > -          port: config.get<number>('REDIS_PORT', 6379),
  > -        },
  > -      }),
  > +    BullModule.forRootAsync({
  > +      useFactory: (config: ConfigService) => {
  > +        const redisPort = Number(config.get<string>('REDIS_PORT', '6379'));
  > +        if (Number.isNaN(redisPort)) {
  > +          throw new Error('REDIS_PORT must be a valid number');
  > +        }
  > +        return {
  > +          connection: {
  > +            host: config.get<string>('REDIS_HOST', 'localhost'),
  > +            port: redisPort,
  > +          },
  > +        };
  > +      },
  >        inject: [ConfigService],
  >      }),
  > ```
  >
  > </details>

- [x] mockRequest in controller spec missing Request type cast — breaks TS compilation — @coderabbitai <!-- thread:PRRT_kwDORa0ph85xoo50 -->

  > **src/reports/reports.controller.spec.ts:15**
  >
  > _⚠️ Potential issue_ | _🔴 Critical_
  >
  > **Fix mock request typing to unblock TypeScript compilation.**
  >
  > The `mockRequest` must satisfy the `Request & { userId: string }` type signature expected by controller methods `requestReport()` and `getReport()`.
  >
  > <details>
  > <summary>Proposed fix</summary>
  >
  > ```diff
  >  import { Test, TestingModule } from '@nestjs/testing';
  > +import { Request } from 'express';
  >  import { ReportsController } from './reports.controller';
  >  import { ReportsService } from './reports.service';
  > @@
  > -  const mockRequest = { userId: 'user-uuid-1' };
  > +  const mockRequest = { userId: 'user-uuid-1' } as Request & {
  > +    userId: string;
  > +  };
  > ```
  >
  > </details>
  >
  > Also applies to lines 33–40 where mockRequest is passed to controller methods.

- [x] Processor catch block — DB status update not wrapped in try/catch — @gemini-code-assist <!-- thread:PRRT_kwDORa0ph85xoppj -->

  > **src/reports/reports.processor.ts:49**
  >
  > ![medium](https://www.gstatic.com/codereviewagent/medium-priority.svg)
  >
  > The database call to update the report status to 'failed' is not wrapped in a `try...catch` block. If this call fails (e.g., due to a database connection issue), it will result in an unhandled promise rejection within the `catch` block. This would cause the original error to be lost and could lead to unexpected behavior in the job processor, potentially preventing BullMQ from correctly handling the job failure. To improve robustness, consider wrapping the status update call in its own `try...catch` block to log the secondary failure while still ensuring the original error is thrown.
  >
  > ```typescript
  >     } catch (error) {
  >       this.logger.error(`Report ${reportId} failed`, (error as Error).stack);
  >
  >       try {
  >         await this.db
  >           .update(schema.reports)
  >           .set({ status: 'failed' })
  >           .where(eq(schema.reports.id, reportId));
  >       } catch (updateError) {
  >         this.logger.error(
  >           `Additionally, failed to update report ${reportId} to 'failed' status.`,
  >           (updateError as Error).stack,
  >         );
  >       }
  >
  >       throw new Error(`Report ${reportId} failed`, { cause: error });
  >     }
  > ```

- [x] Service queue catch block — DB status update not wrapped in try/catch — @gemini-code-assist <!-- thread:PRRT_kwDORa0ph85xoppt -->

  > **src/reports/reports.service.ts:42**
  >
  > ![medium](https://www.gstatic.com/codereviewagent/medium-priority.svg)
  >
  > In the `catch` block for handling queue-addition failures, there's an `await`ed database call to mark the report as 'failed'. If this database call itself fails, it will cause an unhandled promise rejection, and the original error from the queue will be lost. The client would receive a generic 500 error related to the database, not the queue. To make this error handling more robust, you could wrap the database update in a `try...catch`. If the update fails, log the secondary error and re-throw the original error to ensure the client receives an appropriate error and the system state (orphaned report) is understood.
  >
  > ```typescript
  >     } catch (error) {
  >       // Enqueue failed (e.g. Redis down) — mark report as failed so it does
  >       // not remain orphaned in queued status indefinitely.
  >       this.logger.error(
  >         `Failed to enqueue report ${report.id}`,
  >         (error as Error).stack,
  >       );
  >
  >       try {
  >         await this.db
  >           .update(schema.reports)
  >           .set({ status: 'failed' })
  >           .where(eq(schema.reports.id, report.id));
  >
  >         return { jobId: report.id, status: 'failed' as const };
  >       } catch (dbError) {
  >         this.logger.error(
  >           `Failed to mark report ${report.id} as 'failed' in DB after queue failure.`,
  >           (dbError as Error).stack,
  >         );
  >         // Rethrow original error as we couldn't gracefully handle the failure.
  >         throw error;
  >       }
  >     }
  > ```

- [x] Failure-path test claims to preserve Error.cause but never asserts it — @coderabbitai <!-- thread:PRRT_kwDORa0ph85xovHc -->

  > **src/reports/reports.processor.spec.ts:66**
  >
  > _⚠️ Potential issue_ | _🟡 Minor_
  >
  > **Failure-path test does not validate preserved `cause`.**
  >
  > The test name says cause is preserved, but `rejects.toThrow()` won't detect regressions in `Error.cause`.
  >
  > <details>
  > <summary>Proposed fix</summary>
  >
  > ```diff
  > -    await expect(
  > -      processor.process({ data: { reportId: 'report-1' } } as unknown as Job<{
  > -        reportId: string;
  > -      }>),
  > -    ).rejects.toThrow();
  > +    try {
  > +      await processor.process({ data: { reportId: 'report-1' } } as unknown as Job<{
  > +        reportId: string;
  > +      }>);
  > +      fail('Expected processor.process to throw');
  > +    } catch (err) {
  > +      expect((err as Error).cause).toBe(originalError);
  > +    }
  > ```
  >
  > </details>

- [x] Type Check failing — CI
  - [x] `src/reports/reports.controller.spec.ts:33` — `Argument of type '{ userId: string; }' is not assignable to parameter of type 'Request & { userId: string; }'` (missing 100+ Request properties)
  - [x] `src/reports/reports.controller.spec.ts:39` — same error on second controller method call

## Not Worth Fixing

- [ ] ~~No RBAC on reports endpoint — any user can request platform-wide financial report — @gemini-code-assist~~ <!-- thread:PRRT_kwDORa0ph85xoppc -->
  - _Reason: POC project with no real auth. The reviewer explicitly acknowledges this is acceptable for POC as temporary scaffolding. Out of scope here._
    > **src/reports/reports.controller.ts:16**
    >
    > ![security-high](https://www.gstatic.com/codereviewagent/security-high-priority.svg) ![high](https://www.gstatic.com/codereviewagent/high-priority.svg)
    >
    > While simplified authentication mechanisms like `UserIdGuard` with an `x-user-id` header can be acceptable for Proof of Concept (POC) projects as temporary scaffolding, for a production-ready system, this setup for the `reports/financial` endpoint poses a significant risk. It allows any user with a valid UUID to request platform-wide financial reports without role-based access control. Given that the underlying processor aggregates platform-wide data, this endpoint should be restricted to administrative users.
    >
    > <details>
    > <summary>References</summary>
    >
    > 1. For Proof of Concept (POC) projects, it is acceptable to use simplified, insecure authentication mechanisms (e.g., a user ID header) as temporary scaffolding, provided it is understood that this will be replaced with a robust solution before production.
    > </details>

- [ ] ~~Aggregate method exposes platform-wide financial data to all users — @gemini-code-assist~~ <!-- thread:PRRT_kwDORa0ph85xoppd -->
  - _Reason: This is intentionally a platform-wide financial report (not user-specific). Access restriction is the same POC auth concern addressed above — not worth fixing separately._
    > **src/reports/reports.processor.ts:78**
    >
    > ![security-high](https://www.gstatic.com/codereviewagent/security-high-priority.svg) ![high](https://www.gstatic.com/codereviewagent/high-priority.svg)
    >
    > The `aggregate` method calculates financial metrics by summing up all entries in the `ledger` table without any filtering. When triggered via the `reports/financial` endpoint, this results in the disclosure of platform-wide financial data (e.g., total platform revenue, total royalties) to any user who requests a report. If this report is intended to be user-specific, the query should include a filter for the user's wallet(s). If it is intended to be a platform-wide report, access to the triggering endpoint should be restricted to admins.
