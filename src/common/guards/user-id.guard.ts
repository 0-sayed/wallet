import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

@Injectable()
export class UserIdGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string> }>();
    const userId = request.headers['x-user-id'];
    if (!userId) {
      throw new UnauthorizedException('X-User-Id header is required');
    }
    return true;
  }
}
