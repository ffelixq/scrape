import { describe, expect, it } from 'vitest';
import { buildDemoInvestigation } from '../services/demo.js';
import { investigationRepository } from '../services/repository.js';
import { acceptedWithin, runResearchJob } from '../services/research-queue.js';

const input = {
  question: 'Does this supplier hold a current safety certification?',
  context: '',
  mode: 'STANDARD' as const,
  llmProvider: 'gemini' as const,
};

describe('bounded enqueue', () => {
  it('gives up on a queue command that never settles', async () => {
    // ioredis buffers commands while Redis is unreachable, so `queue.add()` stays pending forever.
    // Before this bound, POST /api/investigations never returned.
    const started = Date.now();
    await expect(acceptedWithin(new Promise(() => {}), 25)).resolves.toBe(false);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('reports a rejected enqueue as not accepted', async () => {
    await expect(acceptedWithin(Promise.reject(new Error('ECONNREFUSED')), 1_000)).resolves.toBe(
      false,
    );
  });

  it('swallows a rejection that arrives after the timeout has already answered', async () => {
    const late = new Promise((_resolve, reject) => {
      setTimeout(() => reject(new Error('ECONNREFUSED')), 20).unref?.();
    });
    await expect(acceptedWithin(late, 5)).resolves.toBe(false);
    // The late rejection must be handled by acceptedWithin itself, not escape as an
    // unhandled rejection once the race has already resolved.
    await new Promise((resolve) => setTimeout(resolve, 40));
  });

  it('reports an accepted enqueue', async () => {
    await expect(acceptedWithin(Promise.resolve('job-1'), 1_000)).resolves.toBe(true);
  });
});

describe('research claim', () => {
  it('lets exactly one runner take a queued investigation', async () => {
    const queued = await investigationRepository.create(input);

    const [first, second] = await Promise.all([
      investigationRepository.claim(queued.id),
      investigationRepository.claim(queued.id),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect((await investigationRepository.get(queued.id))?.status).toBe('RESEARCHING');
  });

  it('refuses to claim a finished investigation', async () => {
    const queued = await investigationRepository.create(input);
    await investigationRepository.complete(
      queued.id,
      buildDemoInvestigation(queued.id, input.question),
    );

    expect(await investigationRepository.claim(queued.id)).toBe(false);
  });

  it('refuses to claim a failed investigation', async () => {
    const queued = await investigationRepository.create(input);
    await investigationRepository.fail(queued.id, 'Sandbox unavailable');

    expect(await investigationRepository.claim(queued.id)).toBe(false);
  });

  it('refuses to claim an investigation that does not exist', async () => {
    expect(await investigationRepository.claim('00000000-0000-4000-8000-000000000000')).toBe(false);
  });

  it('drops a queued job that lands after the in-process run already finished', async () => {
    // The timed-out enqueue can still reach Redis. When the worker picks it up afterwards it must
    // not research a question that already has a verdict on the record.
    const queued = await investigationRepository.create(input);
    const completed = await investigationRepository.complete(
      queued.id,
      buildDemoInvestigation(queued.id, input.question),
    );

    await runResearchJob(queued.id, input);

    const after = await investigationRepository.get(queued.id);
    expect(after?.status).toBe('COMPLETED');
    expect(after?.answer).toBe(completed.answer);
    expect(after?.sources).toHaveLength(completed.sources.length);
  });
});
