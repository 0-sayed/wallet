import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PostgresError } from 'postgres';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import type { AppDatabase } from '../common/database/db.module';
import { DB } from '../common/database/db.module';
import * as schema from '../common/database/schema';

const AUTHOR_ROYALTY_PERCENT = 70;
const PG_UNIQUE_VIOLATION = '23505';
const PG_DEADLOCK = '40P01';

interface PurchaseDto {
  idempotencyKey: string;
  buyerWalletId: string;
  authorWalletId: string;
  itemPrice: number;
  requestUserId: string;
}

@Injectable()
export class PurchasesService {
  constructor(
    @Inject(DB) private db: AppDatabase,
    @Inject('PLATFORM_WALLET_ID') private platformWalletId: string,
  ) {}

  async purchase(dto: PurchaseDto) {
    // Self-purchase guard
    if (dto.buyerWalletId === dto.authorWalletId) {
      throw new BadRequestException(
        'Buyer and author wallets must be different',
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
        return existing;
      }
      throw new ConflictException(
        'Purchase with this idempotency key is still in flight',
      );
    }

    try {
      return await this.db.transaction(async (tx) => {
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

        const authorCut = Math.floor(
          (dto.itemPrice * AUTHOR_ROYALTY_PERCENT) / 100,
        );
        const platformCut = dto.itemPrice - authorCut;
        const now = new Date();

        // Deduct from buyer
        await tx
          .update(schema.wallets)
          .set({
            balance: sql`${schema.wallets.balance} - ${dto.itemPrice}`,
            updatedAt: now,
          })
          .where(eq(schema.wallets.id, dto.buyerWalletId));

        // Credit author
        await tx
          .update(schema.wallets)
          .set({
            balance: sql`${schema.wallets.balance} + ${authorCut}`,
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

        // Ledger entries
        await tx.insert(schema.ledger).values([
          {
            walletId: dto.buyerWalletId,
            type: 'purchase',
            direction: 'debit',
            amount: dto.itemPrice,
            purchaseId: purchase.id,
          },
          {
            walletId: dto.authorWalletId,
            type: 'royalty_author',
            direction: 'credit',
            amount: authorCut,
            purchaseId: purchase.id,
          },
          {
            walletId: this.platformWalletId,
            type: 'royalty_platform',
            direction: 'credit',
            amount: platformCut,
            purchaseId: purchase.id,
          },
        ]);

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
  }
}
