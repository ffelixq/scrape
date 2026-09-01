import type { Investigation } from '@proofline/contracts';
import { useMemo } from 'react';
import { buildEvidenceSummary, strengthLabel } from '../../lib/investigation';

interface EvidenceSummaryPanelProps {
  investigation: Investigation;
}

function Meter({ label, score, tone }: { label: string; score: number; tone: string }) {
  const filled = Math.round((Math.min(100, Math.max(0, score)) / 100) * 10);
  return (
    <div className={`evidence-meter tone-${tone}`}>
      <div className="meter-label">
        <span>{label}</span>
        <strong>{strengthLabel(score)}</strong>
      </div>
      <div
        className="meter-track"
        role="meter"
        aria-valuenow={score}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        {Array.from({ length: 10 }, (_, index) => (
          <i key={index} className={index < filled ? 'on' : ''} />
        ))}
      </div>
      <small>{score}/100</small>
    </div>
  );
}

export function EvidenceSummaryPanel({ investigation }: EvidenceSummaryPanelProps) {
  const summary = useMemo(() => buildEvidenceSummary(investigation), [investigation]);

  const counts: Array<{ label: string; value: number; note: string; warn?: boolean }> = [
    {
      label: 'Sources investigated',
      value: summary.sourcesChecked,
      note: 'Retrieved inside the sandbox',
    },
    {
      label: 'Independent sources',
      value: summary.independentSources,
      note: `${summary.derivativeSources} derivative grouped`,
    },
    {
      label: 'Primary sources',
      value: summary.primarySources,
      note: 'Official or first-hand records',
    },
    {
      label: 'Contradictory claims',
      value: summary.contradictions,
      note: summary.contradictions ? 'Explained, not averaged' : 'None identified',
      warn: summary.contradictions > 0,
    },
    {
      label: 'False-consensus clusters',
      value: summary.falseConsensusClusters,
      note: summary.falseConsensusClusters ? 'Counted once by origin' : 'None detected',
      warn: summary.falseConsensusClusters > 0,
    },
  ];

  return (
    <div className="evidence-summary">
      <div className="evidence-counts">
        {counts.map((item) => (
          <article key={item.label} className={item.warn ? 'warn' : ''}>
            <strong>{String(item.value).padStart(2, '0')}</strong>
            <span>{item.label}</span>
            <small>{item.note}</small>
          </article>
        ))}
      </div>
      <div className="evidence-meters">
        <Meter label="Supporting evidence" score={summary.supportingScore} tone="support" />
        <Meter label="Opposing evidence" score={summary.opposingScore} tone="oppose" />
        <Meter label="Overall evidence" score={summary.overallScore} tone="overall" />
        <p className="evidence-meter-note">
          {summary.supportingLinks} supporting and {summary.opposingLinks} opposing evidence links
          survived citation validation. Strength combines citation weight with breadth across
          independent origins.
        </p>
      </div>
    </div>
  );
}
