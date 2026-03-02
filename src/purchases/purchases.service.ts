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
import { eq, sql } from 'drizzle-orm';
import type { AppDatabase } from '../common/database/db.module';
import { DB } from '../common/database/db.module';
import * as schema from '../common/database/schema';

const AUTHOR_ROYALTY_PERCENT = 70;
const PG_UNIQUE_VIOLATION = '23505';

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
        return existing;
      }
      throw new ConflictException(
        'Purchase with this idempotency key is still in flight',
      );
    }

    try {
      return await this.db.transaction(async (tx) => {
        // Pessimistic lock on buyer wallet
        const [buyerWallet] = await tx
          .select({
            userId: schema.wallets.userId,
            balance: schema.wallets.balance,
          })
          .from(schema.wallets)
          .where(eq(schema.wallets.id, dto.buyerWalletId))
          .for('update');

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

        // Verify author wallet exists (and lock it)
        const [authorWallet] = await tx
          .select({ id: schema.wallets.id })
          .from(schema.wallets)
          .where(eq(schema.wallets.id, dto.authorWalletId))
          .for('update');

        if (!authorWallet) {
          throw new BadRequestException('Author wallet does not exist');
        }

        // Verify platform wallet exists (and lock it)
        const [platformWallet] = await tx
          .select({ id: schema.wallets.id })
          .from(schema.wallets)
          .where(eq(schema.wallets.id, this.platformWalletId))
          .for('update');

        if (!platformWallet) {
          throw new BadRequestException('Platform wallet does not exist');
        }

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
      // Postgres unique_violation on idempotency_key — concurrent duplicate
      if (
        error instanceof PostgresError &&
        error.code === PG_UNIQUE_VIOLATION
      ) {
        throw new ConflictException(
          'Duplicate purchase: idempotency key already exists',
        );
      }
      throw error;
    }
  }
}
