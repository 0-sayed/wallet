import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { UserIdGuard } from '../common/guards/user-id.guard';
import { DepositDto } from './dto/deposit.dto';
import { WalletsService } from './wallets.service';

@Controller('wallets')
@UseGuards(UserIdGuard)
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Post(':walletId/deposit')
  deposit(
    @Req() req: Request & { userId: string },
    @Param('walletId', ParseUUIDPipe) walletId: string,
    @Body() dto: DepositDto,
  ) {
    return this.walletsService.deposit(req.userId, walletId, dto.amount);
  }
}
