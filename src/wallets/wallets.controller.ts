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
import {
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiBadRequestResponse,
  ApiTags,
} from '@nestjs/swagger';
import { UserIdGuard } from '../common/guards/user-id.guard';
import { ApiUserIdHeader } from '../common/guards/user-id-api.decorator';
import { DepositDto } from './dto/deposit.dto';
import { WalletsService } from './wallets.service';
import { WalletResponseDto } from './dto/wallet-response.dto';

@ApiTags('wallets')
@ApiUserIdHeader()
@Controller('wallets')
@UseGuards(UserIdGuard)
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Post(':walletId/deposit')
  @ApiOperation({ summary: 'Deposit funds into a wallet' })
  @ApiParam({ name: 'walletId', format: 'uuid' })
  @ApiBadRequestResponse({ description: 'Amount must be positive' })
  @ApiNotFoundResponse({ description: 'Wallet not found' })
  deposit(
    @Req() req: Request & { userId: string },
    @Param('walletId', ParseUUIDPipe) walletId: string,
    @Body() dto: DepositDto,
  ): Promise<WalletResponseDto> {
    return this.walletsService.deposit(req.userId, walletId, dto.amount);
  }
}
