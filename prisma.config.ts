// Prisma 7 moved datasource URLs, the migrations path and the seed command
// out of schema.prisma and into this file. It also stopped loading .env
// automatically, hence the explicit dotenv import on the first line.
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  // Migrations must run over a DIRECT (unpooled) connection. The runtime
  // client uses the pooled DATABASE_URL via the pg driver adapter instead
  // (see src/shared/prisma.ts).
  datasource: {
    url: env('DIRECT_URL'),
  },
});
