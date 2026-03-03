import { purchaseStatusEnum } from '../../common/database/schema';

export class PurchaseResponseDto {
  /** Purchase UUID */
  id!: string;

  /** Idempotency key UUID */
  idempotencyKey!: string;

  /** Buyer wallet UUID */
  buyerWalletId!: string;

  /** Author wallet UUID */
  authorWalletId!: string;

  /** Item price in integer units */
  itemPrice!: number;

  /** Purchase status */
  status!: (typeof purchaseStatusEnum.enumValues)[number];

  /** Timestamp of purchase creation */
  createdAt!: Date;
}
