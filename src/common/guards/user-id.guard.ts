import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class UserIdGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      userId?: string;
    }>();
    const userId = request.headers['x-user-id'];

    if (!userId || typeof userId !== 'string' || !UUID_REGEX.test(userId)) {
      throw new UnauthorizedException('X-User-Id header must be a valid UUID');
    }

    request.userId = userId;
    return true;
  }
}
