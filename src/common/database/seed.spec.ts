const mockEnd = jest.fn().mockResolvedValue(undefined);
const mockOnConflictDoNothing = jest.fn().mockResolvedValue(undefined);
const mockValues = jest
  .fn()
  .mockReturnValue({ onConflictDoNothing: mockOnConflictDoNothing });
const mockInsert = jest.fn().mockReturnValue({ values: mockValues });
const mockTransaction = jest
  .fn()
  .mockImplementation(
    async (cb: (tx: { insert: jest.Mock }) => Promise<void>) => {
      await cb({ insert: mockInsert });
    },
  );

jest.mock('postgres', () => jest.fn(() => ({ end: mockEnd })));
jest.mock('drizzle-orm/postgres-js', () => ({
  drizzle: jest.fn(() => ({ transaction: mockTransaction })),
}));
jest.mock('dotenv', () => ({ config: jest.fn() }));

import { seed } from './seed';
import { users, wallets } from './schema';

describe('seed', () => {
  const originalEnv = process.env;
  const validEnv = {
    DATABASE_URL: 'postgres://test:test@localhost:5432/test',
    PLATFORM_ACCOUNT_ID: '00000000-0000-0000-0000-000000000001',
    PLATFORM_WALLET_ID: '00000000-0000-0000-0000-000000000002',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.exitCode = undefined;
    process.env = { ...originalEnv, ...validEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    process.exitCode = undefined;
  });

  describe('when required env vars are missing', () => {
    it('sets exitCode to 1 when DATABASE_URL is missing', async () => {
      delete process.env.DATABASE_URL;
      await seed();
      expect(process.exitCode).toBe(1);
    });

    it('sets exitCode to 1 when PLATFORM_ACCOUNT_ID is missing', async () => {
      delete process.env.PLATFORM_ACCOUNT_ID;
      await seed();
      expect(process.exitCode).toBe(1);
    });

    it('sets exitCode to 1 when PLATFORM_WALLET_ID is missing', async () => {
      delete process.env.PLATFORM_WALLET_ID;
      await seed();
      expect(process.exitCode).toBe(1);
    });

    it('does not connect to the database', async () => {
      delete process.env.DATABASE_URL;
      const postgres = jest.requireMock<jest.Mock>('postgres');
      await seed();
      expect(postgres).not.toHaveBeenCalled();
    });
  });

  describe('when env vars are present', () => {
    it('inserts users and wallets in a transaction', async () => {
      await seed();

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockInsert).toHaveBeenCalledTimes(2);
      expect(mockInsert).toHaveBeenCalledWith(users);
      expect(mockInsert).toHaveBeenCalledWith(wallets);
    });

    it('calls client.end() after success', async () => {
      await seed();
      expect(mockEnd).toHaveBeenCalledTimes(1);
    });

    it('does not set exitCode on success', async () => {
      await seed();
      expect(process.exitCode).toBeUndefined();
    });
  });

  describe('when transaction fails', () => {
    const transactionError = new Error('insert failed');

    beforeEach(() => {
      mockTransaction.mockRejectedValueOnce(transactionError);
    });

    it('sets exitCode to 1', async () => {
      await seed();
      expect(process.exitCode).toBe(1);
    });

    it('still calls client.end()', async () => {
      await seed();
      expect(mockEnd).toHaveBeenCalledTimes(1);
    });
  });
});
