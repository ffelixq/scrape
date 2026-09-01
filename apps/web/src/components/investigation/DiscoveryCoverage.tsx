import type { Investigation } from '@proofline/contracts';

interface DiscoveryCoverageProps {
  investigation: Investigation;
}

const PROVIDER_LABELS: Record<string, string> = {
  tavily: 'Tavily',
  serper: 'Serper',
};

const PROVIDER_ROLES: Record<string, string> = {
  tavily: 'AI research discovery',
  serper: 'Google document discovery',
};

/**
 * The discovery funnel, stated as arithmetic the reader can check.
 *
 * Two search providers returning the same page is the ordinary case, so showing raw result rows
 * next to unique URLs next to independent origins is what stops "19 results" from being misread
 * as nineteen corroborating sources. Result rows are leads; only the rightmost number counts
 * distinct origins, and it is the one the verdict rests on.
 */
export function DiscoveryCoverage({ investigation }: DiscoveryCoverageProps) {
  const coverage = investigation.searchCoverage;
  // Investigations recorded before coverage was tracked carry the zeroed default; there is
  // nothing truthful to show for them.
  if (coverage.queriesIssued === 0) return null;

  const providers = Object.entries(coverage.resultsByProvider);
  const busiest = Math.max(1, ...providers.map(([, count]) => count));
  const funnel = [
    {
      value: coverage.resultsDiscovered,
      label: 'result rows',
      note: 'Returned by the providers',
    },
    {
      value: coverage.uniqueSources,
      label: 'unique sources',
      note: 'After URL deduplication',
    },
    {
      value: investigation.metrics.independentSources,
      label: 'independent origins',
      note: 'After provenance analysis',
    },
  ];

  return (
    <section className="discovery-coverage" aria-label="Search discovery coverage">
      <header>
        <h4>Discovery coverage</h4>
        <p>
          Search providers decide where to look, never what is true. Both channels run on every
          investigation with their own queries.
        </p>
      </header>

      <ul className="discovery-providers">
        {providers.map(([provider, count]) => (
          <li key={provider}>
            <span className="provider-name">{PROVIDER_LABELS[provider] ?? provider}</span>
            <span className="provider-bar" aria-hidden="true">
              <i style={{ width: `${Math.round((count / busiest) * 100)}%` }} />
            </span>
            <span className="provider-count">
              {count} {count === 1 ? 'result' : 'results'}
            </span>
            <small>{PROVIDER_ROLES[provider] ?? 'Discovery channel'}</small>
          </li>
        ))}
      </ul>

      <ol className="discovery-funnel">
        {funnel.map((step, index) => (
          <li key={step.label} className={index === funnel.length - 1 ? 'terminal' : ''}>
            <strong>{step.value}</strong>
            <span>{step.label}</span>
            <small>{step.note}</small>
          </li>
        ))}
      </ol>

      <p className="discovery-note">
        {coverage.overlappingSources > 0
          ? `${coverage.overlappingSources} ${
              coverage.overlappingSources === 1 ? 'source was' : 'sources were'
            } surfaced by both providers and counted once — two providers agreeing is not two sources.`
          : 'No source was surfaced by both providers; the two channels found separate pages.'}
        {coverage.queriesFailed > 0
          ? ` ${coverage.queriesFailed} of ${coverage.queriesIssued} queries failed, so coverage is narrower than intended.`
          : ` All ${coverage.queriesIssued} queries completed.`}
      </p>
    </section>
  );
}
