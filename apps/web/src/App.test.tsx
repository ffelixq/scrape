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
});

describe('Proofline public experience', () => {
  it('starts an evidence investigation from the hero', async () => {
    render(<App />);
    expect(screen.getByText(/Evidence before/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Investigate/i }));
    expect(await screen.findByText(/Building the proof/i)).toBeInTheDocument();
    expect(screen.getByText(/DAYTONA ISOLATED/i)).toBeInTheDocument();
  });
});
