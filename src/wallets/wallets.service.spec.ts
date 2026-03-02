import { Test } from '@nestjs/testing';
import { WalletsService } from './wallets.service';
import { DB } from '../common/database/db.module';
import { BadRequestException, NotFoundException } from '@nestjs/common';

const mockWallet = {
  id: 'wallet-1',
  userId: 'user-1',
  balance: 5000,
  updatedAt: new Date(),
};

type MockTx = ReturnType<typeof makeTx>;

function makeTx(
  overrides: { selectResult?: unknown[]; updateResult?: unknown[] } = {},
) {
  const { selectResult = [], updateResult = [] } = overrides;
  return {
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          for: jest.fn().mockResolvedValue(selectResult),
        }),
      }),
    }),
    update: jest.fn().mockReturnValue({
      set: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue(updateResult),
        }),
      }),
    }),
    insert: jest.fn().mockReturnValue({
      values: jest.fn().mockResolvedValue(undefined),
    }),
  };
}

describe('WalletsService', () => {
  let service: WalletsService;
  let mockDb: { transaction: jest.Mock };

  beforeEach(async () => {
    mockDb = {
      transaction: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [WalletsService, { provide: DB, useValue: mockDb }],
    }).compile();

    service = module.get(WalletsService);
  });

  describe('deposit', () => {
    it('throws BadRequestException if amount is 0 or negative', async () => {
      await expect(service.deposit('wallet-1', 0)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.deposit('wallet-1', -100)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException if wallet does not exist', async () => {
      const tx = makeTx({ selectResult: [] });
      mockDb.transaction.mockImplementation((cb: (tx: MockTx) => unknown) =>
        cb(tx),
      );

      await expect(service.deposit('wallet-1', 100)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns updated balance on success', async () => {
      const updatedWallet = { ...mockWallet, balance: 5100 };
      const tx = makeTx({
        selectResult: [mockWallet],
        updateResult: [updatedWallet],
      });
      mockDb.transaction.mockImplementation((cb: (tx: MockTx) => unknown) =>
        cb(tx),
      );

      const result = await service.deposit('wallet-1', 100);
      expect(result.balance).toBe(5100);
      expect(tx.insert).toHaveBeenCalled();
    });
  });
});
