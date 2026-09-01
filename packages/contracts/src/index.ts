import { z } from 'zod';

export const evidenceStatusSchema = z.enum([
  'SUPPORTED',
  'WELL_SUPPORTED',
  'INCONCLUSIVE',
  'CONTRADICTED',
  'LIKELY_FALSE',
  'UNVERIFIABLE',
]);

export const investigationStatusSchema = z.enum([
  'QUEUED',
  'RESEARCHING',
  'AUDITING',
  'COMPLETED',
  'FAILED',
]);

export const sourceTierSchema = z.enum(['PRIMARY', 'AUTHORITATIVE', 'SECONDARY', 'LOW']);

export const evidenceRelationSchema = z.enum(['SUPPORTS', 'OPPOSES', 'CONTEXT']);

export const llmProviderSchema = z.enum(['gemini', 'groq', 'deepseek']);

export const searchProviderSchema = z.enum(['tavily', 'serper']);

export const createInvestigationSchema = z.object({
  question: z
    .string()
    .trim()
    .min(12, 'Ask a specific research question (at least 12 characters).')
    .max(2_000),
  context: z.string().trim().max(4_000).optional().default(''),
  mode: z.enum(['STANDARD', 'DEEP']).optional().default('STANDARD'),
  llmProvider: llmProviderSchema.optional().default('gemini'),
  searchProvider: searchProviderSchema.optional().default('tavily'),
});

export const providerUsageSchema = z.object({
  provider: z.enum(['gemini', 'groq', 'deepseek', 'tavily', 'serper']),
  label: z.string(),
  kind: z.enum(['llm', 'search']),
  model: z.string().nullable(),
  configured: z.boolean(),
  status: z.enum(['available', 'configured', 'needs_attention', 'unavailable', 'not_configured']),
  used: z.number().int().nonnegative(),
  limit: z.number().int().positive().nullable(),
  remaining: z.number().int().nonnegative().nullable(),
  unit: z.enum(['requests', 'tokens', 'credits']),
  resetAt: z.string().nullable(),
  resetLabel: z.string(),
  source: z.enum(['provider', 'local', 'local_hard_limit']),
  note: z.string(),
});

export const providerUsageDashboardSchema = z.object({
  updatedAt: z.string(),
  timezone: z.string(),
  providers: z.array(providerUsageSchema),
});

export const sourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  publisher: z.string(),
  url: z.string().url(),
  publishedAt: z.string().nullable(),
  accessedAt: z.string(),
  tier: sourceTierSchema,
  reliabilityScore: z.number().min(0).max(100),
  independenceGroup: z.string(),
  isPrimary: z.boolean(),
  isDuplicate: z.boolean(),
  excerpt: z.string(),
});

export const evidenceSchema = z.object({
  id: z.string(),
  claimId: z.string(),
  sourceId: z.string(),
  relation: evidenceRelationSchema,
  excerpt: z.string(),
  location: z.string(),
  weight: z.number().min(0).max(1),
});

export const claimSchema = z.object({
  id: z.string(),
  text: z.string(),
  status: evidenceStatusSchema,
  evidenceStrength: z.number().min(0).max(100),
  rationale: z.string(),
  supportCount: z.number().int().nonnegative(),
  opposeCount: z.number().int().nonnegative(),
});

export const contradictionSchema = z.object({
  id: z.string(),
  claimId: z.string(),
  summary: z.string(),
  resolution: z.string(),
  reason: z.enum([
    'DATE',
    'DEFINITION',
    'CURRENCY',
    'REPORTING_PERIOD',
    'METHODOLOGY',
    'UNRESOLVED',
  ]),
  sourceIds: z.array(z.string()),
});

export const securityEventSchema = z.object({
  id: z.string(),
  severity: z.enum(['INFO', 'WARNING', 'BLOCKED']),
  category: z.enum(['PROMPT_INJECTION', 'MALICIOUS_FILE', 'NETWORK_POLICY', 'CONTENT_LIMIT']),
  message: z.string(),
  sourceId: z.string().nullable(),
  detectedAt: z.string(),
});

export const conversationRoleSchema = z.enum(['USER', 'ASSISTANT']);

export const conversationKindSchema = z.enum(['NEW_RESEARCH', 'FOLLOW_UP', 'FOLLOW_UP_RESEARCH']);

export const conversationMessageSchema = z.object({
  id: z.string(),
  role: conversationRoleSchema,
  kind: conversationKindSchema,
  content: z.string(),
  createdAt: z.string(),
  citedSourceIds: z.array(z.string()).default([]),
  limitations: z.array(z.string()).default([]),
  failed: z.boolean().default(false),
});

export const investigationSchema = z.object({
  id: z.string(),
  question: z.string(),
  status: investigationStatusSchema,
  verdict: evidenceStatusSchema.nullable(),
  answer: z.string().nullable(),
  evidenceStrength: z.number().min(0).max(100),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  limitations: z.array(z.string()),
  sources: z.array(sourceSchema),
  claims: z.array(claimSchema),
  evidence: z.array(evidenceSchema),
  contradictions: z.array(contradictionSchema),
  securityEvents: z.array(securityEventSchema),
  // Follow-up conversation is owned by the API, not the research agent. The agent omits it and
  // the default keeps a single parse path for both sources of an investigation.
  messages: z.array(conversationMessageSchema).default([]),
  metrics: z.object({
    sourcesChecked: z.number().int().nonnegative(),
    independentSources: z.number().int().nonnegative(),
    primarySources: z.number().int().nonnegative(),
    contradictions: z.number().int().nonnegative(),
    falseConsensusClusters: z.number().int().nonnegative(),
  }),
  audit: z.object({
    supportingAgentSummary: z.string(),
    opposingAgentSummary: z.string(),
    auditorSummary: z.string(),
  }),
});

export const investigationEventSchema = z.object({
  investigationId: z.string(),
  stage: z.enum([
    'QUEUED',
    'SANDBOX_CREATED',
    'SOURCES_DISCOVERED',
    'INJECTION_BLOCKED',
    'CLAIMS_EXTRACTED',
    'ADVERSARIAL_REVIEW',
    'AUDIT_COMPLETE',
  ]),
  message: z.string(),
  progress: z.number().min(0).max(100),
  at: z.string(),
});

export const investigationSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  question: z.string(),
  status: investigationStatusSchema,
  verdict: evidenceStatusSchema.nullable(),
  evidenceStrength: z.number().min(0).max(100),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  sourcesChecked: z.number().int().nonnegative(),
  independentSources: z.number().int().nonnegative(),
  contradictions: z.number().int().nonnegative(),
  messageCount: z.number().int().nonnegative(),
});

export const investigationListSchema = z.object({
  investigations: z.array(investigationSummarySchema),
});

export const createFollowUpSchema = z.object({
  question: z
    .string()
    .trim()
    .min(3, 'Ask a follow-up question about this investigation.')
    .max(2_000),
  llmProvider: llmProviderSchema.optional().default('gemini'),
});

/** The agent's answer to a follow-up asked against an already completed investigation. */
export const followUpAnswerSchema = z.object({
  answer: z.string(),
  kind: z.enum(['FOLLOW_UP', 'FOLLOW_UP_RESEARCH']).default('FOLLOW_UP'),
  citedSourceIds: z.array(z.string()).default([]),
  limitations: z.array(z.string()).default([]),
});

export type EvidenceStatus = z.infer<typeof evidenceStatusSchema>;
export type InvestigationStatus = z.infer<typeof investigationStatusSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type Claim = z.infer<typeof claimSchema>;
export type Contradiction = z.infer<typeof contradictionSchema>;
export type SecurityEvent = z.infer<typeof securityEventSchema>;
export type Investigation = z.infer<typeof investigationSchema>;
export type InvestigationEvent = z.infer<typeof investigationEventSchema>;
export type CreateInvestigationInput = z.infer<typeof createInvestigationSchema>;
export type LlmProvider = z.infer<typeof llmProviderSchema>;
export type SearchProvider = z.infer<typeof searchProviderSchema>;
export type ProviderUsage = z.infer<typeof providerUsageSchema>;
export type ProviderUsageDashboard = z.infer<typeof providerUsageDashboardSchema>;
export type ConversationRole = z.infer<typeof conversationRoleSchema>;
export type ConversationKind = z.infer<typeof conversationKindSchema>;
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;
export type InvestigationSummary = z.infer<typeof investigationSummarySchema>;
export type InvestigationList = z.infer<typeof investigationListSchema>;
export type CreateFollowUpInput = z.infer<typeof createFollowUpSchema>;
export type FollowUpAnswer = z.infer<typeof followUpAnswerSchema>;
