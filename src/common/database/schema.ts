import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  timestamp,
  pgEnum,
  uniqueIndex,
  jsonb,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const purchaseStatusEnum = pgEnum('purchase_status', [
  'pending',
  'completed',
  'failed',
]);

export const ledgerTypeEnum = pgEnum('ledger_type', [
  'deposit',
  'purchase',
  'royalty_author',
  'royalty_platform',
]);

export const ledgerDirectionEnum = pgEnum('ledger_direction', [
  'credit',
  'debit',
]);

export const reportStatusEnum = pgEnum('report_status', [
  'queued',
  'processing',
  'completed',
  'failed',
]);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const wallets = pgTable(
  'wallets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id)
      .notNull(),
    balance: integer('balance').notNull().default(0),
    fractionalBalance: integer('fractional_balance').notNull().default(0),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('wallets_user_id_idx').on(table.userId),
    check('wallets_balance_non_negative', sql`${table.balance} >= 0`),
    check(
      'wallets_fractional_balance_non_negative',
      sql`${table.fractionalBalance} >= 0`,
    ),
    check(
      'wallets_fractional_balance_lt_100',
      sql`${table.fractionalBalance} < 100`,
    ),
  ],
);

export const purchases = pgTable(
  'purchases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    idempotencyKey: text('idempotency_key').notNull(),
    buyerWalletId: uuid('buyer_wallet_id')
      .references(() => wallets.id)
      .notNull(),
    authorWalletId: uuid('author_wallet_id')
      .references(() => wallets.id)
      .notNull(),
    itemPrice: integer('item_price').notNull(),
    status: purchaseStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('purchases_idempotency_key_idx').on(table.idempotencyKey),
    check('purchases_item_price_positive', sql`${table.itemPrice} > 0`),
  ],
);

export const ledger = pgTable(
  'ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    walletId: uuid('wallet_id')
      .references(() => wallets.id)
      .notNull(),
    type: ledgerTypeEnum('type').notNull(),
    direction: ledgerDirectionEnum('direction').notNull(),
    amount: integer('amount').notNull(),
    purchaseId: uuid('purchase_id').references(() => purchases.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [check('ledger_amount_positive', sql`${table.amount} > 0`)],
);

export const reports = pgTable('reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  status: reportStatusEnum('status').notNull().default('queued'),
  result: jsonb('result'),
  requestedBy: uuid('requested_by')
    .references(() => users.id)
    .notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
});

export const ledgerTotals = pgTable('ledger_totals', {
  type: ledgerTypeEnum('type').primaryKey(),
  // mode:'number' is safe: max expected total ~100B << Number.MAX_SAFE_INTEGER (~9e15)
  total: bigint('total', { mode: 'number' }).notNull().default(0),
});
