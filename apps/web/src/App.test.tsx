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
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
});

describe('Proofline public experience', () => {
  it('starts an evidence investigation from the hero', async () => {
    render(<App />);
    expect(screen.getByText(/Evidence before/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Research question/i), {
      target: { value: 'Is this company financially healthy enough to invest in?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Investigate/i }));
    expect(await screen.findByText(/Building the proof/i)).toBeInTheDocument();
    expect(screen.getByText(/DAYTONA ISOLATED/i)).toBeInTheDocument();
  });
});
