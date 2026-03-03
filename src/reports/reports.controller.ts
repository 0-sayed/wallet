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
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { UserIdGuard } from '../common/guards/user-id.guard';
import { ApiUserIdHeader } from '../common/guards/user-id-api.decorator';
import { ReportRequestResponseDto } from './dto/report-request-response.dto';
import { ReportResponseDto } from './dto/report-response.dto';

@ApiTags('reports')
@ApiUserIdHeader()
@Controller('reports')
@UseGuards(UserIdGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post('financial')
  @ApiOperation({ summary: 'Request a financial report' })
  @ApiCreatedResponse({ description: 'Report queued for generation' })
  @ApiBadRequestResponse({ description: 'User does not exist' })
  requestReport(
    @Req() req: Request & { userId: string },
  ): Promise<ReportRequestResponseDto> {
    return this.reportsService.requestReport(req.userId);
  }

  @Get('financial/:jobId')
  @ApiOperation({ summary: 'Get report status and result' })
  @ApiParam({ name: 'jobId', format: 'uuid' })
  @ApiNotFoundResponse({ description: 'Report not found' })
  getReport(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Req() req: Request & { userId: string },
  ): Promise<ReportResponseDto> {
    return this.reportsService.getReport(jobId, req.userId);
  }
}
