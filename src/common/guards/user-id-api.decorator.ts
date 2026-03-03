import { applyDecorators } from '@nestjs/common';
import { ApiHeader, ApiUnauthorizedResponse } from '@nestjs/swagger';

export const ApiUserIdHeader = () =>
  applyDecorators(
    ApiHeader({ name: 'x-user-id', description: 'User UUID', required: true }),
    ApiUnauthorizedResponse({
      description: 'Missing or invalid X-User-Id header',
    }),
  );
