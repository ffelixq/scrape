import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('./components/TruthScene', () => ({ TruthScene: () => <div data-testid="truth-scene" /> }));

import { App } from './App';

beforeAll(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise(() => undefined)),
  );
});

describe('Proofline public experience', () => {
  it('opens a live investigation workspace from the hero', async () => {
    render(<App />);
    expect(screen.getByText(/Evidence before/i)).toBeInTheDocument();
    // The retrieval toolchain is stated here because it is fixed: none of it is selectable in
    // the form, and discovery is listed separately from the sandbox that actually opens pages.
    const infrastructure = screen.getByLabelText(/Research infrastructure/i);
    expect(infrastructure).toHaveTextContent(/TAVILY \+ SERPER\s*SOURCE DISCOVERY/i);
    expect(infrastructure).toHaveTextContent(/DAYTONA\s*ISOLATED COMPUTE/i);
    expect(infrastructure).toHaveTextContent(/PLAYWRIGHT\s*PAGE RETRIEVAL/i);
    expect(infrastructure).toHaveTextContent(/PYMUPDF\s*DOCUMENT EXTRACTION/i);
    expect(infrastructure).not.toHaveTextContent(/NOSANA/i);

    fireEvent.change(screen.getByLabelText(/Research question/i), {
      target: { value: 'Is this company financially healthy enough to invest in?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Investigate/i }));

    // The question opens as a tab in the workspace and shows what the run is doing right now.
    // The workspace is a lazy chunk, so the tab is awaited rather than asserted synchronously.
    const tab = await screen.findByRole('tab', { selected: true }, { timeout: 8_000 });
    expect(tab).toHaveTextContent(/Is this company financially heal/i);
    expect(screen.getByText('RESEARCHING')).toBeInTheDocument();
    expect(screen.getByText('Daytona sandbox')).toBeInTheDocument();
    expect(screen.getByText('Initial thesis')).toBeInTheDocument();
  });
});
