import { Server } from 'http';
import app from './app';
import config from './config';
import prisma from './shared/prisma';

let server: Server;

const bootstrap = async (): Promise<void> => {
  try {
    await prisma.$connect();
    console.log('[db] connected');

    server = app.listen(config.port, () => {
      console.log(`[server] listening on http://localhost:${config.port}`);
    });
  } catch (error) {
    console.error('[server] failed to start:', error);
    process.exit(1);
  }
};

const shutdown = async (signal: string): Promise<void> => {
  console.log(`[server] ${signal} received, shutting down`);
  server?.close(() => console.log('[server] http server closed'));
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

void bootstrap();
