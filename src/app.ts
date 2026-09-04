import cors from 'cors';
import express, { Application, Request, Response } from 'express';
import helmet from 'helmet';
import config from './config';
import { DocsRoutes } from './docs/docs.routes';
import globalErrorHandler from './middlewares/globalErrorHandler';
import notFound from './middlewares/notFound';
import { globalLimiter } from './middlewares/rateLimiter';
import router from './routes';

const app: Application = express();

// Vercel and other proxies terminate TLS upstream; without this the rate
// limiter would key every request to the proxy's address.
app.set('trust proxy', 1);

app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow non-browser clients (Postman, curl, server-to-server) which
      // send no Origin header at all.
      if (!origin || config.cors_origins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api', globalLimiter);

// Swagger UI + the raw OpenAPI document.
app.use('/api/docs', DocsRoutes);

// All feature routes are versioned.
app.use('/api/v1', router);

app.get('/', (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: 'PowerGrid BD API - Load Shedding & Power Outage Management System',
    docs: '/api/docs',
    version: 'v1',
  });
});

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: 'PowerGrid BD API is running',
    environment: config.node_env,
    timestamp: new Date().toISOString(),
  });
});

// Registered last: notFound catches unknown URLs, globalErrorHandler
// catches everything thrown or rejected above it.
app.use(notFound);
app.use(globalErrorHandler);

export default app;
