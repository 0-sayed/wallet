import { randomUUID } from 'crypto';
import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import type { IncomingMessage } from 'http';

@Module({
  imports: [
    PinoLoggerModule.forRoot({
      pinoHttp: {
        genReqId: (req: IncomingMessage) =>
          (req.headers['x-request-id'] as string) ?? randomUUID(),
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty' }
            : undefined,
      },
    }),
  ],
  exports: [PinoLoggerModule],
})
export class LoggerModule {}
