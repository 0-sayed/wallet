// src/reports/reports.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { eq, sum } from 'drizzle-orm';
import type { AppDatabase } from '../common/database/db.module';
import { DB } from '../common/database/db.module';
import * as schema from '../common/database/schema';

export const REPORTS_QUEUE = 'reports';
export const GENERATE_REPORT_JOB = 'generate';

@Processor(REPORTS_QUEUE)
export class ReportsProcessor extends WorkerHost {
  private readonly logger = new Logger(ReportsProcessor.name);

  constructor(@Inject(DB) private db: AppDatabase) {
    super();
  }

  async process(job: Job<{ reportId: string }>) {
    const { reportId } = job.data;

    try {
      await this.db
        .update(schema.reports)
        .set({ status: 'processing' })
        .where(eq(schema.reports.id, reportId));

      const result = await this.aggregate();

      await this.db
        .update(schema.reports)
        .set({
          status: 'completed',
          result,
          completedAt: new Date(),
        })
        .where(eq(schema.reports.id, reportId));
    } catch (error) {
      this.logger.error(`Report ${reportId} failed`, (error as Error).stack);

      await this.db
        .update(schema.reports)
        .set({ status: 'failed' })
        .where(eq(schema.reports.id, reportId));

      throw new Error(`Report ${reportId} failed`, { cause: error });
    }
  }

  // Single GROUP BY query inside a repeatable-read transaction so all sums
  // reflect a consistent ledger snapshot in one round-trip.
  private async aggregate() {
    return this.db.transaction(
      async (tx) => {
        const rows = await tx
          .select({
            type: schema.ledger.type,
            total: sum(schema.ledger.amount),
          })
          .from(schema.ledger)
          .groupBy(schema.ledger.type);

        const byType = Object.fromEntries(
          rows.map((r) => [r.type, Number(r.total ?? 0)]),
        );

        return {
          totalDeposited: byType['deposit'] ?? 0,
          totalPurchaseVolume: byType['purchase'] ?? 0,
          totalRoyaltiesPaid: byType['royalty_author'] ?? 0,
          platformRevenue: byType['royalty_platform'] ?? 0,
          generatedAt: new Date().toISOString(),
        };
      },
      { isolationLevel: 'repeatable read' },
    );
  }
}
