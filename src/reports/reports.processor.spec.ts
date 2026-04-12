// src/reports/reports.processor.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';
import { ReportsProcessor } from './reports.processor';
import { DB } from '../common/database/db.module';
import * as schema from '../common/database/schema';

describe('ReportsProcessor', () => {
  let processor: ReportsProcessor;
  let mockDb: any;

  const mockAggregates = {
    totalDeposited: 15000,
    totalPurchaseVolume: 8000,
    totalRoyaltiesPaid: 5600,
    platformRevenue: 2400,
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

  it('reads totals from ledger_totals (O(1) — no GROUP BY scan)', async () => {
    const totalsRows = [
      { type: 'deposit', total: 15000 },
      { type: 'purchase', total: 8000 },
      { type: 'royalty_author', total: 5600 },
      { type: 'royalty_platform', total: 2400 },
    ];
    // Override from() to resolve with totals rows for this test
    mockDb.from.mockResolvedValueOnce(totalsRows);

    const result = await (processor as any).aggregate();

    expect(result).toEqual({
      totalDeposited: 15000,
      totalPurchaseVolume: 8000,
      totalRoyaltiesPaid: 5600,
      platformRevenue: 2400,
      generatedAt: expect.any(String),
    });
    // groupBy must not have been called — we no longer scan the ledger
    expect(mockDb.from).toHaveBeenCalledWith(schema.ledgerTotals);
    expect(mockDb.groupBy).toBeUndefined();
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
