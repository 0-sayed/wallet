import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { LoggerModule } from './common/logger/logger.module';
import { DbModule } from './common/database/db.module';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { HealthController } from './health/health.controller';
import { PurchasesModule } from './purchases/purchases.module';
import { WalletsModule } from './wallets/wallets.module';
import { ReportsModule } from './reports/reports.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRootAsync({
      useFactory: (config: ConfigService) => {
        const redisPort = Number(config.get<string>('REDIS_PORT', '6379'));
        if (Number.isNaN(redisPort)) {
          throw new Error('REDIS_PORT must be a valid number');
        }
        return {
          connection: {
            host: config.get<string>('REDIS_HOST', 'localhost'),
            port: redisPort,
          },
        };
      },
      inject: [ConfigService],
    }),
    LoggerModule,
    DbModule,
    PurchasesModule,
    WalletsModule,
    ReportsModule,
  ],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
