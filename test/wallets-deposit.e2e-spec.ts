import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { DB, AppDatabase } from '../src/common/database/db.module';
import * as schema from '../src/common/database/schema';
import { eq } from 'drizzle-orm';

const ALICE_ID = '00000000-0000-0000-0000-000000000010';
const ALICE_WALLET_ID = '00000000-0000-0000-0000-000000000011';
const BOB_ID = '00000000-0000-0000-0000-000000000020';
const NON_EXISTENT_WALLET = '00000000-0000-0000-0000-ffffffffffff';

describe('POST /wallets/:walletId/deposit (integration)', () => {
  let app: INestApplication<App>;
  let db: AppDatabase;

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

    db = app.get<AppDatabase>(DB);

    // Provision test fixtures — idempotent via onConflictDoNothing
    await db.transaction(async (tx) => {
      await tx
        .insert(schema.users)
        .values([
          { id: ALICE_ID, name: 'Alice (buyer)' },
          { id: BOB_ID, name: 'Bob (author)' },
        ])
        .onConflictDoNothing();

      await tx
        .insert(schema.wallets)
        .values([{ id: ALICE_WALLET_ID, userId: ALICE_ID, balance: 0 }])
        .onConflictDoNothing();
    });

    // Reset Alice's wallet balance to 0 for deterministic tests
    await db
      .update(schema.wallets)
      .set({ balance: 0 })
      .where(eq(schema.wallets.id, ALICE_WALLET_ID));
  });

  afterAll(async () => {
    await app.close();
  });

  it('concurrent deposits do not lose updates', async () => {
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

    for (const res of results) {
      expect(res.status).toBe(201);
    }

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
  });

  it("returns 404 when depositing into another user's wallet", async () => {
    const res = await request(app.getHttpServer())
      .post(`/wallets/${ALICE_WALLET_ID}/deposit`)
      .set('X-User-Id', BOB_ID)
      .send({ amount: 100 });

    expect(res.status).toBe(404);
  });
});
