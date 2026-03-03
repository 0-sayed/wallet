export class WalletResponseDto {
  /** Wallet UUID */
  id!: string;

  /** Owner user UUID */
  userId!: string;

  /** Current balance in integer units */
  balance!: number;

  /** Timestamp of last balance change */
  updatedAt!: Date;
}
