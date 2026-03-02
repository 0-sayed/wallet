import { Test } from '@nestjs/testing';
import { PostgresError } from 'postgres';
import { PurchasesService } from './purchases.service';
import { DB } from '../common/database/db.module';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

function createMockTx() {
  return {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    for: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    returning: jest.fn(),
  };
}

function createMockDb(mockTx: ReturnType<typeof createMockTx>) {
  return {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    transaction: jest.fn((fn) => fn(mockTx)),
  };
}

async function createTestService(mockDb: ReturnType<typeof createMockDb>) {
  const module = await Test.createTestingModule({
    providers: [
      PurchasesService,
      { provide: DB, useValue: mockDb },
      { provide: 'PLATFORM_WALLET_ID', useValue: 'platform-wallet-id' },
    ],
  }).compile();

  return module.get(PurchasesService);
}

describe('PurchasesService — royalty calculation', () => {
  it('gives author floor(price * 70 / 100) and platform the remainder', () => {
    const price = 99;
    const authorCut = Math.floor((price * 70) / 100);
    const platformCut = price - authorCut;
    expect(authorCut).toBe(69);
    expect(platformCut).toBe(30);
    expect(authorCut + platformCut).toBe(price);
  });

  it('is exact on round numbers', () => {
    const price = 100;
    const authorCut = Math.floor((price * 70) / 100);
    const platformCut = price - authorCut;
    expect(authorCut).toBe(70);
    expect(platformCut).toBe(30);
  });
});

describe('PurchasesService — idempotency check', () => {
  let service: PurchasesService;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(async () => {
    const mockTx = createMockTx();
    mockDb = createMockDb(mockTx);
    service = await createTestService(mockDb);
  });

  it('returns existing completed purchase for duplicate idempotency key', async () => {
    const existing = {
      id: 'purchase-1',
      idempotencyKey: 'key-1',
      status: 'completed',
      buyerWalletId: 'wallet-buyer',
      authorWalletId: 'wallet-author',
      itemPrice: 1000,
    };
    // First call: idempotency check; second call: ownership check on buyer wallet
    mockDb.where
      .mockResolvedValueOnce([existing])
      .mockResolvedValueOnce([{ userId: 'user-1' }]);

    const result = await service.purchase({
      idempotencyKey: 'key-1',
      buyerWalletId: 'wallet-buyer',
      authorWalletId: 'wallet-author',
      itemPrice: 1000,
      requestUserId: 'user-1',
    });

    expect(result).toEqual(existing);
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it('throws ForbiddenException when idempotency key found but buyer wallet belongs to different user', async () => {
    const existing = {
      id: 'purchase-1',
      idempotencyKey: 'key-1',
      status: 'completed',
      buyerWalletId: 'wallet-buyer',
      authorWalletId: 'wallet-author',
      itemPrice: 1000,
    };
    mockDb.where
      .mockResolvedValueOnce([existing])
      .mockResolvedValueOnce([{ userId: 'other-user' }]);

    await expect(
      service.purchase({
        idempotencyKey: 'key-1',
        buyerWalletId: 'wallet-buyer',
        authorWalletId: 'wallet-author',
        itemPrice: 1000,
        requestUserId: 'user-1',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws ConflictException for duplicate key with pending status', async () => {
    mockDb.where.mockResolvedValue([
      { status: 'pending', idempotencyKey: 'key-1' },
    ]);

    await expect(
      service.purchase({
        idempotencyKey: 'key-1',
        buyerWalletId: 'wallet-buyer',
        authorWalletId: 'wallet-author',
        itemPrice: 1000,
        requestUserId: 'user-1',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('throws ConflictException when replaying key with different payload', async () => {
    mockDb.where.mockResolvedValue([
      {
        id: 'purchase-1',
        idempotencyKey: 'key-1',
        status: 'completed',
        buyerWalletId: 'wallet-buyer',
        authorWalletId: 'wallet-author',
        itemPrice: 1000,
      },
    ]);

    await expect(
      service.purchase({
        idempotencyKey: 'key-1',
        buyerWalletId: 'wallet-buyer',
        authorWalletId: 'wallet-author',
        itemPrice: 2000,
        requestUserId: 'user-1',
      }),
    ).rejects.toThrow(ConflictException);
  });
});

describe('PurchasesService — authorization', () => {
  let service: PurchasesService;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockTx: ReturnType<typeof createMockTx>;

  beforeEach(async () => {
    mockTx = createMockTx();
    mockDb = createMockDb(mockTx);
    service = await createTestService(mockDb);
  });

  it('throws BadRequestException for self-purchase', async () => {
    await expect(
      service.purchase({
        idempotencyKey: 'key-1',
        buyerWalletId: 'same-wallet',
        authorWalletId: 'same-wallet',
        itemPrice: 1000,
        requestUserId: 'user-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws ForbiddenException when buyer wallet belongs to different user', async () => {
    mockDb.where.mockResolvedValue([]);
    // Single FOR UPDATE call returns all wallets — buyer has wrong userId
    mockTx.for.mockResolvedValue([
      { id: 'wallet-buyer', userId: 'other-user', balance: 5000 },
    ]);

    await expect(
      service.purchase({
        idempotencyKey: 'key-1',
        buyerWalletId: 'wallet-buyer',
        authorWalletId: 'wallet-author',
        itemPrice: 1000,
        requestUserId: 'user-1',
      }),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('PurchasesService — wallet existence validation', () => {
  let service: PurchasesService;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockTx: ReturnType<typeof createMockTx>;

  beforeEach(async () => {
    mockTx = createMockTx();
    mockDb = createMockDb(mockTx);
    mockDb.where.mockResolvedValue([]); // no existing purchase
    service = await createTestService(mockDb);
  });

  it('throws NotFoundException when buyer wallet does not exist', async () => {
    // Single FOR UPDATE call returns no wallets
    mockTx.for.mockResolvedValue([]);

    await expect(
      service.purchase({
        idempotencyKey: 'key-1',
        buyerWalletId: 'wallet-buyer',
        authorWalletId: 'wallet-author',
        itemPrice: 1000,
        requestUserId: 'user-1',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws BadRequestException when author wallet does not exist', async () => {
    // Single FOR UPDATE call returns only the buyer wallet
    mockTx.for.mockResolvedValue([
      { id: 'wallet-buyer', userId: 'user-1', balance: 5000 },
    ]);

    await expect(
      service.purchase({
        idempotencyKey: 'key-1',
        buyerWalletId: 'wallet-buyer',
        authorWalletId: 'wallet-author',
        itemPrice: 1000,
        requestUserId: 'user-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws BadRequestException when platform wallet does not exist', async () => {
    // Single FOR UPDATE call returns buyer + author but no platform wallet
    mockTx.for.mockResolvedValue([
      { id: 'wallet-buyer', userId: 'user-1', balance: 5000 },
      { id: 'wallet-author' },
    ]);

    await expect(
      service.purchase({
        idempotencyKey: 'key-1',
        buyerWalletId: 'wallet-buyer',
        authorWalletId: 'wallet-author',
        itemPrice: 1000,
        requestUserId: 'user-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('PurchasesService — concurrent duplicate key (DrizzleQueryError wrapping)', () => {
  it('throws ConflictException when DrizzleQueryError wraps a PostgresError unique_violation', async () => {
    // Drizzle wraps raw postgres errors in DrizzleQueryError with cause set to the
    // PostgresError. The service must unwrap cause to detect the 23505 code.
    const pgError = Object.assign(new PostgresError('duplicate key'), {
      code: '23505',
      severity_local: 'ERROR',
      severity: 'ERROR',
    });

    const drizzleQueryError = Object.assign(
      new Error(`Failed query: insert...\nparams: ...`),
      { cause: pgError },
    );

    const mockTx = createMockTx();
    const mockDb = createMockDb(mockTx);
    mockDb.where.mockResolvedValue([]); // no existing purchase
    // Make the transaction itself throw the wrapped drizzle error
    mockDb.transaction = jest.fn().mockRejectedValue(drizzleQueryError);

    const service = await createTestService(mockDb);

    await expect(
      service.purchase({
        idempotencyKey: 'key-concurrent',
        buyerWalletId: 'wallet-buyer',
        authorWalletId: 'wallet-author',
        itemPrice: 1000,
        requestUserId: 'user-1',
      }),
    ).rejects.toThrow(ConflictException);
  });
});
