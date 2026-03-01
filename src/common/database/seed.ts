// src/common/database/seed.ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as dotenv from 'dotenv';
import { users, wallets } from './schema';

dotenv.config();

// Preflight: fail fast if required env vars are missing
const DATABASE_URL = process.env.DATABASE_URL;
const PLATFORM_ID = process.env.PLATFORM_ACCOUNT_ID;
const PLATFORM_WALLET_ID = process.env.PLATFORM_WALLET_ID;

if (!DATABASE_URL || !PLATFORM_ID || !PLATFORM_WALLET_ID) {
  console.error(
    'Missing required environment variables: DATABASE_URL, PLATFORM_ACCOUNT_ID, and PLATFORM_WALLET_ID must be set.',
  );
  process.exit(1);
}

const databaseUrl: string = DATABASE_URL;
const platformId: string = PLATFORM_ID;
const platformWalletId: string = PLATFORM_WALLET_ID;

const ALICE_ID = '00000000-0000-0000-0000-000000000010';
const ALICE_WALLET_ID = '00000000-0000-0000-0000-000000000011';
const BOB_ID = '00000000-0000-0000-0000-000000000020';
const BOB_WALLET_ID = '00000000-0000-0000-0000-000000000021';

async function seed() {
  const client = postgres(databaseUrl);
  const db = drizzle({ client });

  try {
    console.log('Seeding...');

    await db
      .insert(users)
      .values([
        { id: platformId, name: 'Platform' },
        { id: ALICE_ID, name: 'Alice (buyer)' },
        { id: BOB_ID, name: 'Bob (author)' },
      ])
      .onConflictDoNothing();

    await db
      .insert(wallets)
      .values([
        { id: platformWalletId, userId: platformId, balance: 0 },
        { id: ALICE_WALLET_ID, userId: ALICE_ID, balance: 10000 },
        { id: BOB_WALLET_ID, userId: BOB_ID, balance: 0 },
      ])
      .onConflictDoNothing();

    console.log('Seed complete.');
    console.log(
      'Alice (buyer):',
      ALICE_ID,
      '| wallet:',
      ALICE_WALLET_ID,
      '| balance: 10000 cents',
    );
    console.log(
      'Bob (author): ',
      BOB_ID,
      '| wallet:',
      BOB_WALLET_ID,
      '| balance: 0 cents',
    );
    console.log('Platform:     ', platformId, '| wallet:', platformWalletId);
  } catch (error) {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

void seed();
