import {
  investigationSchema,
  type CreateInvestigationInput,
  type Investigation,
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
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Agent service returned ${response.status}: ${body.slice(0, 200)}`);
    }
    return investigationSchema.parse(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}
