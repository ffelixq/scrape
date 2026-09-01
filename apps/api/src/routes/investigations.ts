import {
  createFollowUpSchema,
  createInvestigationSchema,
  type ConversationMessage,
  type FollowUpAnswer,
} from '@proofline/contracts';
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { appConfig } from '../config.js';
import { runAgentFollowUp } from '../services/agent-client.js';
import { buildDemoInvestigation } from '../services/demo.js';
import { investigationEvents } from '../services/events.js';
import { buildDeterministicFollowUp } from '../services/follow-up.js';
import { investigationRepository } from '../services/repository.js';
import { enqueueResearch } from '../services/research-queue.js';

export const investigationsRouter = Router();

investigationsRouter.get('/', async (_request, response) => {
  response.json({ investigations: await investigationRepository.list() });
});

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

investigationsRouter.delete('/:id', async (request, response) => {
  const removed = await investigationRepository.remove(request.params.id);
  if (!removed) {
    response.status(404).json({ error: 'Investigation not found' });
    return;
  }
  response.status(204).end();
});

/**
 * Continue an investigation that is already on the record.
 *
 * The user turn is stored before the answer is requested, so an unavailable model leaves a
 * visible question and a stated failure rather than a silently dropped message.
 */
investigationsRouter.post('/:id/messages', async (request, response) => {
  const input = createFollowUpSchema.parse(request.body);
  const investigation = await investigationRepository.get(request.params.id);
  if (!investigation) {
    response.status(404).json({ error: 'Investigation not found' });
    return;
  }
  if (investigation.status !== 'COMPLETED' && investigation.status !== 'FAILED') {
    response.status(409).json({ error: 'This investigation is still running.' });
    return;
  }

  const askedAt = new Date().toISOString();
  const withQuestion = await investigationRepository.appendMessage(investigation.id, {
    id: randomUUID(),
    role: 'USER',
    kind: 'FOLLOW_UP',
    content: input.question,
    createdAt: askedAt,
    citedSourceIds: [],
    limitations: [],
    failed: false,
  });

  let answer: FollowUpAnswer;
  let failed = false;
  try {
    answer = appConfig.demoMode
      ? buildDeterministicFollowUp(withQuestion ?? investigation, input.question)
      : await runAgentFollowUp(withQuestion ?? investigation, input);
  } catch (error) {
    failed = true;
    const message = error instanceof Error ? error.message : 'Unknown follow-up failure';
    answer = {
      answer:
        'The follow-up could not be answered. The investigation record is unchanged and the question can be asked again.',
      kind: 'FOLLOW_UP',
      citedSourceIds: [],
      limitations: [message],
    };
  }

  const reply: ConversationMessage = {
    id: randomUUID(),
    role: 'ASSISTANT',
    kind: answer.kind === 'FOLLOW_UP_RESEARCH' ? 'FOLLOW_UP_RESEARCH' : 'FOLLOW_UP',
    content: answer.answer,
    createdAt: new Date().toISOString(),
    citedSourceIds: answer.citedSourceIds,
    limitations: answer.limitations,
    failed,
  };
  const updated = await investigationRepository.appendMessage(investigation.id, reply);
  response.status(failed ? 502 : 201).json(updated ?? investigation);
});
