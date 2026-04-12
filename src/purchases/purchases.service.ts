import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PostgresError } from 'postgres';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { AppDatabase } from '../common/database/db.module';
import { DB } from '../common/database/db.module';
import { REDIS_CLIENT } from '../common/redis/redis.module';
import * as schema from '../common/database/schema';

const AUTHOR_ROYALTY_PERCENT = 70;
const CENTI_CENTS = 100;
const PG_UNIQUE_VIOLATION = '23505';
const PG_DEADLOCK = '40P01';
const IDEMPOTENCY_TTL = 86400;

interface PurchaseDto {
  idempotencyKey: string;
  buyerWalletId: string;
  authorWalletId: string;
  itemPrice: number;
  requestUserId: string;
}

@Injectable()
export class PurchasesService {
  private readonly logger = new Logger(PurchasesService.name);

  constructor(
    @Inject(DB) private db: AppDatabase,
    @Inject('PLATFORM_WALLET_ID') private platformWalletId: string,
    @Inject(REDIS_CLIENT) private redis: Redis,
  ) {}

  async purchase(dto: PurchaseDto) {
    // Self-purchase guard
    if (dto.buyerWalletId === dto.authorWalletId) {
      throw new BadRequestException(
        'Buyer and author wallets must be different',
      );
    }

    const redisKey = `idempotency:${dto.idempotencyKey}`;

    // Redis SETNX edge-cache — short-circuit before hitting the DB
    try {
      const nx = await this.redis.set(
        redisKey,
        'processing',
        'EX',
        IDEMPOTENCY_TTL,
        'NX',
      );

      if (nx === null) {
        // Key exists in Redis — cached result or in-flight
        const cached = await this.redis.get(redisKey);

        if (cached === 'processing') {
          throw new ConflictException(
            'Purchase with this idempotency key is still in flight',
          );
        }

        if (cached !== null) {
          // cached is a JSON-serialized purchase result
          const parsed = JSON.parse(cached) as {
            id: string;
            idempotencyKey: string;
            status: 'pending' | 'completed' | 'failed';
            buyerWalletId: string;
            authorWalletId: string;
            itemPrice: number;
            createdAt: string;
          };
          // Re-hydrate createdAt to a Date to match the DB return shape
          const cachedPurchase = {
            ...parsed,
            createdAt: new Date(parsed.createdAt),
          };

          // Payload drift check
          if (
            cachedPurchase.buyerWalletId !== dto.buyerWalletId ||
            cachedPurchase.authorWalletId !== dto.authorWalletId ||
            cachedPurchase.itemPrice !== dto.itemPrice
          ) {
            throw new ConflictException(
              'Idempotency key already used with different purchase parameters',
            );
          }

          // Ownership check (same as DB path)
          const [buyerWallet] = await this.db
            .select({ userId: schema.wallets.userId })
            .from(schema.wallets)
            .where(eq(schema.wallets.id, cachedPurchase.buyerWalletId));

          if (!buyerWallet || buyerWallet.userId !== dto.requestUserId) {
            throw new ForbiddenException(
              'Buyer wallet does not belong to the authenticated user',
            );
          }

          return cachedPurchase;
        }

        // cached === null: key was evicted between NX check and GET (eviction race)
        // Fall through to DB path to re-validate
      }

      // nx === 'OK' — new request, fall through to DB check
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      // Redis unavailable — log warning, fall through to DB
      this.logger.warn(
        { err: error },
        'Redis unavailable, falling through to DB path',
      );
    }

    // Idempotency check — outside transaction (read-only)
    const [existing] = await this.db
      .select({
        id: schema.purchases.id,
        idempotencyKey: schema.purchases.idempotencyKey,
        status: schema.purchases.status,
        buyerWalletId: schema.purchases.buyerWalletId,
        authorWalletId: schema.purchases.authorWalletId,
        itemPrice: schema.purchases.itemPrice,
        createdAt: schema.purchases.createdAt,
      })
      .from(schema.purchases)
      .where(eq(schema.purchases.idempotencyKey, dto.idempotencyKey));

    if (existing) {
      if (existing.status === 'completed') {
        // Payload drift check — same key must have same intent
        if (
          existing.buyerWalletId !== dto.buyerWalletId ||
          existing.authorWalletId !== dto.authorWalletId ||
          existing.itemPrice !== dto.itemPrice
        ) {
          throw new ConflictException(
            'Idempotency key already used with different purchase parameters',
          );
        }
        // Ownership check — prevent unauthorized access to purchase records via
        // replayed idempotency keys belonging to another user's transaction
        const [buyerWallet] = await this.db
          .select({ userId: schema.wallets.userId })
          .from(schema.wallets)
          .where(eq(schema.wallets.id, existing.buyerWalletId));
        if (!buyerWallet || buyerWallet.userId !== dto.requestUserId) {
          throw new ForbiddenException(
            'Buyer wallet does not belong to the authenticated user',
          );
        }
        // Populate Redis on DB cold-start hit
        try {
          await this.redis.set(
            redisKey,
            JSON.stringify(existing),
            'EX',
            IDEMPOTENCY_TTL,
          );
        } catch {
          /* Redis unavailable — ignore */
        }
        return existing;
      }
      throw new ConflictException(
        'Purchase with this idempotency key is still in flight',
      );
    }

    let result: typeof schema.purchases.$inferSelect;
    try {
      result = await this.db.transaction(async (tx) => {
        // Lock all three wallets in a single query. The .orderBy(asc(...))
        // below is what enforces consistent lock acquisition order in
        // PostgreSQL, eliminating the circular wait condition that causes
        // deadlocks.
        const walletIds = [
          dto.buyerWalletId,
          dto.authorWalletId,
          this.platformWalletId,
        ];

        const walletRows = await tx
          .select({
            id: schema.wallets.id,
            userId: schema.wallets.userId,
            balance: schema.wallets.balance,
            fractionalBalance: schema.wallets.fractionalBalance,
          })
          .from(schema.wallets)
          .where(inArray(schema.wallets.id, walletIds))
          .orderBy(asc(schema.wallets.id))
          .for('update');

        const buyerWallet = walletRows.find((w) => w.id === dto.buyerWalletId);
        const authorWallet = walletRows.find(
          (w) => w.id === dto.authorWalletId,
        );
        const platformWallet = walletRows.find(
          (w) => w.id === this.platformWalletId,
        );

        if (!buyerWallet) {
          throw new NotFoundException('Buyer wallet not found');
        }

        // Ownership check — buyer wallet must belong to the requesting user
        if (buyerWallet.userId !== dto.requestUserId) {
          throw new ForbiddenException(
            'Buyer wallet does not belong to the authenticated user',
          );
        }

        if (buyerWallet.balance < dto.itemPrice) {
          throw new HttpException(
            'Insufficient funds',
            HttpStatus.PAYMENT_REQUIRED,
          );
        }

        if (!authorWallet) {
          throw new BadRequestException('Author wallet does not exist');
        }

        if (!platformWallet) {
          throw new BadRequestException('Platform wallet does not exist');
        }

        // Centi-cent accrual — eliminates systematic author under-payment at scale
        const exactNumerator = dto.itemPrice * AUTHOR_ROYALTY_PERCENT;
        const authorFloorCents = Math.floor(exactNumerator / CENTI_CENTS);
        const remainderCentiCents = exactNumerator % CENTI_CENTS;

        const newFractional =
          authorWallet.fractionalBalance + remainderCentiCents;
        const sweepCents = Math.floor(newFractional / CENTI_CENTS);
        const leftoverCenti = newFractional % CENTI_CENTS;

        const totalAuthorCents = authorFloorCents + sweepCents;
        const platformCut = dto.itemPrice - totalAuthorCents;
        const now = new Date();

        // Deduct from buyer
        await tx
          .update(schema.wallets)
          .set({
            balance: sql`${schema.wallets.balance} - ${dto.itemPrice}`,
            updatedAt: now,
          })
          .where(eq(schema.wallets.id, dto.buyerWalletId));

        // Credit author (with centi-cent sweep if accrual crossed 100)
        await tx
          .update(schema.wallets)
          .set({
            balance: sql`${schema.wallets.balance} + ${totalAuthorCents}`,
            fractionalBalance: leftoverCenti,
            updatedAt: now,
          })
          .where(eq(schema.wallets.id, dto.authorWalletId));

        // Credit platform
        await tx
          .update(schema.wallets)
          .set({
            balance: sql`${schema.wallets.balance} + ${platformCut}`,
            updatedAt: now,
          })
          .where(eq(schema.wallets.id, this.platformWalletId));

        // Record purchase
        const [purchase] = await tx
          .insert(schema.purchases)
          .values({
            idempotencyKey: dto.idempotencyKey,
            buyerWalletId: dto.buyerWalletId,
            authorWalletId: dto.authorWalletId,
            itemPrice: dto.itemPrice,
            status: 'completed',
          })
          .returning();

        // Ledger entries — filter out zero-amount entries to satisfy CHECK (amount > 0)
        const ledgerEntries = [
          {
            walletId: dto.buyerWalletId,
            type: 'purchase' as const,
            direction: 'debit' as const,
            amount: dto.itemPrice,
            purchaseId: purchase.id,
          },
          {
            walletId: dto.authorWalletId,
            type: 'royalty_author' as const,
            direction: 'credit' as const,
            amount: totalAuthorCents,
            purchaseId: purchase.id,
          },
          {
            walletId: this.platformWalletId,
            type: 'royalty_platform' as const,
            direction: 'credit' as const,
            amount: platformCut,
            purchaseId: purchase.id,
          },
        ].filter((e) => e.amount > 0);

        if (ledgerEntries.length > 0) {
          await tx.insert(schema.ledger).values(ledgerEntries);
        }

        // Update running totals — same transaction, always consistent
        await tx
          .insert(schema.ledgerTotals)
          .values({ type: 'purchase', total: dto.itemPrice })
          .onConflictDoUpdate({
            target: schema.ledgerTotals.type,
            set: {
              total: sql`${schema.ledgerTotals.total} + ${dto.itemPrice}`,
            },
          });
        await tx
          .insert(schema.ledgerTotals)
          .values({ type: 'royalty_author', total: totalAuthorCents })
          .onConflictDoUpdate({
            target: schema.ledgerTotals.type,
            set: {
              total: sql`${schema.ledgerTotals.total} + ${totalAuthorCents}`,
            },
          });
        await tx
          .insert(schema.ledgerTotals)
          .values({ type: 'royalty_platform', total: platformCut })
          .onConflictDoUpdate({
            target: schema.ledgerTotals.type,
            set: { total: sql`${schema.ledgerTotals.total} + ${platformCut}` },
          });

        return purchase;
      });
    } catch (error) {
      // Drizzle may wrap the raw PostgresError in a DrizzleQueryError, so we
      // check both the error itself and its cause for the pg error code.
      const pgError =
        error instanceof PostgresError
          ? error
          : error instanceof Error && error.cause instanceof PostgresError
            ? error.cause
            : null;
      // 23505: unique_violation — concurrent duplicate idempotency key
      if (pgError?.code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException(
          'Duplicate purchase: idempotency key already exists',
        );
      }
      // 40P01: deadlock_detected — safety net; .orderBy(asc(...)) in the FOR
      // UPDATE query enforces consistent lock acquisition order in PostgreSQL,
      // preventing most deadlocks, but this guards against any edge cases.
      if (pgError?.code === PG_DEADLOCK) {
        throw new ConflictException(
          'Transaction deadlock detected, please retry',
        );
      }
      throw error;
    }

    // Cache after successful commit
    try {
      await this.redis.set(
        redisKey,
        JSON.stringify(result),
        'EX',
        IDEMPOTENCY_TTL,
      );
    } catch {
      /* Redis unavailable — ignore */
    }

    return result;
  }
}
