import { Router } from 'express';
import { getAgentProviderUsage } from '../services/agent-client.js';

export const usageRouter = Router();

usageRouter.get('/', async (_request, response) => {
  const dashboard = await getAgentProviderUsage();
  response.setHeader('Cache-Control', 'private, max-age=30');
  response.json(dashboard);
});
