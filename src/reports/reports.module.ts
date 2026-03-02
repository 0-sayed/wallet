// src/reports/reports.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ReportsProcessor, REPORTS_QUEUE } from './reports.processor';

@Module({
  imports: [BullModule.registerQueue({ name: REPORTS_QUEUE })],
  controllers: [ReportsController],
  providers: [ReportsService, ReportsProcessor],
})
export class ReportsModule {}
