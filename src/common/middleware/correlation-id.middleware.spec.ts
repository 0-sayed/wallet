import { NextFunction, Request, Response } from 'express';
import { CorrelationIdMiddleware } from './correlation-id.middleware';

// eslint-disable-next-line @typescript-eslint/no-unsafe-return
jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  randomUUID: () => 'test-uuid-1234',
}));

describe('CorrelationIdMiddleware', () => {
  let middleware: CorrelationIdMiddleware;

  beforeEach(() => {
    middleware = new CorrelationIdMiddleware();
  });

  it('should be defined', () => {
    expect(middleware).toBeDefined();
  });

  it('uses existing X-Request-Id when present', () => {
    const setHeader = jest.fn();
    const next: NextFunction = jest.fn();
    const req = {
      headers: { 'x-request-id': 'existing-id' },
    } as unknown as Request;
    const res = { setHeader } as unknown as Response;

    middleware.use(req, res, next);

    expect(req.headers['x-request-id']).toBe('existing-id');
    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', 'existing-id');
    expect(next).toHaveBeenCalled();
  });

  it('generates a correlation ID when X-Request-Id is absent', () => {
    const setHeader = jest.fn();
    const next: NextFunction = jest.fn();
    const req = { headers: {} } as unknown as Request;
    const res = { setHeader } as unknown as Response;

    middleware.use(req, res, next);

    expect(req.headers['x-request-id']).toBe('test-uuid-1234');
    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', 'test-uuid-1234');
    expect(next).toHaveBeenCalled();
  });
});
