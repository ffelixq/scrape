import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { investigationFixture } from '../../test/fixture';

// The canvas itself is covered by the graph-model tests; React Flow needs a real layout engine.
vi.mock('../EvidenceGraph', () => ({
  EvidenceGraph: () => <div data-testid="evidence-graph" />,
}));

import { InvestigationView } from './InvestigationView';

beforeAll(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(cleanup);

const noop = () => undefined;

describe('the finished investigation document', () => {
  it('leads with the verdict and evidence strength, then the reasoning', () => {
    render(
      <InvestigationView investigation={investigationFixture()} askPending={false} onAsk={noop} />,
    );

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/two-year contract/i);
    expect(screen.getByText(/FINAL VERDICT · INCONCLUSIVE/)).toBeInTheDocument();
    expect(screen.getByText('EVIDENCE STRENGTH')).toBeInTheDocument();
    expect(screen.getByText('61')).toBeInTheDocument();
    expect(screen.getByText(/Downgraded by the evidence gate/i)).toBeInTheDocument();

    // The hierarchy runs verdict → findings → both cases → self-doubt → evidence → graph → sources.
    const sections = [...document.querySelectorAll('section[id]')].map((node) => node.id);
    expect(sections).toEqual([
      'verdict',
      'findings',
      'cases',
      'doubt',
      'evidence',
      'graph',
      'sources',
      'conversation',
    ]);
    expect(screen.getByText('DESIGNED TO DOUBT ITSELF')).toBeInTheDocument();
    expect(screen.getByText('Sources investigated')).toBeInTheDocument();
    expect(screen.getByTestId('evidence-graph')).toBeInTheDocument();
  });

  it('shows live research status instead of a report while the run is in flight', () => {
    render(
      <InvestigationView
        investigation={investigationFixture({ status: 'RESEARCHING', completedAt: null })}
        askPending={false}
        onAsk={noop}
      />,
    );

    expect(screen.getByText('Secure retrieval')).toBeInTheDocument();
    expect(screen.getByText('LIVE RUN')).toBeInTheDocument();
    expect(screen.queryByText(/FINAL VERDICT/)).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: /Report sections/i })).not.toBeInTheDocument();
  });
});
