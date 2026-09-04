// Prisma 7 moved datasource URLs, the migrations path and the seed command
// out of schema.prisma and into this file. It also stopped loading .env
// automatically, hence the explicit dotenv import on the first line.
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // Invoked via node + a relative path rather than the 'tsx' shim:
    // Prisma spawns this through cmd.exe on Windows, which splits the
    // command at the '&' in this project's folder name and breaks the
    // .bin shim's path resolution.
    seed: 'node ./node_modules/tsx/dist/cli.mjs prisma/seed.ts',
  },
  // Migrations must run over a DIRECT (unpooled) connection. The runtime
  // client uses the pooled DATABASE_URL via the pg driver adapter instead
  // (see src/shared/prisma.ts).
  datasource: {
    url: env('DIRECT_URL'),
  },
});
