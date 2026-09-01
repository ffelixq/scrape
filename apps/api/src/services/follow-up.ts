import type { EvidenceStatus, FollowUpAnswer, Investigation, Source } from '@proofline/contracts';

const PRIMARY_TIERS = new Set(['PRIMARY', 'AUTHORITATIVE']);

function verdictWords(verdict: EvidenceStatus | null): string {
  return (verdict ?? 'PENDING').replaceAll('_', ' ').toLowerCase();
}

function describe(source: Source): string {
  return `${source.title} (${source.publisher}, ${source.tier.toLowerCase()}, reliability ${source.reliabilityScore}/100)`;
}

/**
 * Demo-mode follow-up answers.
 *
 * Demo mode never reaches an inference provider, so this reads the investigation record itself
 * and answers from what is already on the record. It states only what the stored evidence shows,
 * and says plainly when the record cannot answer the question.
 */
export function buildDeterministicFollowUp(
  investigation: Investigation,
  question: string,
): FollowUpAnswer {
  const asked = question.toLowerCase();
  const sources = investigation.sources;
  const limitations = [
    'Illustrative run: this answer reads the stored record without new research.',
  ];

  const wantsReliability = /reliab|strong|best|trust|which source/.test(asked);
  const wantsPrimary = /primary|official|filing|ignore news|only use/.test(asked);
  const wantsContradiction = /contradict|conflict|dispute|against|oppos/.test(asked);
  const wantsOrigin = /origin|where did|provenance|copied|derivative|consensus/.test(asked);

  if (wantsContradiction) {
    const opposing = investigation.evidence.filter((item) => item.relation === 'OPPOSES');
    if (investigation.contradictions.length === 0 && opposing.length === 0) {
      return {
        answer: `No contradiction was recorded in this investigation. The verdict is ${verdictWords(investigation.verdict)} on evidence strength ${investigation.evidenceStrength}/100.`,
        kind: 'FOLLOW_UP',
        citedSourceIds: [],
        limitations,
      };
    }
    const lines = investigation.contradictions.map(
      (item) =>
        `• ${item.summary} Resolution: ${item.resolution} (${item.reason.replaceAll('_', ' ').toLowerCase()} difference).`,
    );
    return {
      answer: [
        `${investigation.contradictions.length} contradiction${investigation.contradictions.length === 1 ? ' was' : 's were'} investigated, alongside ${opposing.length} opposing evidence link${opposing.length === 1 ? '' : 's'}.`,
        ...lines,
      ].join('\n'),
      kind: 'FOLLOW_UP',
      citedSourceIds: [...new Set(investigation.contradictions.flatMap((item) => item.sourceIds))],
      limitations,
    };
  }

  if (wantsOrigin) {
    const groups = new Map<string, Source[]>();
    for (const source of sources) {
      groups.set(source.independenceGroup, [
        ...(groups.get(source.independenceGroup) ?? []),
        source,
      ]);
    }
    const clusters = [...groups.entries()].filter(([, members]) => members.length > 1);
    const lines = [...groups.entries()].map(
      ([group, members]) =>
        `• ${group}: ${members.length} document${members.length === 1 ? '' : 's'} — ${members.map((item) => item.publisher).join(', ')}`,
    );
    return {
      answer: [
        `${sources.length} document${sources.length === 1 ? '' : 's'} trace back to ${groups.size} independent origin${groups.size === 1 ? '' : 's'}. ${clusters.length} cluster${clusters.length === 1 ? '' : 's'} repeat a shared origin and are counted once.`,
        ...lines,
      ].join('\n'),
      kind: 'FOLLOW_UP',
      citedSourceIds: sources.map((source) => source.id),
      limitations,
    };
  }

  if (wantsPrimary) {
    const primary = sources.filter((source) => source.isPrimary || PRIMARY_TIERS.has(source.tier));
    if (primary.length === 0) {
      return {
        answer:
          'No primary or authoritative source survived the evidence gate in this investigation, so restricting the analysis to primary sources leaves nothing to conclude from. The verdict would become unverifiable.',
        kind: 'FOLLOW_UP',
        citedSourceIds: [],
        limitations,
      };
    }
    const primaryIds = new Set(primary.map((source) => source.id));
    const kept = investigation.evidence.filter((item) => primaryIds.has(item.sourceId));
    const supporting = kept.filter((item) => item.relation === 'SUPPORTS').length;
    const opposing = kept.filter((item) => item.relation === 'OPPOSES').length;
    return {
      answer: [
        `Re-evaluated on primary evidence only. ${primary.length} of ${sources.length} sources qualify, carrying ${kept.length} evidence link${kept.length === 1 ? '' : 's'} (${supporting} supporting, ${opposing} opposing).`,
        ...primary.map((source) => `• ${describe(source)}`),
        opposing > 0
          ? 'The opposing primary evidence survives this filter, so the verdict does not strengthen.'
          : 'Removing secondary coverage narrows the evidence base but does not add independent support.',
      ].join('\n'),
      kind: 'FOLLOW_UP',
      citedSourceIds: primary.map((source) => source.id),
      limitations,
    };
  }

  if (wantsReliability) {
    const ranked = [...sources].sort((a, b) => b.reliabilityScore - a.reliabilityScore).slice(0, 3);
    if (ranked.length === 0) {
      return {
        answer:
          'This investigation exported no sources, so there is no reliability ranking to give.',
        kind: 'FOLLOW_UP',
        citedSourceIds: [],
        limitations,
      };
    }
    return {
      answer: [
        `The ${ranked.length} strongest source${ranked.length === 1 ? '' : 's'} on the record:`,
        ...ranked.map(
          (source, index) =>
            `${index + 1}. ${describe(source)}${source.isDuplicate ? ' — derivative of another origin' : ' — independent origin'}`,
        ),
      ].join('\n'),
      kind: 'FOLLOW_UP',
      citedSourceIds: ranked.map((source) => source.id),
      limitations,
    };
  }

  const strongest = [...investigation.claims].sort(
    (a, b) => b.evidenceStrength - a.evidenceStrength,
  )[0];
  return {
    answer: [
      `Working from the existing record: the verdict is ${verdictWords(investigation.verdict)} at ${investigation.evidenceStrength}/100 evidence strength, over ${investigation.metrics.sourcesChecked} documents from ${investigation.metrics.independentSources} independent origins.`,
      strongest
        ? `The best-evidenced claim is “${strongest.text}” (${strongest.status.replaceAll('_', ' ').toLowerCase()}, ${strongest.evidenceStrength}/100).`
        : 'No claim survived the evidence gate.',
      investigation.limitations[0]
        ? `What still blocks a stronger conclusion: ${investigation.limitations[0]}`
        : 'No material evidence gap was recorded.',
    ].join('\n'),
    kind: 'FOLLOW_UP',
    citedSourceIds: sources.slice(0, 3).map((source) => source.id),
    limitations,
  };
}
