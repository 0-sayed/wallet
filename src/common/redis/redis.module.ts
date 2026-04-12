import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (config: ConfigService) => {
        const port = Number(config.get<string>('REDIS_PORT', '6379'));
        if (Number.isNaN(port)) {
          throw new Error('REDIS_PORT must be a valid number');
        }
        return new Redis({
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port,
        });
      },
      inject: [ConfigService],
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
