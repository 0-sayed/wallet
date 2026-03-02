// src/reports/reports.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { Request } from 'express';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

describe('ReportsController', () => {
  let controller: ReportsController;
  let mockService: Partial<ReportsService>;

  const mockReportResponse = {
    jobId: 'report-uuid-1',
    status: 'queued' as const,
  };
  const mockRequest = { userId: 'user-uuid-1' } as Request & {
    userId: string;
  };

  beforeEach(async () => {
    mockService = {
      requestReport: jest.fn().mockResolvedValue(mockReportResponse),
      getReport: jest
        .fn()
        .mockResolvedValue({ ...mockReportResponse, result: null }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [{ provide: ReportsService, useValue: mockService }],
    }).compile();

    controller = module.get<ReportsController>(ReportsController);
  });

  it('requestReport delegates to service with userId', async () => {
    const result = await controller.requestReport(mockRequest);
    expect(mockService.requestReport).toHaveBeenCalledWith('user-uuid-1');
    expect(result).toEqual(mockReportResponse);
  });

  it('getReport delegates to service with jobId and userId', async () => {
    const result = await controller.getReport('report-uuid-1', mockRequest);
    expect(mockService.getReport).toHaveBeenCalledWith(
      'report-uuid-1',
      'user-uuid-1',
    );
    expect(result).toEqual({ ...mockReportResponse, result: null });
  });
});
