// src/common/database/db.module.ts
import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export const DB = Symbol('DB');
export type AppDatabase = PostgresJsDatabase<typeof schema> & {
  $client: ReturnType<typeof postgres>;
};

@Global()
@Module({
  providers: [
    {
      provide: DB,
      useFactory: (config: ConfigService) => {
        const databaseUrl = config.getOrThrow<string>('DATABASE_URL');
        const client = postgres(databaseUrl);
        return drizzle({ client, schema });
      },
      inject: [ConfigService],
    },
  ],
  exports: [DB],
})
export class DbModule implements OnModuleDestroy {
  constructor(@Inject(DB) private readonly db: AppDatabase) {}

  async onModuleDestroy() {
    await this.db.$client.end();
  }
}
