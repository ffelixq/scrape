import type { CreateInvestigationInput } from '@proofline/contracts';
import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { appConfig } from '../config.js';
import { runAgentInvestigation } from './agent-client.js';
import { investigationRepository } from './repository.js';

interface ResearchJob {
  id: string;
  input: CreateInvestigationInput;
}

const connection =
  appConfig.redisUrl && !appConfig.demoMode
    ? new Redis(appConfig.redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false })
    : null;
const queue = connection ? new Queue<ResearchJob>('proofline-research', { connection }) : null;

const processor = async (job: Job<ResearchJob>) => {
  const { id, input } = job.data;
  try {
    await investigationRepository.updateStatus(id, 'RESEARCHING');
    const result = await runAgentInvestigation(id, input);
    await investigationRepository.updateStatus(id, 'AUDITING');
    await investigationRepository.complete(id, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown research failure';
    await investigationRepository.fail(id, message);
  }
};

const worker = connection
  ? new Worker<ResearchJob>('proofline-research', processor, { connection, concurrency: 4 })
  : null;

export async function enqueueResearch(id: string, input: CreateInvestigationInput): Promise<void> {
  if (queue) {
    await queue.add(
      'investigate',
      { id, input },
      {
        jobId: id,
        attempts: 2,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: 100,
        removeOnFail: 250,
      },
    );
    return;
  }
  setImmediate(() => void processor({ data: { id, input } } as Job<ResearchJob>));
}

export async function closeResearchQueue(): Promise<void> {
  await worker?.close();
  await queue?.close();
  await connection?.quit();
}
