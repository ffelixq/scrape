import '@testing-library/jest-dom/vitest';
import { emptySearchCoverage } from '@proofline/contracts';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { investigationFixture } from '../../test/fixture';
import { DiscoveryCoverage } from './DiscoveryCoverage';

afterEach(cleanup);

function panel() {
  return screen.getByRole('region', { name: /search discovery coverage/i });
}

describe('discovery coverage', () => {
  it('shows both providers as channels that ran, not a primary and a spare', () => {
    render(<DiscoveryCoverage investigation={investigationFixture()} />);

    expect(within(panel()).getByText('Tavily')).toBeInTheDocument();
    expect(within(panel()).getByText('Serper')).toBeInTheDocument();
    expect(within(panel()).getByText('3 results')).toBeInTheDocument();
    expect(within(panel()).getByText('2 results')).toBeInTheDocument();
  });

  it('separates raw result rows from unique sources and independent origins', () => {
    // The fixture discovers 5 rows that reduce to 2 URLs, of which 1 origin is independent.
    render(<DiscoveryCoverage investigation={investigationFixture()} />);

    expect(within(panel()).getByText('result rows')).toBeInTheDocument();
    expect(within(panel()).getByText('unique sources')).toBeInTheDocument();
    expect(within(panel()).getByText('independent origins')).toBeInTheDocument();

    const steps = [...panel().querySelectorAll('.discovery-funnel li strong')].map(
      (node) => node.textContent,
    );
    expect(steps).toEqual(['5', '2', '1']);
  });

  it('says plainly that two providers agreeing is not two sources', () => {
    render(<DiscoveryCoverage investigation={investigationFixture()} />);

    expect(
      within(panel()).getByText(/surfaced by both providers and counted once/i),
    ).toBeInTheDocument();
  });

  it('reports narrowed coverage when queries failed', () => {
    const investigation = investigationFixture();
    investigation.searchCoverage = {
      ...investigation.searchCoverage,
      queriesFailed: 4,
      overlappingSources: 0,
    };
    render(<DiscoveryCoverage investigation={investigation} />);

    expect(within(panel()).getByText(/4 of 8 queries failed/i)).toBeInTheDocument();
    expect(within(panel()).getByText(/found separate pages/i)).toBeInTheDocument();
  });

  it('renders nothing for an investigation recorded before coverage was tracked', () => {
    const investigation = investigationFixture();
    investigation.searchCoverage = emptySearchCoverage;
    const { container } = render(<DiscoveryCoverage investigation={investigation} />);

    expect(container).toBeEmptyDOMElement();
  });
});
