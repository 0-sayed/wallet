// src/reports/reports.controller.ts
import {
  Controller,
  Get,
  Param,
  Post,
  ParseUUIDPipe,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { ReportsService } from './reports.service';
import { UserIdGuard } from '../common/guards/user-id.guard';

@Controller('reports')
@UseGuards(UserIdGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post('financial')
  requestReport(@Req() req: Request & { userId: string }) {
    return this.reportsService.requestReport(req.userId);
  }

  @Get('financial/:jobId')
  getReport(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Req() req: Request & { userId: string },
  ) {
    return this.reportsService.getReport(jobId, req.userId);
  }
}
