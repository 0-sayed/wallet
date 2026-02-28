import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const correlationId = (req.headers['x-request-id'] as string) ?? uuidv4();
    req.headers['x-request-id'] = correlationId;
    res.setHeader('X-Request-Id', correlationId);
    next();
  }
}
