import type { Investigation, InvestigationSummary } from '@proofline/contracts';

const TITLE_MAX_LENGTH = 64;

/**
 * A short label for the history list. The question stays the record of what was asked; the
 * title only has to be recognisable in a narrow sidebar.
 */
export function deriveTitle(question: string): string {
  const normalized = question
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[?.!,;:]+$/, '');
  if (normalized.length <= TITLE_MAX_LENGTH) return normalized;
  const clipped = normalized.slice(0, TITLE_MAX_LENGTH);
  const lastSpace = clipped.lastIndexOf(' ');
  return `${(lastSpace > 24 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
}

export function toSummary(investigation: Investigation): InvestigationSummary {
  return {
    id: investigation.id,
    title: deriveTitle(investigation.question),
    question: investigation.question,
    status: investigation.status,
    verdict: investigation.verdict,
    evidenceStrength: investigation.evidenceStrength,
    createdAt: investigation.createdAt,
    completedAt: investigation.completedAt,
    sourcesChecked: investigation.metrics.sourcesChecked,
    independentSources: investigation.metrics.independentSources,
    contradictions: investigation.metrics.contradictions,
    messageCount: investigation.messages.length,
  };
}
