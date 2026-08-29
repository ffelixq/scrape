import type { Investigation } from '@proofline/contracts';

export function buildDemoInvestigation(id: string, question: string): Investigation {
  const now = new Date().toISOString();
  const prefix = id.slice(0, 8);
  const sources = [
    {
      id: `${prefix}-filing`,
      title: 'FY2025 audited financial statements',
      publisher: 'Corporate Registry Filing',
      url: 'https://example.com/demo/registry-filing',
      publishedAt: '2026-04-12T00:00:00.000Z',
      accessedAt: now,
      tier: 'PRIMARY' as const,
      reliabilityScore: 94,
      independenceGroup: 'registry-filing-2025',
      isPrimary: true,
      isDuplicate: false,
      excerpt: 'Audited revenue increased by 22.4% year over year.',
    },
    {
      id: `${prefix}-lender`,
      title: 'Notice of covenant review',
      publisher: 'Lender Disclosure Portal',
      url: 'https://example.com/demo/lender-notice',
      publishedAt: '2026-07-18T00:00:00.000Z',
      accessedAt: now,
      tier: 'PRIMARY' as const,
      reliabilityScore: 91,
      independenceGroup: 'lender-july-2026',
      isPrimary: true,
      isDuplicate: false,
      excerpt: 'The borrower entered review after falling below a minimum liquidity covenant.',
    },
    {
      id: `${prefix}-registry`,
      title: 'Approved vendor search result',
      publisher: 'Public Procurement Registry',
      url: 'https://example.com/demo/vendor-registry',
      publishedAt: '2026-08-28T00:00:00.000Z',
      accessedAt: now,
      tier: 'PRIMARY' as const,
      reliabilityScore: 96,
      independenceGroup: 'procurement-registry',
      isPrimary: true,
      isDuplicate: false,
      excerpt: 'No active Tier-1 certification was returned for the entity identifier provided.',
    },
    {
      id: `${prefix}-article`,
      title: 'Meridian reports record expansion year',
      publisher: 'Industry Newswire',
      url: 'https://example.com/demo/newswire',
      publishedAt: '2026-04-15T00:00:00.000Z',
      accessedAt: now,
      tier: 'SECONDARY' as const,
      reliabilityScore: 51,
      independenceGroup: 'company-release-april',
      isPrimary: false,
      isDuplicate: true,
      excerpt: 'The company described itself as a certified Tier-1 supplier.',
    },
  ];

  const claims = [
    {
      id: `${prefix}-growth`,
      text: 'FY2025 revenue increased by approximately 22.4%.',
      status: 'WELL_SUPPORTED' as const,
      evidenceStrength: 92,
      rationale: 'The calculation comes from audited comparative statements.',
      supportCount: 1,
      opposeCount: 0,
    },
    {
      id: `${prefix}-liquidity`,
      text: 'The company has enough present liquidity for a two-year commitment.',
      status: 'CONTRADICTED' as const,
      evidenceStrength: 74,
      rationale: 'A more recent lender notice conflicts with the year-end balance sheet.',
      supportCount: 1,
      opposeCount: 1,
    },
    {
      id: `${prefix}-certification`,
      text: 'The claimed Tier-1 supplier certification is current.',
      status: 'LIKELY_FALSE' as const,
      evidenceStrength: 78,
      rationale:
        'Positive coverage traces to one company release; the registry returned no record.',
      supportCount: 1,
      opposeCount: 1,
    },
  ];
  const filing = sources[0]!;
  const lender = sources[1]!;
  const registry = sources[2]!;
  const article = sources[3]!;
  const growthClaim = claims[0]!;
  const liquidityClaim = claims[1]!;
  const certificationClaim = claims[2]!;

  return {
    id,
    question,
    status: 'COMPLETED',
    verdict: 'INCONCLUSIVE',
    answer:
      'The evidence verifies historic growth but does not establish present readiness for the decision. A more recent liquidity disclosure contradicts the year-end position, and a material certification claim has no independent confirmation. Obtain current primary records before proceeding.',
    evidenceStrength: 61,
    createdAt: now,
    completedAt: now,
    limitations: [
      'This credential-free run uses an illustrative evidence set.',
      'Private bank statements and current ageing schedules were not available.',
    ],
    sources,
    claims,
    evidence: [
      {
        id: `${prefix}-ev1`,
        claimId: growthClaim.id,
        sourceId: filing.id,
        relation: 'SUPPORTS',
        excerpt: filing.excerpt,
        location: 'Note 4, p. 38',
        weight: 0.96,
      },
      {
        id: `${prefix}-ev2`,
        claimId: liquidityClaim.id,
        sourceId: filing.id,
        relation: 'SUPPORTS',
        excerpt: 'Current assets exceeded liabilities at year end.',
        location: 'Balance sheet, p. 14',
        weight: 0.79,
      },
      {
        id: `${prefix}-ev3`,
        claimId: liquidityClaim.id,
        sourceId: lender.id,
        relation: 'OPPOSES',
        excerpt: lender.excerpt,
        location: 'Paragraph 3',
        weight: 0.94,
      },
      {
        id: `${prefix}-ev4`,
        claimId: certificationClaim.id,
        sourceId: article.id,
        relation: 'SUPPORTS',
        excerpt: article.excerpt,
        location: 'Paragraph 5',
        weight: 0.31,
      },
      {
        id: `${prefix}-ev5`,
        claimId: certificationClaim.id,
        sourceId: registry.id,
        relation: 'OPPOSES',
        excerpt: registry.excerpt,
        location: 'Registry result',
        weight: 0.91,
      },
    ],
    contradictions: [
      {
        id: `${prefix}-contra1`,
        claimId: liquidityClaim.id,
        summary:
          'The year-end filing shows adequate liquidity; a later lender notice reports a covenant breach.',
        resolution: 'The conflict is date-driven. The more recent primary source is more relevant.',
        reason: 'DATE',
        sourceIds: [filing.id, lender.id],
      },
      {
        id: `${prefix}-contra2`,
        claimId: certificationClaim.id,
        summary:
          'Industry coverage claims certification while the official registry returns no active record.',
        resolution:
          'The positive pages are derivative. Require a certificate identifier before relying on the claim.',
        reason: 'METHODOLOGY',
        sourceIds: [registry.id, article.id],
      },
    ],
    securityEvents: [
      {
        id: `${prefix}-sec1`,
        severity: 'BLOCKED',
        category: 'PROMPT_INJECTION',
        message:
          'Potential prompt injection detected — content isolated — research continued safely.',
        sourceId: article.id,
        detectedAt: now,
      },
    ],
    metrics: {
      sourcesChecked: 14,
      independentSources: 6,
      primarySources: 3,
      contradictions: 2,
      falseConsensusClusters: 1,
    },
    audit: {
      supportingAgentSummary:
        'Audited growth and positive year-end working capital support the case.',
      opposingAgentSummary:
        'The later covenant review and unverifiable certification weaken it materially.',
      auditorSummary:
        'Growth is supported; present readiness is not verified. Current primary evidence is required.',
    },
  };
}
