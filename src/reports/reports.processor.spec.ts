// src/reports/reports.processor.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';
import { ReportsProcessor } from './reports.processor';
import { DB } from '../common/database/db.module';

describe('ReportsProcessor', () => {
  let processor: ReportsProcessor;
  let mockDb: any;

  const mockAggregates = {
    totalDeposited: '15000',
    totalPurchaseVolume: '8000',
    totalRoyaltiesPaid: '5600',
    platformRevenue: '2400',
    generatedAt: expect.any(String),
  };

  beforeEach(async () => {
    mockDb = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      transaction: jest.fn((cb) => cb(mockDb)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ReportsProcessor, { provide: DB, useValue: mockDb }],
    }).compile();

    processor = module.get(ReportsProcessor);
  });

  it('transitions report from queued to processing to completed with payload', async () => {
    jest.spyOn(processor as any, 'aggregate').mockResolvedValue(mockAggregates);

    mockDb.where.mockResolvedValue([]);

    await processor.process({
      data: { reportId: 'report-1' },
    } as unknown as Job<{ reportId: string }>);

    // Verify status was set to 'processing' then 'completed'
    const setCalls = mockDb.set.mock.calls;
    expect(setCalls[0][0]).toEqual({ status: 'processing' });
    expect(setCalls[1][0]).toMatchObject({
      status: 'completed',
      result: mockAggregates,
      completedAt: expect.any(Date),
    });
  });

  it('marks report as failed and preserves error cause on processor error', async () => {
    const originalError = new Error('DB connection lost');
    jest.spyOn(processor as any, 'aggregate').mockRejectedValue(originalError);

    mockDb.where.mockResolvedValue([]);

    try {
      await processor.process({
        data: { reportId: 'report-1' },
      } as unknown as Job<{ reportId: string }>);
      fail('Expected processor.process to throw');
    } catch (err) {
      expect((err as Error).cause).toBe(originalError);
    }

    const setCalls = mockDb.set.mock.calls;
    expect(setCalls.at(-1)[0]).toEqual({ status: 'failed' });
  });
});
