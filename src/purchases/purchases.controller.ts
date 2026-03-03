import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { PurchasesService } from './purchases.service';
import { UserIdGuard } from '../common/guards/user-id.guard';
import { ApiUserIdHeader } from '../common/guards/user-id-api.decorator';
import { PurchaseBodyDto } from './dto/purchase.dto';
import { UUID_REGEX } from '../common/validation/uuid';
import { PurchaseResponseDto } from './dto/purchase-response.dto';

@ApiTags('purchases')
@ApiUserIdHeader()
@Controller('purchases')
@UseGuards(UserIdGuard)
export class PurchasesController {
  constructor(private readonly purchasesService: PurchasesService) {}

  @Post()
  @ApiOperation({ summary: 'Purchase an item' })
  @ApiHeader({
    name: 'idempotency-key',
    description: 'UUID for idempotent request',
    required: true,
  })
  @ApiBadRequestResponse({
    description:
      'Self-purchase / invalid idempotency key / author or platform wallet missing',
  })
  // 402 has no named @nestjs/swagger decorator; raw ApiResponse is intentional
  @ApiResponse({ status: 402, description: 'Insufficient funds' })
  @ApiForbiddenResponse({
    description: 'Buyer wallet does not belong to authenticated user',
  })
  @ApiNotFoundResponse({ description: 'Buyer wallet not found' })
  @ApiConflictResponse({
    description: 'Idempotency conflict or deadlock — retry',
  })
  purchase(
    @Req() req: Request & { userId: string },
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() dto: PurchaseBodyDto,
  ): Promise<PurchaseResponseDto> {
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
      requestUserId: req.userId,
    });
  }
}
