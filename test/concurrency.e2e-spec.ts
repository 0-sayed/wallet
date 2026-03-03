// test/concurrency.e2e-spec.ts
import crypto from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { eq } from 'drizzle-orm';
import { AppModule } from '../src/app.module';
import { DB, AppDatabase } from '../src/common/database/db.module';
import * as schema from '../src/common/database/schema';

const ALICE_ID = crypto.randomUUID();
const ALICE_WALLET_ID = crypto.randomUUID();
const BOB_ID = crypto.randomUUID();
const BOB_WALLET_ID = crypto.randomUUID();
const PLATFORM_ID =
  process.env.PLATFORM_ACCOUNT_ID ?? '00000000-0000-0000-0000-000000000001';
const PLATFORM_WALLET_ID =
  process.env.PLATFORM_WALLET_ID ?? '00000000-0000-0000-0000-000000000002';

describe('Concurrency (e2e)', () => {
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

    // Provision test fixtures
    // Platform rows: fixed IDs from env — idempotent across runs
    // Alice/Bob rows: random UUIDs — no conflict possible, no onConflictDoNothing
    await db.transaction(async (tx) => {
      await tx
        .insert(schema.users)
        .values({ id: PLATFORM_ID, name: 'Platform' })
        .onConflictDoNothing();
      await tx.insert(schema.users).values([
        { id: ALICE_ID, name: 'Alice (buyer)' },
        { id: BOB_ID, name: 'Bob (author)' },
      ]);

      await tx
        .insert(schema.wallets)
        .values({ id: PLATFORM_WALLET_ID, userId: PLATFORM_ID, balance: 0 })
        .onConflictDoNothing();
      await tx.insert(schema.wallets).values([
        { id: ALICE_WALLET_ID, userId: ALICE_ID, balance: 0 },
        { id: BOB_WALLET_ID, userId: BOB_ID, balance: 0 },
      ]);
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('parallel purchases against same wallet — only affordable ones succeed', async () => {
    // Reset Alice to exactly 10000 cents for deterministic results
    await db
      .update(schema.wallets)
      .set({ balance: 10000 })
      .where(eq(schema.wallets.id, ALICE_WALLET_ID));

    // Fire 10 concurrent $20.00 purchases against Alice's $100.00 wallet
    const promises = Array.from({ length: 10 }, () =>
      request(app.getHttpServer())
        .post('/purchases')
        .set('X-User-Id', ALICE_ID)
        .set('Idempotency-Key', crypto.randomUUID())
        .send({
          buyerWalletId: ALICE_WALLET_ID,
          authorWalletId: BOB_WALLET_ID,
          itemPrice: 2000,
        }),
    );

    const results = await Promise.all(promises);

    const successes = results.filter(
      (r) => r.status === 201 || r.status === 200,
    );
    const failures = results.filter((r) => r.status === 402);

    // Alice has $100 = 10000 cents. Each purchase is $20 = 2000 cents.
    // Exactly 5 should succeed, 5 should fail with insufficient funds.
    expect(successes.length).toBe(5);
    expect(failures.length).toBe(5);
  });

  it('duplicate idempotency key — only one succeeds, rest get 409 or original', async () => {
    // Reset all three wallets to known balances for this test
    await db
      .update(schema.wallets)
      .set({ balance: 5000 })
      .where(eq(schema.wallets.id, ALICE_WALLET_ID));
    await db
      .update(schema.wallets)
      .set({ balance: 0 })
      .where(eq(schema.wallets.id, BOB_WALLET_ID));
    await db
      .update(schema.wallets)
      .set({ balance: 0 })
      .where(eq(schema.wallets.id, PLATFORM_WALLET_ID));

    const SHARED_KEY = crypto.randomUUID();

    // Fire 5 concurrent purchases with the same idempotency key
    const promises = Array.from({ length: 5 }, () =>
      request(app.getHttpServer())
        .post('/purchases')
        .set('X-User-Id', ALICE_ID)
        .set('Idempotency-Key', SHARED_KEY)
        .send({
          buyerWalletId: ALICE_WALLET_ID,
          authorWalletId: BOB_WALLET_ID,
          itemPrice: 1000,
        }),
    );

    const results = await Promise.all(promises);

    const successes = results.filter(
      (r) => r.status === 200 || r.status === 201,
    );
    const conflicts = results.filter((r) => r.status === 409);

    // Status assertions — exactly one should succeed
    expect(successes.length + conflicts.length).toBe(5);
    expect(successes.length).toBeGreaterThanOrEqual(1);

    // DB assertions — verify exactly-once financial side effects
    const purchaseRows = await db
      .select()
      .from(schema.purchases)
      .where(eq(schema.purchases.idempotencyKey, SHARED_KEY));
    expect(purchaseRows).toHaveLength(1);

    const ledgerRows = await db
      .select()
      .from(schema.ledger)
      .where(eq(schema.ledger.purchaseId, purchaseRows[0].id));
    expect(ledgerRows).toHaveLength(3); // debit + author credit + platform credit

    // Verify wallet balances: Alice charged once (-1000), Bob +700, Platform +300
    const [alice] = await db
      .select({ balance: schema.wallets.balance })
      .from(schema.wallets)
      .where(eq(schema.wallets.id, ALICE_WALLET_ID));
    const [bob] = await db
      .select({ balance: schema.wallets.balance })
      .from(schema.wallets)
      .where(eq(schema.wallets.id, BOB_WALLET_ID));
    const [platform] = await db
      .select({ balance: schema.wallets.balance })
      .from(schema.wallets)
      .where(eq(schema.wallets.id, PLATFORM_WALLET_ID));

    expect(alice.balance).toBe(4000); // 5000 - 1000
    expect(bob.balance).toBe(700); // 0 + floor(1000 * 0.70)
    expect(platform.balance).toBe(300); // 0 + (1000 - 700)
  });
});
