// src/reports/reports.service.ts
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import type { AppDatabase } from '../common/database/db.module';
import { DB } from '../common/database/db.module';
import * as schema from '../common/database/schema';
import { GENERATE_REPORT_JOB, REPORTS_QUEUE } from './reports.processor';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    @Inject(DB) private db: AppDatabase,
    @InjectQueue(REPORTS_QUEUE) private reportsQueue: Queue,
  ) {}

  async requestReport(requestedBy: string) {
    const [report] = await this.db
      .insert(schema.reports)
      .values({ requestedBy })
      .returning();

    try {
      await this.reportsQueue.add(GENERATE_REPORT_JOB, { reportId: report.id });
    } catch (error) {
      // Enqueue failed (e.g. Redis down) — mark report as failed so it does
      // not remain orphaned in queued status indefinitely.
      this.logger.error(
        `Failed to enqueue report ${report.id}`,
        (error as Error).stack,
      );

      await this.db
        .update(schema.reports)
        .set({ status: 'failed' })
        .where(eq(schema.reports.id, report.id));

      return { jobId: report.id, status: 'failed' as const };
    }

    return { jobId: report.id, status: report.status };
  }

  // Owner-scoped lookup: matches by both report id AND requestedBy to prevent
  // cross-user access. Returns 404 for non-owner to avoid identifier enumeration.
  async getReport(reportId: string, requestedBy: string) {
    const [report] = await this.db
      .select()
      .from(schema.reports)
      .where(
        and(
          eq(schema.reports.id, reportId),
          eq(schema.reports.requestedBy, requestedBy),
        ),
      );

    if (!report) throw new NotFoundException(`Report ${reportId} not found`);

    return {
      jobId: report.id,
      status: report.status,
      result: report.result,
    };
  }
}
