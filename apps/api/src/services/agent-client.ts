import {
  investigationSchema,
  providerUsageDashboardSchema,
  type CreateInvestigationInput,
  type Investigation,
  type ProviderUsageDashboard,
} from '@proofline/contracts';
import { appConfig } from '../config.js';

export async function runAgentInvestigation(
  id: string,
  input: CreateInvestigationInput,
): Promise<Investigation> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), appConfig.researchTimeoutMs);
  try {
    const response = await fetch(`${appConfig.agentServiceUrl}/investigate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${appConfig.internalAgentToken}`,
      },
      body: JSON.stringify({
        investigation_id: id,
        question: input.question,
        context: input.context,
        mode: input.mode,
        llm_provider: input.llmProvider,
        search_provider: input.searchProvider,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text();
      let detail = body;
      try {
        const parsed = JSON.parse(body) as { detail?: string };
        detail = parsed.detail ?? body;
      } catch {
        // Preserve plain-text errors from upstream proxies.
      }
      throw new Error(`Agent service returned ${response.status}: ${detail.slice(0, 300)}`);
    }
    return investigationSchema.parse(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

export async function getAgentProviderUsage(): Promise<ProviderUsageDashboard> {
  const response = await fetch(`${appConfig.agentServiceUrl}/usage`, {
    headers: { Authorization: `Bearer ${appConfig.internalAgentToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Agent usage service returned ${response.status}`);
  }
  return providerUsageDashboardSchema.parse(await response.json());
}
