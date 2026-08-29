import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { z } from 'zod';

loadEnv({ path: process.env.PROOFLINE_ENV_FILE || resolve(process.cwd(), '../../.env') });
loadEnv();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DEMO_MODE: z
    .string()
    .default('true')
    .transform((value) => value === 'true'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  AGENT_SERVICE_URL: z.string().url().default('http://localhost:8001'),
  INTERNAL_AGENT_TOKEN: z.string().min(16).default('local-development-token'),
  RESEARCH_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(300),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid environment: ${parsed.error.message}`);
}

export const appConfig = {
  nodeEnv: parsed.data.NODE_ENV,
  demoMode: parsed.data.DEMO_MODE,
  port: parsed.data.API_PORT,
  corsOrigins: parsed.data.CORS_ORIGIN.split(',').map((origin) => origin.trim()),
  databaseUrl: parsed.data.DATABASE_URL,
  redisUrl: parsed.data.REDIS_URL,
  agentServiceUrl: parsed.data.AGENT_SERVICE_URL,
  internalAgentToken: parsed.data.INTERNAL_AGENT_TOKEN,
  researchTimeoutMs: parsed.data.RESEARCH_TIMEOUT_SECONDS * 1000,
};
