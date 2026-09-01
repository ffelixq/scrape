import {
  createFollowUpSchema,
  createInvestigationSchema,
  investigationListSchema,
  investigationSchema,
  providerUsageDashboardSchema,
  type CreateInvestigationInput,
  type LlmProvider,
  type Investigation,
  type InvestigationSummary,
  type ProviderUsageDashboard,
} from '@proofline/contracts';

const API_URL = import.meta.env.VITE_API_URL || '/api';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(body?.error || 'Proofline could not complete the request.', response.status);
  }

  return response.json() as Promise<T>;
}

export async function createInvestigation(input: CreateInvestigationInput): Promise<Investigation> {
  const payload = createInvestigationSchema.parse(input);
  const data = await request<unknown>('/investigations', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return investigationSchema.parse(data);
}

export async function getInvestigation(id: string): Promise<Investigation> {
  const data = await request<unknown>(`/investigations/${encodeURIComponent(id)}`);
  return investigationSchema.parse(data);
}

export async function listInvestigations(): Promise<InvestigationSummary[]> {
  const data = await request<unknown>('/investigations');
  return investigationListSchema.parse(data).investigations;
}

export async function deleteInvestigation(id: string): Promise<void> {
  const response = await fetch(`${API_URL}/investigations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!response.ok && response.status !== 404) {
    throw new ApiError('The investigation could not be deleted.', response.status);
  }
}

/**
 * Ask a follow-up against an existing investigation.
 *
 * A failed answer still updates the record: the API stores the question and an assistant turn
 * marked `failed`, and returns the investigation with a 502. Returning that record keeps the
 * conversation truthful about what happened instead of dropping the exchange.
 */
export async function askFollowUp(
  id: string,
  input: { question: string; llmProvider?: LlmProvider },
): Promise<Investigation> {
  const payload = createFollowUpSchema.parse(input);
  const response = await fetch(`${API_URL}/investigations/${encodeURIComponent(id)}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => null)) as unknown;
  const parsed = investigationSchema.safeParse(body);
  if (parsed.success) return parsed.data;
  if (!response.ok) {
    const error = body as { error?: string } | null;
    throw new ApiError(error?.error || 'The follow-up could not be answered.', response.status);
  }
  throw new ApiError('The follow-up response could not be read.', response.status);
}

export async function getProviderUsage(): Promise<ProviderUsageDashboard> {
  const data = await request<unknown>('/usage');
  return providerUsageDashboardSchema.parse(data);
}

export function subscribeToInvestigation(
  id: string,
  onUpdate: (investigation: Investigation) => void,
  onError?: () => void,
): () => void {
  const events = new EventSource(`${API_URL}/investigations/${encodeURIComponent(id)}/events`);
  events.addEventListener('investigation', (event) => {
    const parsed = investigationSchema.safeParse(JSON.parse((event as MessageEvent<string>).data));
    if (parsed.success) onUpdate(parsed.data);
  });
  events.onerror = () => onError?.();
  return () => events.close();
}
