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

describe('PurchasesService — centi-cent accrual', () => {
  it('gives author floor + 0 sweep when accrual stays below 100 centi-cents', () => {
    const price = 99;
    const AUTHOR_ROYALTY_PERCENT = 70;
    const CENTI_CENTS = 100;
    const fractionalBalance = 0;

    const exactNumerator = price * AUTHOR_ROYALTY_PERCENT; // 6930
    const authorFloorCents = Math.floor(exactNumerator / 100); // 69
    const remainderCentiCents = exactNumerator % 100; // 30
    const newFractional = fractionalBalance + remainderCentiCents; // 30
    const sweepCents = Math.floor(newFractional / CENTI_CENTS); // 0
    const leftoverCenti = newFractional % CENTI_CENTS; // 30
    const totalAuthorCents = authorFloorCents + sweepCents; // 69
    const platformCut = price - totalAuthorCents; // 30

    expect(totalAuthorCents).toBe(69);
    expect(platformCut).toBe(30);
    expect(totalAuthorCents + platformCut).toBe(price);
    expect(leftoverCenti).toBe(30);
  });

  it('sweeps 1 cent when accumulated centi-cents cross 100', () => {
    const price = 99;
    const AUTHOR_ROYALTY_PERCENT = 70;
    const CENTI_CENTS = 100;
    const fractionalBalance = 80; // author already has 80 centi-cents

    const exactNumerator = price * AUTHOR_ROYALTY_PERCENT; // 6930
    const authorFloorCents = Math.floor(exactNumerator / 100); // 69
    const remainderCentiCents = exactNumerator % 100; // 30
    const newFractional = fractionalBalance + remainderCentiCents; // 110
    const sweepCents = Math.floor(newFractional / CENTI_CENTS); // 1
    const leftoverCenti = newFractional % CENTI_CENTS; // 10
    const totalAuthorCents = authorFloorCents + sweepCents; // 70
    const platformCut = price - totalAuthorCents; // 29

    expect(totalAuthorCents).toBe(70);
    expect(platformCut).toBe(29);
    expect(totalAuthorCents + platformCut).toBe(price);
    expect(leftoverCenti).toBe(10);
  });

  it('produces zero royalty_author cents for itemPrice=1 with no accumulated accrual', () => {
    const price = 1;
    const AUTHOR_ROYALTY_PERCENT = 70;
    const CENTI_CENTS = 100;
    const fractionalBalance = 0;

    const exactNumerator = price * AUTHOR_ROYALTY_PERCENT; // 70
    const authorFloorCents = Math.floor(exactNumerator / CENTI_CENTS); // 0
    const remainderCentiCents = exactNumerator % CENTI_CENTS; // 70
    const newFractional = fractionalBalance + remainderCentiCents; // 70
    const sweepCents = Math.floor(newFractional / CENTI_CENTS); // 0
    const leftoverCenti = newFractional % CENTI_CENTS; // 70
    const totalAuthorCents = authorFloorCents + sweepCents; // 0
    const platformCut = price - totalAuthorCents; // 1

    expect(totalAuthorCents).toBe(0); // no cents owed to author yet
    expect(platformCut).toBe(1);
    expect(totalAuthorCents + platformCut).toBe(price);
    expect(leftoverCenti).toBe(70); // accrued — will be swept later
  });

  it('has zero remainder on round amounts', () => {
    const price = 100;
    const AUTHOR_ROYALTY_PERCENT = 70;
    const CENTI_CENTS = 100;
    const fractionalBalance = 0;

    const exactNumerator = price * AUTHOR_ROYALTY_PERCENT; // 7000
    const authorFloorCents = Math.floor(exactNumerator / 100); // 70
    const remainderCentiCents = exactNumerator % 100; // 0
    const newFractional = fractionalBalance + remainderCentiCents; // 0
    const sweepCents = Math.floor(newFractional / CENTI_CENTS); // 0
    const leftoverCenti = newFractional % CENTI_CENTS; // 0
    const totalAuthorCents = authorFloorCents + sweepCents; // 70
    const platformCut = price - totalAuthorCents; // 30

    expect(totalAuthorCents).toBe(70);
    expect(platformCut).toBe(30);
    expect(leftoverCenti).toBe(0);
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

describe('PurchasesService — happy path accrual integration', () => {
  let service: PurchasesService;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockTx: ReturnType<typeof createMockTx>;

  beforeEach(async () => {
    mockTx = createMockTx();
    mockDb = createMockDb(mockTx);
    mockDb.where.mockResolvedValue([]); // no existing purchase
    service = await createTestService(mockDb);
  });

  it('sets fractionalBalance to leftover centi-cents in the author wallet update', async () => {
    // author has 80 centi-cents; itemPrice=99 adds 30 centi-cents => 110 => sweep 1, leftover 10
    mockTx.for.mockResolvedValue([
      {
        id: 'wallet-buyer',
        userId: 'user-1',
        balance: 5000,
        fractionalBalance: 0,
      },
      {
        id: 'wallet-author',
        userId: 'author-user',
        balance: 0,
        fractionalBalance: 80,
      },
      {
        id: 'platform-wallet-id',
        userId: 'platform-user',
        balance: 0,
        fractionalBalance: 0,
      },
    ]);
    mockTx.returning.mockResolvedValueOnce([
      {
        id: 'purchase-1',
        idempotencyKey: 'key-1',
        status: 'completed',
        buyerWalletId: 'wallet-buyer',
        authorWalletId: 'wallet-author',
        itemPrice: 99,
        createdAt: new Date(),
      },
    ]);

    await service.purchase({
      idempotencyKey: 'key-1',
      buyerWalletId: 'wallet-buyer',
      authorWalletId: 'wallet-author',
      itemPrice: 99,
      requestUserId: 'user-1',
    });

    // set calls: [0] buyer, [1] author (has fractionalBalance), [2] platform
    const authorSetArgs = mockTx.set.mock.calls[1][0];
    expect(authorSetArgs.fractionalBalance).toBe(10);
  });
});
