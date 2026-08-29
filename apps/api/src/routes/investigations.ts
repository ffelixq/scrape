import { createInvestigationSchema } from '@proofline/contracts';
import { Router } from 'express';
import { appConfig } from '../config.js';
import { buildDemoInvestigation } from '../services/demo.js';
import { investigationEvents } from '../services/events.js';
import { investigationRepository } from '../services/repository.js';
import { enqueueResearch } from '../services/research-queue.js';

export const investigationsRouter = Router();

investigationsRouter.post('/', async (request, response) => {
  const input = createInvestigationSchema.parse(request.body);
  const queued = await investigationRepository.create(input);

  if (appConfig.demoMode) {
    const completed = await investigationRepository.complete(
      queued.id,
      buildDemoInvestigation(queued.id, input.question),
    );
    response.status(201).json(completed);
    return;
  }

  await enqueueResearch(queued.id, input);
  response.status(202).json(queued);
});

investigationsRouter.get('/:id', async (request, response) => {
  const investigation = await investigationRepository.get(request.params.id);
  if (!investigation) {
    response.status(404).json({ error: 'Investigation not found' });
    return;
  }
  response.json(investigation);
});

investigationsRouter.get('/:id/events', async (request, response) => {
  const investigation = await investigationRepository.get(request.params.id);
  if (!investigation) {
    response.status(404).json({ error: 'Investigation not found' });
    return;
  }

  response.setHeader('Content-Type', 'text/event-stream');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('Connection', 'keep-alive');
  response.flushHeaders();

  const send = (value: typeof investigation) => {
    response.write(`event: investigation\ndata: ${JSON.stringify(value)}\n\n`);
  };
  send(investigation);

  const unsubscribe = investigationEvents.subscribe(investigation.id, (updated) => {
    send(updated);
    if (updated.status === 'COMPLETED' || updated.status === 'FAILED') {
      setTimeout(() => response.end(), 100);
    }
  });
  const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 15_000);
  request.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});
