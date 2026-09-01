import type {
  EvidenceStatus,
  Investigation,
  InvestigationStatus,
  Source,
} from '@proofline/contracts';

export const statusClass: Record<EvidenceStatus, string> = {
  SUPPORTED: 'supported',
  WELL_SUPPORTED: 'well-supported',
  INCONCLUSIVE: 'inconclusive',
  CONTRADICTED: 'contradicted',
  LIKELY_FALSE: 'likely-false',
  UNVERIFIABLE: 'unverifiable',
};

/**
 * The orchestrator records a gate intervention in prose. Matching it here is what lets the
 * interface show the moment the deterministic gate overruled the model instead of hiding it in a
 * limitations list.
 */
const GATE_MARKER = /deterministic evidence gate/i;

export function isRunning(status: InvestigationStatus): boolean {
  return status === 'QUEUED' || status === 'RESEARCHING' || status === 'AUDITING';
}

export function caseLabel(id: string): string {
  return `PL–${id
    .replaceAll('-', '')
    .replace(/^draft:?/i, '')
    .slice(0, 8)
    .toUpperCase()}`;
}

export function formatDuration(start: string, end: string | null): string {
  if (!end) return 'In progress';
  const seconds = Math.max(
    0,
    Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1_000),
  );
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

export function strengthLabel(score: number): string {
  if (score >= 75) return 'Strong';
  if (score >= 45) return 'Moderate';
  if (score >= 20) return 'Limited';
  return 'Minimal';
}

export function strengthNote(score: number): string {
  if (score >= 80) return 'Independently corroborated across origins.';
  if (score >= 60) return 'Usable, with material gaps to review.';
  if (score >= 30) return 'Important gaps remain in the evidence.';
  return 'Not enough evidence for a reliable conclusion.';
}

export interface GateInterventions {
  verdictDowngraded: boolean;
  downgradedClaims: number;
  notes: string[];
}

export function gateInterventions(investigation: Investigation): GateInterventions {
  const notes = investigation.limitations.filter((item) => GATE_MARKER.test(item));
  const downgradedClaims = investigation.claims.filter((claim) =>
    GATE_MARKER.test(claim.rationale),
  ).length;
  return { verdictDowngraded: notes.length > 0, downgradedClaims, notes };
}

export interface EvidenceSummary {
  sourcesChecked: number;
  independentSources: number;
  primarySources: number;
  derivativeSources: number;
  contradictions: number;
  falseConsensusClusters: number;
  supportingLinks: number;
  opposingLinks: number;
  supportingScore: number;
  opposingScore: number;
  overallScore: number;
}

function meanWeight(weights: number[]): number {
  if (!weights.length) return 0;
  return Math.round((weights.reduce((total, weight) => total + weight, 0) / weights.length) * 100);
}

export function buildEvidenceSummary(investigation: Investigation): EvidenceSummary {
  const supporting = investigation.evidence.filter((item) => item.relation === 'SUPPORTS');
  const opposing = investigation.evidence.filter((item) => item.relation === 'OPPOSES');
  const { metrics } = investigation;
  return {
    sourcesChecked: metrics.sourcesChecked,
    independentSources: metrics.independentSources,
    primarySources: metrics.primarySources,
    derivativeSources: Math.max(0, metrics.sourcesChecked - metrics.independentSources),
    contradictions: metrics.contradictions,
    falseConsensusClusters: metrics.falseConsensusClusters,
    supportingLinks: supporting.length,
    opposingLinks: opposing.length,
    supportingScore: meanWeight(supporting.map((item) => item.weight)),
    opposingScore: meanWeight(opposing.map((item) => item.weight)),
    overallScore: investigation.evidenceStrength,
  };
}

export type StageState = 'DONE' | 'ACTIVE' | 'PENDING';
export type StageShift = 'STRONGER' | 'WEAKER' | 'UNCHANGED' | 'PENDING';

export interface DoubtStage {
  id: string;
  title: string;
  /** What this step of the method does, in one line. */
  purpose: string;
  state: StageState;
  /** What actually happened in this investigation at this step. */
  detail: string;
  findings: string[];
  sourceIds: string[];
  shift: StageShift;
}

/** How far a live run has progressed through the seven stages. */
function activeStageIndex(status: InvestigationStatus): number {
  if (status === 'QUEUED') return 0;
  if (status === 'RESEARCHING') return 2;
  if (status === 'AUDITING') return 5;
  return 7;
}

function firstSentence(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.length > 240 ? `${trimmed.slice(0, 237)}…` : trimmed;
}

/**
 * Turn a stored investigation into the self-doubt narrative: what was proposed, how it was
 * attacked, what the attack found, and whether the conclusion survived it.
 *
 * Every stage is derived from recorded evidence — never invented — so a stage that found nothing
 * says so rather than implying work that did not happen.
 */
export function buildDoubtStages(investigation: Investigation): DoubtStage[] {
  const running = isRunning(investigation.status);
  const activeIndex = activeStageIndex(investigation.status);
  const summary = buildEvidenceSummary(investigation);
  const gate = gateInterventions(investigation);
  const supportingSourceIds = [
    ...new Set(
      investigation.evidence.filter((i) => i.relation === 'SUPPORTS').map((i) => i.sourceId),
    ),
  ];
  const opposingSourceIds = [
    ...new Set(
      investigation.evidence.filter((i) => i.relation === 'OPPOSES').map((i) => i.sourceId),
    ),
  ];
  const derivative = investigation.sources.filter((source) => source.isDuplicate);
  const originGroups = new Set(investigation.sources.map((source) => source.independenceGroup));

  const stages: Array<Omit<DoubtStage, 'state'>> = [
    {
      id: 'thesis',
      title: 'Initial thesis',
      purpose: 'State the strongest version of the case before trying to break it.',
      detail: firstSentence(
        investigation.audit.supportingAgentSummary,
        'The supporting case has not been formed yet.',
      ),
      findings: summary.supportingLinks
        ? [`${summary.supportingLinks} supporting evidence links passed citation validation.`]
        : [],
      sourceIds: supportingSourceIds,
      shift: 'UNCHANGED',
    },
    {
      id: 'challenge',
      title: 'Challenge the conclusion',
      purpose: 'A skeptic argues the opposite case against the same evidence bundle.',
      detail: firstSentence(
        investigation.audit.opposingAgentSummary,
        'The adversarial challenge has not run yet.',
      ),
      findings: summary.opposingLinks
        ? [`${summary.opposingLinks} opposing evidence links passed citation validation.`]
        : ['No opposing claim survived citation validation.'],
      sourceIds: opposingSourceIds,
      shift: summary.opposingLinks ? 'WEAKER' : 'UNCHANGED',
    },
    {
      id: 'counter-evidence',
      title: 'Search for opposing evidence',
      purpose: 'Look specifically for newer disclosures, counterexamples and absent support.',
      detail: opposingSourceIds.length
        ? `${opposingSourceIds.length} of ${summary.sourcesChecked} retrieved sources carry evidence against the case.`
        : 'No retrieved source contradicted the case with a validated excerpt.',
      findings: investigation.claims
        .filter((claim) => claim.opposeCount > 0)
        .slice(0, 3)
        .map((claim) => `Opposed: ${claim.text}`),
      sourceIds: opposingSourceIds,
      shift: opposingSourceIds.length ? 'WEAKER' : 'UNCHANGED',
    },
    {
      id: 'contradictions',
      title: 'Investigate contradictions',
      purpose: 'Explain conflicting figures by cause instead of averaging them away.',
      detail: investigation.contradictions.length
        ? `${investigation.contradictions.length} contradiction${investigation.contradictions.length === 1 ? '' : 's'} investigated and explained.`
        : 'No contradiction was found between the validated sources.',
      findings: investigation.contradictions
        .slice(0, 3)
        .map(
          (item) =>
            `${item.reason.replaceAll('_', ' ').toLowerCase()} difference — ${item.summary}`,
        ),
      sourceIds: [...new Set(investigation.contradictions.flatMap((item) => item.sourceIds))],
      shift: investigation.contradictions.length ? 'WEAKER' : 'UNCHANGED',
    },
    {
      id: 'provenance',
      title: 'Trace sources to their origin',
      purpose: 'Count agreement by origin, so repeated copies of one release count once.',
      detail: `${summary.sourcesChecked} documents trace to ${originGroups.size || summary.independentSources} independent origin${(originGroups.size || summary.independentSources) === 1 ? '' : 's'}.`,
      findings: [
        summary.falseConsensusClusters
          ? `${summary.falseConsensusClusters} false-consensus cluster${summary.falseConsensusClusters === 1 ? '' : 's'} collapsed to a single origin.`
          : 'No false-consensus cluster was detected.',
        derivative.length
          ? `${derivative.length} derivative source${derivative.length === 1 ? '' : 's'} down-weighted.`
          : 'No derivative source was down-weighted.',
      ],
      sourceIds: derivative.map((source) => source.id),
      shift: summary.falseConsensusClusters || derivative.length ? 'WEAKER' : 'UNCHANGED',
    },
    {
      id: 're-evaluation',
      title: 'Re-evaluate',
      purpose: 'The deterministic gate re-scores the conclusion against surviving evidence.',
      detail: gate.verdictDowngraded
        ? 'The evidence gate downgraded the model’s proposed verdict.'
        : gate.downgradedClaims
          ? `${gate.downgradedClaims} claim${gate.downgradedClaims === 1 ? '' : 's'} lost status when citations failed validation.`
          : 'The proposed conclusion survived the evidence gate unchanged.',
      findings: gate.notes.length ? gate.notes : investigation.limitations.slice(0, 2),
      sourceIds: [],
      shift: gate.verdictDowngraded || gate.downgradedClaims ? 'WEAKER' : 'UNCHANGED',
    },
    {
      id: 'verdict',
      title: 'Final verdict',
      purpose: 'Publish only what the surviving evidence supports.',
      detail: investigation.answer ?? 'No conclusion has been produced yet.',
      findings: [
        `Evidence strength ${summary.overallScore}/100 · ${strengthLabel(summary.overallScore)}.`,
      ],
      sourceIds: [],
      shift:
        investigation.verdict === 'WELL_SUPPORTED' || investigation.verdict === 'SUPPORTED'
          ? 'STRONGER'
          : investigation.verdict === 'CONTRADICTED' || investigation.verdict === 'LIKELY_FALSE'
            ? 'WEAKER'
            : 'UNCHANGED',
    },
  ];

  return stages.map((stage, index) => {
    if (!running) return { ...stage, state: 'DONE' as StageState };
    if (index < activeIndex) return { ...stage, state: 'DONE' as StageState };
    if (index === activeIndex) return { ...stage, state: 'ACTIVE' as StageState };
    return {
      ...stage,
      state: 'PENDING' as StageState,
      detail: 'Waiting for the previous stage.',
      findings: [],
      sourceIds: [],
      shift: 'PENDING' as StageShift,
    };
  });
}

export function sourcesById(investigation: Investigation): Map<string, Source> {
  return new Map(investigation.sources.map((source) => [source.id, source]));
}
