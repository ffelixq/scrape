import { Prisma, PrismaClient } from '@prisma/client';
import {
  investigationSchema,
  type ConversationMessage,
  type CreateInvestigationInput,
  type Investigation,
  type InvestigationStatus,
  type InvestigationSummary,
} from '@proofline/contracts';
import { randomUUID } from 'node:crypto';
import { appConfig } from '../config.js';
import { cacheInvestigation, getCachedInvestigation } from './cache.js';
import { investigationEvents } from './events.js';
import { deriveTitle, toSummary } from './summary.js';

const prisma = !appConfig.demoMode && appConfig.databaseUrl ? new PrismaClient() : null;
const memory = new Map<string, Investigation>();

function queuedInvestigation(id: string, input: CreateInvestigationInput): Investigation {
  return {
    id,
    question: input.question,
    status: 'QUEUED',
    verdict: null,
    answer: null,
    evidenceStrength: 0,
    createdAt: new Date().toISOString(),
    completedAt: null,
    limitations: [],
    sources: [],
    claims: [],
    evidence: [],
    contradictions: [],
    securityEvents: [],
    messages: [],
    metrics: {
      sourcesChecked: 0,
      independentSources: 0,
      primarySources: 0,
      contradictions: 0,
      falseConsensusClusters: 0,
    },
    audit: {
      supportingAgentSummary: '',
      opposingAgentSummary: '',
      auditorSummary: '',
    },
  };
}

export class InvestigationRepository {
  async create(input: CreateInvestigationInput): Promise<Investigation> {
    const id = randomUUID();
    const investigation = queuedInvestigation(id, input);
    memory.set(id, investigation);
    await cacheInvestigation(investigation);

    if (prisma) {
      try {
        await prisma.investigation.create({
          data: {
            id,
            question: input.question,
            context: input.context,
            mode: input.mode,
            limitations: [],
          },
        });
      } catch (error) {
        if (appConfig.nodeEnv === 'production') throw error;
      }
    }

    investigationEvents.publish(investigation);
    return investigation;
  }

  async get(id: string): Promise<Investigation | null> {
    const inMemory = memory.get(id);
    if (inMemory) return inMemory;
    const cached = await getCachedInvestigation(id);
    if (cached) {
      memory.set(id, cached);
      return cached;
    }
    if (!prisma) return null;

    const record = await prisma.investigation.findUnique({ where: { id } }).catch(() => null);
    if (!record) return null;
    if (record.resultJson) {
      const parsed = investigationSchema.safeParse(record.resultJson);
      if (parsed.success) {
        memory.set(id, parsed.data);
        return parsed.data;
      }
    }

    const skeleton = queuedInvestigation(id, {
      question: record.question,
      context: record.context,
      mode: record.mode === 'DEEP' ? 'DEEP' : 'STANDARD',
      llmProvider: 'gemini',
      searchProvider: 'tavily',
    });
    skeleton.status = record.status;
    skeleton.createdAt = record.createdAt.toISOString();
    return skeleton;
  }

  async updateStatus(id: string, status: InvestigationStatus): Promise<void> {
    const current = await this.get(id);
    if (!current) return;
    const updated = { ...current, status };
    memory.set(id, updated);
    await cacheInvestigation(updated);
    investigationEvents.publish(updated);
    if (prisma) {
      await prisma.investigation.update({ where: { id }, data: { status } }).catch(() => undefined);
    }
  }

  async complete(id: string, rawResult: Investigation): Promise<Investigation> {
    const current = await this.get(id);
    const result = investigationSchema.parse({
      ...rawResult,
      id,
      status: 'COMPLETED',
      createdAt: current?.createdAt ?? rawResult.createdAt,
      // The agent has no view of the follow-up conversation, so a completed research
      // result must never erase messages that are already on the record.
      messages: rawResult.messages?.length ? rawResult.messages : (current?.messages ?? []),
    });
    memory.set(id, result);
    await cacheInvestigation(result);

    if (prisma) {
      const resultJson = JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue;
      await prisma.$transaction(async (tx) => {
        await tx.evidence.deleteMany({ where: { claim: { investigationId: id } } });
        await tx.contradiction.deleteMany({ where: { claim: { investigationId: id } } });
        await tx.securityEvent.deleteMany({ where: { investigationId: id } });
        await tx.claim.deleteMany({ where: { investigationId: id } });
        await tx.source.deleteMany({ where: { investigationId: id } });

        await tx.investigation.update({
          where: { id },
          data: {
            status: 'COMPLETED',
            verdict: result.verdict,
            answer: result.answer,
            evidenceStrength: result.evidenceStrength,
            limitations: result.limitations,
            completedAt: result.completedAt ? new Date(result.completedAt) : new Date(),
            resultJson,
          },
        });
        if (result.sources.length) {
          await tx.source.createMany({
            data: result.sources.map((source) => ({
              ...source,
              investigationId: id,
              publishedAt: source.publishedAt ? new Date(source.publishedAt) : null,
              accessedAt: new Date(source.accessedAt),
            })) as Prisma.SourceCreateManyInput[],
          });
        }
        if (result.claims.length) {
          await tx.claim.createMany({
            data: result.claims.map((claim) => ({
              ...claim,
              investigationId: id,
            })) as Prisma.ClaimCreateManyInput[],
          });
        }
        if (result.evidence.length) {
          await tx.evidence.createMany({
            data: result.evidence as Prisma.EvidenceCreateManyInput[],
          });
        }
        if (result.contradictions.length) {
          await tx.contradiction.createMany({
            data: result.contradictions as Prisma.ContradictionCreateManyInput[],
          });
        }
        if (result.securityEvents.length) {
          await tx.securityEvent.createMany({
            data: result.securityEvents.map((event) => ({
              ...event,
              investigationId: id,
              detectedAt: new Date(event.detectedAt),
            })),
          });
        }
      });
    }

    investigationEvents.publish(result);
    return result;
  }

  async fail(id: string, reason: string): Promise<void> {
    const current = await this.get(id);
    if (!current) return;
    const failed: Investigation = {
      ...current,
      status: 'FAILED',
      verdict: 'UNVERIFIABLE',
      answer: 'The investigation could not be completed safely. No conclusion was produced.',
      limitations: [...current.limitations, reason],
      completedAt: new Date().toISOString(),
    };
    memory.set(id, failed);
    await cacheInvestigation(failed);
    investigationEvents.publish(failed);
    if (prisma) {
      await prisma.investigation
        .update({ where: { id }, data: { status: 'FAILED', failureReason: reason } })
        .catch(() => undefined);
    }
  }

  /** Newest-first investigation history. Falls back to the in-memory map when no database is configured. */
  async list(limit = 60): Promise<InvestigationSummary[]> {
    const summaries = new Map<string, InvestigationSummary>();
    for (const investigation of memory.values()) {
      summaries.set(investigation.id, toSummary(investigation));
    }

    if (prisma) {
      const records = await prisma.investigation
        .findMany({ orderBy: { createdAt: 'desc' }, take: limit })
        .catch(() => []);
      for (const record of records) {
        if (summaries.has(record.id)) continue;
        const parsed = record.resultJson ? investigationSchema.safeParse(record.resultJson) : null;
        if (parsed?.success) {
          summaries.set(record.id, toSummary(parsed.data));
          continue;
        }
        summaries.set(record.id, {
          id: record.id,
          title: deriveTitle(record.question),
          question: record.question,
          status: record.status,
          verdict: record.verdict,
          evidenceStrength: record.evidenceStrength,
          createdAt: record.createdAt.toISOString(),
          completedAt: record.completedAt?.toISOString() ?? null,
          sourcesChecked: 0,
          independentSources: 0,
          contradictions: 0,
          messageCount: 0,
        });
      }
    }

    return [...summaries.values()]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  /** Append one conversation turn and republish the investigation to every open client. */
  async appendMessage(id: string, message: ConversationMessage): Promise<Investigation | null> {
    const current = await this.get(id);
    if (!current) return null;
    const updated: Investigation = { ...current, messages: [...current.messages, message] };
    memory.set(id, updated);
    await cacheInvestigation(updated);

    if (prisma) {
      const resultJson = JSON.parse(JSON.stringify(updated)) as Prisma.InputJsonValue;
      await prisma.investigation
        .update({ where: { id }, data: { resultJson } })
        .catch(() => undefined);
    }

    investigationEvents.publish(updated);
    return updated;
  }

  async remove(id: string): Promise<boolean> {
    const existed = memory.delete(id);
    if (prisma) {
      const deleted = await prisma.investigation
        .delete({ where: { id } })
        .then(() => true)
        .catch(() => false);
      return existed || deleted;
    }
    return existed;
  }

  async close(): Promise<void> {
    await prisma?.$disconnect();
  }
}

export const investigationRepository = new InvestigationRepository();
