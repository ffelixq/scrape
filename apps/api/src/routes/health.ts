import { Router } from 'express';
import { appConfig } from '../config.js';

export const healthRouter = Router();

healthRouter.get('/', (_request, response) => {
  response.json({
    status: 'ok',
    service: 'proofline-api',
    mode: appConfig.demoMode ? 'demo' : 'live',
    dependencies: {
      postgres: appConfig.databaseUrl ? 'configured' : 'not_configured',
      redis: appConfig.redisUrl ? 'configured' : 'not_configured',
      agent: appConfig.agentServiceUrl,
    },
    at: new Date().toISOString(),
  });
});
