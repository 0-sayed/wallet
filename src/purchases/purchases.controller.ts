import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PurchasesService } from './purchases.service';
import { UserIdGuard } from '../common/guards/user-id.guard';
import { PurchaseBodyDto } from './dto/purchase.dto';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('purchases')
@UseGuards(UserIdGuard)
export class PurchasesController {
  constructor(private readonly purchasesService: PurchasesService) {}

  @Post()
  purchase(
    @Headers('x-user-id') userId: string,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() dto: PurchaseBodyDto,
  ) {
    if (!idempotencyKey || !UUID_REGEX.test(idempotencyKey)) {
      throw new BadRequestException(
        'Idempotency-Key header must be a valid UUID',
      );
    }

    return this.purchasesService.purchase({
      idempotencyKey,
      buyerWalletId: dto.buyerWalletId,
      authorWalletId: dto.authorWalletId,
      itemPrice: dto.itemPrice,
      requestUserId: userId,
    });
  }
}
