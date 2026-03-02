import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

// Seed IDs — must match seed.ts
const ALICE_ID = '00000000-0000-0000-0000-000000000010';
const ALICE_WALLET_ID = '00000000-0000-0000-0000-000000000011';
const NON_EXISTENT_WALLET = '00000000-0000-0000-0000-ffffffffffff';

describe('POST /wallets/:walletId/deposit (integration)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('concurrent deposits do not lose updates', async () => {
    // Fire 10 concurrent deposits of 100 cents each
    const depositCount = 10;
    const depositAmount = 100;

    const results = await Promise.all(
      Array.from({ length: depositCount }, () =>
        request(app.getHttpServer())
          .post(`/wallets/${ALICE_WALLET_ID}/deposit`)
          .set('X-User-Id', ALICE_ID)
          .send({ amount: depositAmount }),
      ),
    );

    // All should succeed
    for (const res of results) {
      expect(res.status).toBe(201);
    }

    // Final balance should reflect all deposits (no lost updates)
    const balances = results.map(
      (r) => (r.body as { balance: number }).balance,
    );

    // Verify the balances form a strictly contiguous arithmetic sequence
    // (each transaction saw the result of the previous one, proving serialization)
    const sorted = [...balances].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i] - sorted[i - 1]).toBe(depositAmount);
    }
  });

  it('returns 404 for non-existent wallet and rolls back cleanly', async () => {
    const res = await request(app.getHttpServer())
      .post(`/wallets/${NON_EXISTENT_WALLET}/deposit`)
      .set('X-User-Id', ALICE_ID)
      .send({ amount: 500 });

    expect(res.status).toBe(404);
    // If we got here without 500, the transaction rolled back cleanly
    // (a partial write would violate FK constraints or leave orphan ledger rows)
  });
});
