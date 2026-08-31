import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { InvestigationForm } from './InvestigationForm';

it('defaults to Gemini and Tavily but submits explicit provider choices', () => {
  const onSubmit = vi.fn();
  render(<InvestigationForm onSubmit={onSubmit} />);

  expect(screen.getByLabelText('Analysis model')).toHaveValue('gemini');
  expect(screen.getByLabelText('Search provider')).toHaveValue('tavily');
  fireEvent.change(screen.getByLabelText('Analysis model'), { target: { value: 'deepseek' } });
  fireEvent.change(screen.getByLabelText('Search provider'), { target: { value: 'serper' } });
  fireEvent.change(screen.getByLabelText('Research question'), {
    target: { value: 'Is this supplier financially healthy enough for a contract?' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Investigate' }));

  expect(onSubmit).toHaveBeenCalledWith({
    question: 'Is this supplier financially healthy enough for a contract?',
    llmProvider: 'deepseek',
    searchProvider: 'serper',
  });
});
