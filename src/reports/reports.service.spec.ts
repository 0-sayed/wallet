// src/reports/reports.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { NotFoundException } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { DB } from '../common/database/db.module';
import { REPORTS_QUEUE } from './reports.processor';

describe('ReportsService', () => {
  let service: ReportsService;
  let mockDb: jest.Mocked<any>;
  let mockQueue: jest.Mocked<any>;

  const mockReport = {
    id: 'report-uuid-1',
    status: 'queued' as const,
    requestedBy: 'user-uuid-1',
    result: null,
    createdAt: new Date(),
    completedAt: null,
  };

  beforeEach(async () => {
    mockDb = {
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      returning: jest.fn().mockResolvedValue([mockReport]),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockResolvedValue([]),
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
    };

    mockQueue = {
      add: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: DB, useValue: mockDb },
        { provide: getQueueToken(REPORTS_QUEUE), useValue: mockQueue },
      ],
    }).compile();

    service = module.get<ReportsService>(ReportsService);
  });

  describe('requestReport', () => {
    it('inserts a report row and enqueues a job', async () => {
      const result = await service.requestReport('user-uuid-1');

      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockQueue.add).toHaveBeenCalledWith('generate', {
        reportId: mockReport.id,
      });
      expect(result).toEqual({ jobId: mockReport.id, status: 'queued' });
    });

    it('marks report as failed when enqueue throws', async () => {
      mockQueue.add.mockRejectedValue(new Error('Redis down'));

      const result = await service.requestReport('user-uuid-1');

      expect(mockDb.update).toHaveBeenCalled();
      expect(result).toEqual({ jobId: mockReport.id, status: 'failed' });
    });
  });

  describe('getReport', () => {
    it('returns report data for the owner', async () => {
      mockDb.where.mockResolvedValue([mockReport]);

      const result = await service.getReport(mockReport.id, 'user-uuid-1');

      expect(result).toEqual({
        jobId: mockReport.id,
        status: mockReport.status,
        result: null,
      });
    });

    it('throws NotFoundException for unknown report', async () => {
      mockDb.where.mockResolvedValue([]);

      await expect(
        service.getReport('unknown-id', 'user-uuid-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for non-owner (same 404 to avoid enumeration)', async () => {
      mockDb.where.mockResolvedValue([]);

      await expect(
        service.getReport(mockReport.id, 'other-user-uuid'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
