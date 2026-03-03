import { IsInt, Matches, Min } from 'class-validator';
import { UUID_REGEX } from '../../common/validation/uuid';

export class PurchaseBodyDto {
  @Matches(UUID_REGEX, { message: 'buyerWalletId must be a UUID' })
  buyerWalletId!: string;

  @Matches(UUID_REGEX, { message: 'authorWalletId must be a UUID' })
  authorWalletId!: string;

  @IsInt()
  @Min(1)
  itemPrice!: number;
}
