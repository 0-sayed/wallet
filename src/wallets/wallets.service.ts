import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { AppDatabase } from '../common/database/db.module';
import { DB } from '../common/database/db.module';
import * as schema from '../common/database/schema';

@Injectable()
export class WalletsService {
  constructor(@Inject(DB) private db: AppDatabase) {}

  async deposit(
    userId: string,
    walletId: string,
    amount: number,
  ): Promise<typeof schema.wallets.$inferSelect> {
    if (amount <= 0) {
      throw new BadRequestException('Deposit amount must be positive');
    }

    return this.db.transaction(async (tx) => {
      // Lock the wallet row to prevent concurrent deposit race
      const [wallet] = await tx
        .select()
        .from(schema.wallets)
        .where(
          and(
            eq(schema.wallets.id, walletId),
            eq(schema.wallets.userId, userId),
          ),
        )
        .for('update');

      if (!wallet) {
        throw new NotFoundException(`Wallet ${walletId} not found`);
      }

      // SQL-side arithmetic — immune to read-then-write race
      const [updated] = await tx
        .update(schema.wallets)
        .set({
          balance: sql`${schema.wallets.balance} + ${amount}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.wallets.id, walletId),
            eq(schema.wallets.userId, userId),
          ),
        )
        .returning();

      await tx.insert(schema.ledger).values({
        walletId,
        type: 'deposit',
        direction: 'credit',
        amount,
      });

      return updated;
    });
  }
}
