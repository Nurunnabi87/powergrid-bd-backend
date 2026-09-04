import { PrismaPg } from '@prisma/adapter-pg';
import config from '../config';
import { PrismaClient } from '../generated/prisma/client';

// Prisma 7 has no Rust engine, so the client talks to Postgres through a
// driver adapter. This uses the POOLED connection string; migrations use
// DIRECT_URL via prisma.config.ts instead.
const adapter = new PrismaPg({ connectionString: config.database_url });

const prisma = new PrismaClient({
  adapter,
  log: config.node_env === 'development' ? ['warn', 'error'] : ['error'],
});

export default prisma;
