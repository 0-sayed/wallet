import { IsInt, IsUUID, Min } from 'class-validator';

export class PurchaseBodyDto {
  @IsUUID()
  buyerWalletId!: string;

  @IsUUID()
  authorWalletId!: string;

  @IsInt()
  @Min(1)
  itemPrice!: number;
}
