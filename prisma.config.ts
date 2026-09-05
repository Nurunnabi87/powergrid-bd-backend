// Prisma 7 moved datasource URLs, the migrations path and the seed command
// out of schema.prisma and into this file. It also stopped loading .env
// automatically, hence the explicit dotenv import on the first line.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

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
  //
  // Read straight from process.env rather than Prisma's env() helper, which
  // throws the moment this file is loaded if the variable is missing. That
  // eager failure breaks `prisma generate` in postinstall - so a plain
  // `npm install` (on Vercel, or for anyone cloning the repo before writing
  // a .env) would fail even though generate never touches the database.
  // Commands that DO need a connection still fail loudly on the empty string.
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '',
  },
});
