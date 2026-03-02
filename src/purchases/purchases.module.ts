import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PurchasesController } from './purchases.controller';
import { PurchasesService } from './purchases.service';

@Module({
  controllers: [PurchasesController],
  providers: [
    PurchasesService,
    {
      provide: 'PLATFORM_WALLET_ID',
      useFactory: (config: ConfigService): string =>
        config.getOrThrow<string>('PLATFORM_WALLET_ID'),
      inject: [ConfigService],
    },
  ],
})
export class PurchasesModule {}
