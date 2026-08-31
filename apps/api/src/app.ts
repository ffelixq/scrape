import express from 'express';
import { pinoHttp } from 'pino-http';
import { appConfig } from './config.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { installSecurityMiddleware } from './middleware/security.js';
import { healthRouter } from './routes/health.js';
import { investigationsRouter } from './routes/investigations.js';
import { usageRouter } from './routes/usage.js';

export function createApp() {
  const app = express();
  installSecurityMiddleware(app);
  if (appConfig.nodeEnv !== 'test') {
    app.use(pinoHttp({ quietReqLogger: true }));
  }
  app.use(express.json({ limit: '64kb', type: ['application/json', 'application/*+json'] }));
  app.use('/api/health', healthRouter);
  app.use('/api/investigations', investigationsRouter);
  app.use('/api/usage', usageRouter);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
