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

// BullMQ requires `maxRetriesPerRequest: null` on the connection it blocks on, which means ioredis
// buffers commands indefinitely while Redis is unreachable rather than rejecting them. That is the
// reason every queue command below is bounded by the caller instead of by the client.
const connection =
  appConfig.redisUrl && !appConfig.demoMode
    ? new Redis(appConfig.redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        // ioredis retries every 2s by default, which during an outage is a reconnect storm and a
        // matching stream of log lines. Backing off to 30s still restores durable queueing
        // promptly once Redis returns, because a successful reconnect emits 'ready'.
        retryStrategy: (times: number) => Math.min(times * 500, 30_000),
      })
    : null;

// Reconnection attempts repeat for as long as Redis is down, so report at most one line every 30s.
let lastConnectionWarningAt = 0;
function reportQueueProblem(error: Error): void {
  const now = Date.now();
  if (now - lastConnectionWarningAt < 30_000) return;
  lastConnectionWarningAt = now;
  console.warn(
    `Research queue Redis is unavailable (${error.message}); investigations run in-process until it returns.`,
  );
}

// Every connection needs an 'error' listener: an unhandled one is thrown by EventEmitter, and
// BullMQ opens its own duplicates of `connection` whose errors surface on the Queue and Worker.
connection?.on('error', reportQueueProblem);

/**
 * Whether durable queueing is worth waiting for.
 *
 * Once an enqueue has timed out there is no reason to make every following request pay the same
 * bound again, so a sustained outage costs one wait rather than one per investigation. ioredis
 * reconnects on its own, and the 'ready' it emits when Redis returns is what restores the queue.
 */
let queueAvailable = true;
connection?.on('ready', () => {
  queueAvailable = true;
});

const queue = connection ? new Queue<ResearchJob>('proofline-research', { connection }) : null;
queue?.on('error', reportQueueProblem);

/**
 * Run one investigation to a terminal state.
 *
 * `isRetry` marks a BullMQ redelivery of a job that already claimed this investigation; it is the
 * one case that must skip the claim, because the failed first attempt left the record in
 * RESEARCHING. `canRetry` lets a non-final attempt rethrow so BullMQ backs off and tries again,
 * while the final attempt records the failure on the investigation instead of losing it.
 */
export async function runResearchJob(
  id: string,
  input: CreateInvestigationInput,
  options: { isRetry?: boolean; canRetry?: boolean } = {},
): Promise<void> {
  if (!options.isRetry && !(await investigationRepository.claim(id))) return;

  try {
    const result = await runAgentInvestigation(id, input);
    await investigationRepository.updateStatus(id, 'AUDITING');
    await investigationRepository.complete(id, result);
  } catch (error) {
    if (options.canRetry) throw error;
    const message = error instanceof Error ? error.message : 'Unknown research failure';
    await investigationRepository.fail(id, message);
  }
}

const processor = async (job: Job<ResearchJob>) => {
  const attemptsMade = job.attemptsMade ?? 0;
  const allowedAttempts = job.opts?.attempts ?? 1;
  await runResearchJob(job.data.id, job.data.input, {
    isRetry: attemptsMade > 0,
    canRetry: attemptsMade + 1 < allowedAttempts,
  });
};

const worker = connection
  ? new Worker<ResearchJob>('proofline-research', processor, { connection, concurrency: 4 })
  : null;
worker?.on('error', reportQueueProblem);

/**
 * Resolve true only when the queue accepted the job inside `timeoutMs`.
 *
 * A rejection and a timeout are the same answer to the caller — the job is not durably queued —
 * so both resolve false. The `catch` is attached to the enqueue promise rather than wrapped around
 * the race, so a rejection that arrives after the timeout is still handled.
 */
export async function acceptedWithin(add: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
    timer.unref?.();
  });

  try {
    return await Promise.race([add.then(() => true).catch(() => false), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Hand an investigation to the worker, or run it here if the queue cannot take it.
 *
 * Durable queueing is the preferred path but never a precondition for answering the request: an
 * unreachable Redis degrades to the same in-process processor the no-Redis configuration already
 * uses, so `POST /api/investigations` returns either way.
 */
export async function enqueueResearch(id: string, input: CreateInvestigationInput): Promise<void> {
  if (queue && queueAvailable) {
    const accepted = await acceptedWithin(
      queue.add(
        'investigate',
        { id, input },
        {
          jobId: id,
          attempts: 2,
          backoff: { type: 'exponential', delay: 2_000 },
          removeOnComplete: 100,
          removeOnFail: 250,
        },
      ),
      appConfig.enqueueTimeoutMs,
    );
    if (accepted) return;
    // Only a connection that is not ready counts as an outage worth skipping next time. One slow
    // accept on a healthy connection must not disable durable queueing permanently, because
    // 'ready' would never fire again to restore it.
    if (connection?.status !== 'ready') queueAvailable = false;
  }

  setImmediate(() => void runResearchJob(id, input));
}

export async function closeResearchQueue(): Promise<void> {
  await worker?.close();
  await queue?.close();
  await connection?.quit().catch(() => undefined);
}
