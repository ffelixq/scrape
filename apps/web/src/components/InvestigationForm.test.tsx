import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { InvestigationForm } from './InvestigationForm';

afterEach(cleanup);

it('defaults to Gemini and submits the chosen analysis model', () => {
  const onSubmit = vi.fn();
  render(<InvestigationForm onSubmit={onSubmit} />);

  expect(screen.getByLabelText('Analysis model')).toHaveValue('gemini');
  fireEvent.change(screen.getByLabelText('Analysis model'), { target: { value: 'deepseek' } });
  fireEvent.change(screen.getByLabelText('Research question'), {
    target: { value: 'Is this supplier financially healthy enough for a contract?' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Investigate' }));

  expect(onSubmit).toHaveBeenCalledWith({
    question: 'Is this supplier financially healthy enough for a contract?',
    llmProvider: 'deepseek',
  });
});

it('puts the analysis model beside the submit button', () => {
  render(<InvestigationForm onSubmit={vi.fn()} />);

  // The model is the only remaining research choice, so it belongs with the action it changes.
  const actions = screen.getByRole('button', { name: 'Investigate' }).parentElement;
  expect(actions).toContainElement(screen.getByLabelText('Analysis model'));
});

it('offers no discovery or search provider choice', () => {
  render(<InvestigationForm onSubmit={vi.fn()} />);

  // Both search providers run on every investigation, and retrieval tooling is fixed, so the
  // form must not imply either is selectable.
  expect(screen.queryByLabelText('Search provider')).not.toBeInTheDocument();
  expect(screen.queryByText('Discovery')).not.toBeInTheDocument();
  expect(screen.queryByText(/Tavily/)).not.toBeInTheDocument();
  expect(screen.getAllByRole('combobox')).toHaveLength(1);
});
