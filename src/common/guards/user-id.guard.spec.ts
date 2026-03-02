import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { UserIdGuard } from './user-id.guard';

interface MockRequest {
  headers: Record<string, string | string[] | undefined>;
  userId?: string;
}

function makeContext(
  headers: Record<string, string | string[] | undefined>,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: (): MockRequest => ({ headers }),
    }),
  } as unknown as ExecutionContext;
}

describe('UserIdGuard', () => {
  let guard: UserIdGuard;

  beforeEach(() => {
    guard = new UserIdGuard();
  });

  it('attaches userId to request and returns true for valid UUID', () => {
    const req: MockRequest = {
      headers: { 'x-user-id': '550e8400-e29b-41d4-a716-446655440000' },
    };
    const ctx = {
      switchToHttp: () => ({ getRequest: (): MockRequest => req }),
    } as unknown as ExecutionContext;

    expect(guard.canActivate(ctx)).toBe(true);
    expect(req.userId).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('throws UnauthorizedException when header is missing', () => {
    const ctx = makeContext({});
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when header is not a valid UUID', () => {
    const ctx = makeContext({ 'x-user-id': 'not-a-uuid' });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when header is an array', () => {
    const ctx = makeContext({ 'x-user-id': ['id-1', 'id-2'] });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });
});
