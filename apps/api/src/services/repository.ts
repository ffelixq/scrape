import { Prisma, PrismaClient } from '@prisma/client';
import {
  investigationSchema,
  type CreateInvestigationInput,
  type Investigation,
  type InvestigationStatus,
} from '@proofline/contracts';
import { randomUUID } from 'node:crypto';
import { appConfig } from '../config.js';
import { cacheInvestigation, getCachedInvestigation } from './cache.js';
import { investigationEvents } from './events.js';

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

  async close(): Promise<void> {
    await prisma?.$disconnect();
  }
}

export const investigationRepository = new InvestigationRepository();
