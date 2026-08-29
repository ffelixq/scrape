import {
  createInvestigationSchema,
  investigationSchema,
  type CreateInvestigationInput,
  type Investigation,
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
